import { createServer, type RequestListener, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpCdnPurger } from './http-cdn-purger.js';

let server: Server | undefined;
afterEach(async () => { server?.closeAllConnections(); await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve()); });
async function fixture(handler: RequestListener) {
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/purge`;
}
describe('authenticated HTTP purge bridge', () => {
  it('sends exactly the path and authenticated contract', async () => {
    const url = await fixture(async (req, res) => {
      expect(req.method).toBe('POST');
      expect(req.headers.authorization).toBe('Bearer secret-token');
      const chunks = [];
      for await (const c of req) chunks.push(c);
      expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual({ paths: ['/m/v1/salla/123.json'] });
      res.writeHead(204).end();
    });
    await new HttpCdnPurger(url, 'secret-token').purge('/m/v1/salla/123.json');
  });
  it('rejects non-success, redirects and timeouts without exposing credentials or bodies', async () => {
    let status = 403;
    const url = await fixture((_req, res) => { if (status) res.writeHead(status, { location: '/elsewhere' }).end('secret-token'); });
    const purger = new HttpCdnPurger(url, 'secret-token', 100);
    for (const code of [403, 302, 0]) {
      status = code;
      const result = await purger.purge('/m/v1/salla/123.json').catch((e: Error) => e);
      expect(result).toBeInstanceOf(Error);
      expect(String(result)).toMatch(/unavailable or rejected/);
      expect(String(result)).not.toMatch(/secret-token|127\.0\.0\.1/);
    }
  });
  it('rejects unsafe bridge configuration and arbitrary object paths', async () => {
    for (const url of ['https://user:password@example.test/purge', 'https://example.test/?secret=yes', 'ftp://example.test/purge']) expect(() => new HttpCdnPurger(url, 'token')).toThrow();
    expect(() => new HttpCdnPurger('https://example.test/purge', 'token', 10001)).toThrow();
    await expect(new HttpCdnPurger('https://example.test/purge', 'token').purge('/stores/private/source')).rejects.toThrow('invalid manifest purge path');
  });
});
