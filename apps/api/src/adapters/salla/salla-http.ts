import { PlatformUnavailableError } from '../../ports/commerce-platform.js';
import { Metric, type Telemetry } from '../../ports/telemetry.js';
import { SALLA_HEADERS, SALLA_MIN_INTERVAL_MS } from './salla-endpoints.js';

export interface SallaHttpOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Spacing between calls for one store. */
  minIntervalMs?: number;
  /** Retries after a 429 before giving up. */
  maxRateLimitRetries?: number;
  /** A Retry-After longer than this is not waited out in-process; the caller gets PlatformUnavailableError. */
  maxWaitMs?: number;
  timeoutMs?: number;
}

/** Retry-After as delta seconds or an HTTP date, in milliseconds; undefined when absent or unusable. */
export function parseRetryAfter(value: string | null, now: number): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/**
 * Salla HTTP with per-store pacing and Retry-After handling (AD-4). Calls for one store are spaced by
 * `minIntervalMs`; a 429 blocks that store until its Retry-After passes, then the call is retried.
 */
export class SallaHttp {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;
  private readonly maxWaitMs: number;
  private readonly timeoutMs: number;
  private readonly nextSlot = new Map<string, number>();
  private readonly blockedUntil = new Map<string, number>();

  constructor(private readonly telemetry: Telemetry, options: SallaHttpOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = options.now ?? Date.now;
    this.minIntervalMs = options.minIntervalMs ?? SALLA_MIN_INTERVAL_MS;
    this.maxRetries = options.maxRateLimitRetries ?? 3;
    this.maxWaitMs = options.maxWaitMs ?? 120_000;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  private fail(reason: string): void {
    this.telemetry.counter(Metric.SallaApiFailures, { reason });
  }

  /** Reserve the next slot for `key` synchronously (so concurrent callers queue in order), then wait for it. */
  private async pace(key: string): Promise<void> {
    const t = this.now();
    const slot = Math.max(t, this.nextSlot.get(key) ?? 0, this.blockedUntil.get(key) ?? 0);
    this.nextSlot.set(key, slot + this.minIntervalMs);
    if (slot > t) await this.sleep(slot - t);
  }

  /**
   * Send a request. `storeKey` paces per store; omit it for account-level calls (token endpoint). Returns any
   * non-429 response (the caller decides what 4xx/5xx mean); throws PlatformUnavailableError on network failure,
   * timeout, or when rate limiting outlasts the retry budget. Never puts request details in error messages.
   */
  async request(storeKey: string | undefined, url: string, init: RequestInit = {}): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      if (storeKey) await this.pace(storeKey);
      let res: Response;
      try {
        res = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
      } catch (err) {
        const timeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
        this.fail(timeout ? 'timeout' : 'network');
        throw new PlatformUnavailableError(timeout ? 'Salla request timed out' : 'Salla request failed');
      }
      if (res.status !== 429) {
        if (res.status >= 500) this.fail('server_error');
        return res;
      }
      const waitMs = parseRetryAfter(res.headers.get(SALLA_HEADERS.retryAfter), this.now()) ?? 1000 * 2 ** attempt;
      await res.body?.cancel().catch(() => undefined);
      this.fail('rate_limited');
      if (storeKey) this.blockedUntil.set(storeKey, Math.max(this.blockedUntil.get(storeKey) ?? 0, this.now() + waitMs));
      if (attempt >= this.maxRetries || waitMs > this.maxWaitMs) throw new PlatformUnavailableError('Salla rate limit', Math.ceil(waitMs / 1000));
      if (!storeKey) await this.sleep(waitMs);
    }
  }
}
