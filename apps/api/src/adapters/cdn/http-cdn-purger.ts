import type { CdnPurger } from '../../ports/cdn-purger.js';

/** POST {paths:[path]}, Bearer authentication; any 2xx acknowledges invalidation. */
export class HttpCdnPurger implements CdnPurger {
  constructor(private readonly url: string, private readonly token: string, private readonly timeoutMs = 5000) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('invalid CDN purge bridge URL');
    if (!token || /[\r\n]/.test(token) || timeoutMs < 100 || timeoutMs > 10000) throw new Error('invalid CDN purge bridge configuration');
  }

  async purge(path: string): Promise<void> {
    if (!/^\/m\/v1\/salla\/[^/]+\.json$/.test(path)) throw new Error('invalid manifest purge path');
    try {
      const response = await fetch(this.url, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs),
        headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ paths: [path] }),
      });
      await response.body?.cancel();
      if (!response.ok) throw new Error('rejected');
    } catch {
      // Neither response bodies, credentials nor configured URLs enter job error logging.
      throw new Error('CDN purge bridge unavailable or rejected invalidation');
    }
  }
}
