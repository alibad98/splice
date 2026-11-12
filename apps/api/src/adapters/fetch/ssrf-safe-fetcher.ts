// The one SSRF-safe fetcher (Story 3.7): node `http`/`https`, no fetch library. Every address a host resolves to is
// checked at connect time (a custom `lookup`), so DNS rebinding cannot slip a private address in between a check and
// the connection; IP-literal hosts are checked before connecting; every redirect is re-validated.
import { lookup as dnsLookup } from 'node:dns';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import type { LookupFunction, Socket } from 'node:net';
import { ExternalFetchTransientError, type ExternalFetchResult, type ExternalFetcher } from '../../ports/external-fetcher.js';
import { DEFAULT_FETCH_URL_POLICY, checkFetchUrl, isBlockedAddress, type FetchUrlPolicy } from '../../ports/fetch-url-policy.js';

export interface ResolvedAddress {
  address: string;
  family: number;
}

export interface SsrfSafeFetcherOptions {
  /** Until the TCP (and TLS) connection is up, DNS included. Default 10 s. */
  connectTimeoutMs?: number;
  /** For the whole fetch, redirects and body included. Default 120 s. */
  totalTimeoutMs?: number;
  /** Redirects followed, each re-validated. Default 3. */
  maxRedirects?: number;
  userAgent?: string;
  /** Replaces DNS (tests). Default: the system resolver, every address. */
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  /** Tests only: addresses allowed despite the policy (a local test server on 127.0.0.1). */
  allowAddresses?: readonly string[];
  /** Tests only: extra ports allowed (a local test server's port). */
  allowPorts?: readonly string[];
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

class BlockedAddressError extends Error {
  constructor(readonly hostname: string) {
    super(`media fetch: ${hostname} resolves to a blocked address`);
    this.name = 'BlockedAddressError';
  }
}

class FetchTimeoutError extends Error {
  constructor(phase: 'connect' | 'total') {
    super(`media fetch: ${phase} timeout`);
    this.name = 'FetchTimeoutError';
  }
}

const systemResolve = (hostname: string): Promise<ResolvedAddress[]> =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => (err ? reject(err) : resolve(addresses)));
  });

/** Whether an error (or one it wraps: `cause`, AggregateError from family auto-selection) is a blocked-address refusal. */
const isBlockedError = (err: unknown): boolean => {
  if (err instanceof BlockedAddressError) return true;
  if (err instanceof AggregateError) return err.errors.some(isBlockedError);
  return err instanceof Error && err.cause !== undefined && err.cause !== err && isBlockedError(err.cause);
};

/** Fetches a merchant's media link in the worker: http(s) on ports 80/443 only, blocked addresses refused, capped, timed out. */
export class SsrfSafeFetcher implements ExternalFetcher {
  private readonly connectTimeoutMs: number;
  private readonly totalTimeoutMs: number;
  private readonly maxRedirects: number;
  private readonly userAgent: string;
  private readonly resolve: (hostname: string) => Promise<ResolvedAddress[]>;
  private readonly policy: FetchUrlPolicy;

  constructor(opts: SsrfSafeFetcherOptions = {}) {
    this.connectTimeoutMs = opts.connectTimeoutMs ?? 10_000;
    this.totalTimeoutMs = opts.totalTimeoutMs ?? 120_000;
    this.maxRedirects = opts.maxRedirects ?? 3;
    this.userAgent = opts.userAgent ?? 'Mozilla/5.0 (compatible; MediaFetcher/1.0)';
    this.resolve = opts.resolve ?? systemResolve;
    const allowed = new Set(opts.allowAddresses ?? []);
    this.policy = {
      ports: [...DEFAULT_FETCH_URL_POLICY.ports, ...(opts.allowPorts ?? [])],
      isBlocked: (address) => !allowed.has(address) && isBlockedAddress(address),
    };
  }

