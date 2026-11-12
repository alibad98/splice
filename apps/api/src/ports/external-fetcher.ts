// ExternalFetcher port (Story 3.7): fetches a merchant's media link into memory, in the worker only (never the API).
// The one adapter (`adapters/fetch/ssrf-safe-fetcher.ts`) blocks private, loopback, link-local and metadata addresses.

/**
 * A definitive outcome of fetching a link. Transient failures (network error, timeout, HTTP 5xx) are thrown instead, so
 * the job retries them.
 * - `ok`: the body (at most `maxBytes`) and the declared `Content-Type`, if any (never trusted: the bytes are sniffed).
 * - `blocked`: the link, a redirect, or an address its host resolves to is not allowed.
 * - `too_large`: the declared or streamed body passed `maxBytes`.
 * - `failed`: the source answered an error (4xx, a redirect loop, a redirect without a location...).
 */
export type ExternalFetchResult =
  | { outcome: 'ok'; body: Buffer; contentType: string | null }
  | { outcome: 'blocked'; detail: string }
  | { outcome: 'too_large' }
  | { outcome: 'failed'; detail: string; status?: number };

export interface ExternalFetcher {
  /** GETs `url`, following at most a few redirects (each re-checked), and reads at most `maxBytes`. */
  fetch(url: string, opts: { maxBytes: number }): Promise<ExternalFetchResult>;
}

/** Thrown for failures worth retrying: network errors, timeouts and 5xx answers. */
export class ExternalFetchTransientError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ExternalFetchTransientError';
  }
}