  async fetch(rawUrl: string, opts: { maxBytes: number }): Promise<ExternalFetchResult> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(new FetchTimeoutError('total')), this.totalTimeoutMs);
    try {
      let current = rawUrl;
      for (let redirects = 0; ; redirects++) {
        const checked = checkFetchUrl(current, this.policy);
        if (!checked.ok) return { outcome: 'blocked', detail: `${redirects === 0 ? 'link' : 'redirect'}: ${checked.problem}` };
        let res: IncomingMessage;
        try {
          res = await this.request(checked.url, abort.signal);
        } catch (err) {
          if (isBlockedError(err)) return { outcome: 'blocked', detail: 'resolved address' };
          throw this.transient(err, abort.signal);
        }
        const status = res.statusCode ?? 0;
        if (REDIRECTS.has(status)) {
          res.destroy();
          const location = res.headers.location;
          if (!location) return { outcome: 'failed', detail: 'redirect without location', status };
          if (redirects >= this.maxRedirects) return { outcome: 'failed', detail: 'too many redirects', status };
          try {
            current = new URL(location, checked.url).href;
          } catch {
            return { outcome: 'failed', detail: 'invalid redirect location', status };
          }
          continue;
        }
        if (status >= 500) {
          res.destroy();
          throw new ExternalFetchTransientError(`media fetch: HTTP ${status}`);
        }
        if (status < 200 || status >= 300) {
          res.destroy();
          return { outcome: 'failed', detail: `HTTP ${status}`, status };
        }
        const declared = Number(res.headers['content-length']);
        if (Number.isFinite(declared) && declared > opts.maxBytes) {
          res.destroy();
          return { outcome: 'too_large' };
        }
        let body: Buffer | null;
        try {
          body = await readCappedBody(res, opts.maxBytes);
        } catch (err) {
          throw this.transient(err, abort.signal);
        }
        if (!body) return { outcome: 'too_large' };
        const contentType = res.headers['content-type'] ?? null;
        return { outcome: 'ok', body, contentType };
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private transient(err: unknown, signal: AbortSignal): ExternalFetchTransientError {
    if (err instanceof ExternalFetchTransientError) return err;
    const cause = signal.aborted ? signal.reason : err;
    return new ExternalFetchTransientError(cause instanceof Error ? cause.message : 'media fetch failed', { cause });
  }

  /** One GET with the checking `lookup`, a connect timeout and the overall abort signal. No cookies, no compression. */
  private request(url: URL, signal: AbortSignal): Promise<IncomingMessage> {
    const lookup = ((hostname: string, options: { family?: number | string; all?: boolean }, callback: (...args: unknown[]) => void) => {
      this.resolve(hostname).then(
        (addresses) => {
          if (addresses.length === 0) return callback(Object.assign(new Error(`media fetch: ${hostname} did not resolve`), { code: 'ENOTFOUND' }), '', 4);
          // Every address is checked, not just the one used: a host that resolves to any blocked address is refused.
          if (addresses.some((a) => this.policy.isBlocked(a.address))) return callback(new BlockedAddressError(hostname), '', 4);
          const family = options.family === 'IPv4' ? 4 : options.family === 'IPv6' ? 6 : Number(options.family ?? 0);
          const usable = family === 4 || family === 6 ? addresses.filter((a) => a.family === family) : addresses;
          if (usable.length === 0) return callback(Object.assign(new Error(`media fetch: ${hostname} has no IPv${family} address`), { code: 'ENOTFOUND' }), '', 4);
          if (options.all) return callback(null, usable);
          return callback(null, usable[0]!.address, usable[0]!.family);
        },
        (err: unknown) => callback(err, '', 4),
      );
    }) as unknown as LookupFunction;
    const secure = url.protocol === 'https:';
    return new Promise((resolve, reject) => {
      const req = (secure ? https : http).request(url, {
        method: 'GET',
        agent: false,
        lookup,
        signal,
        headers: { 'user-agent': this.userAgent, accept: '*/*', 'accept-encoding': 'identity' },
      });
      req.once('socket', (socket: Socket) => {
        const connectTimer = setTimeout(() => req.destroy(new FetchTimeoutError('connect')), this.connectTimeoutMs);
        socket.once(secure ? 'secureConnect' : 'connect', () => clearTimeout(connectTimer));
        socket.once('close', () => clearTimeout(connectTimer));
      });
      req.once('response', resolve);
      req.once('error', reject);
      req.end();
    });
  }
}

/** Reads a response body, or `null` as soon as it passes `maxBytes` (the stream is aborted). */
async function readCappedBody(res: IncomingMessage, maxBytes: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of res) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buf.length;
    if (total > maxBytes) {
      res.destroy();
      return null;
    }
    chunks.push(buf);
  }
  if (!res.complete) throw new Error('media fetch: the response ended early');
  return Buffer.concat(chunks, total);
}
