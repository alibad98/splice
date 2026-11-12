// Story 3.7: the IP policy and the SSRF-safe fetcher against a local http server (127.0.0.1 and its port are allowed
// through the test-only options; every other address follows the production policy).
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExternalFetchTransientError } from '../../ports/external-fetcher.js';
import { checkFetchUrl, isBlockedAddress } from '../../ports/fetch-url-policy.js';
import { SsrfSafeFetcher, type ResolvedAddress } from './ssrf-safe-fetcher.js';

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '127.255.0.9',
    '0.0.0.0',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '100.64.0.1',
    '169.254.169.254',
    '192.0.0.8',
    '192.0.2.1',
    '198.18.0.1',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1',
    '239.255.255.250',
    '240.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::127.0.0.1',
    'fe80::1',
    'fe80::1%eth0',
    'fc00::1',
    'fd12:3456::1',
    'ff02::1',
    'fec0::1',
    '64:ff9b::7f00:1',
    '64:ff9b:1::a00:5',
    '100::1',
    '2001:db8::1',
    '2001::1',
    '2002:7f00:1::1',
    '3fff::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.5',
    '::ffff:169.254.169.254',
    '::ffff:192.168.1.1',
    '[::1]',
    'localhost',
    '',
  ])('blocks %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.215.14', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '2a00:1450:4001::200e', '::ffff:8.8.8.8'])('allows %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });
});

describe('checkFetchUrl', () => {
  it.each([
    ['ftp://cdn.example.com/a.jpg', 'scheme'],
    ['file:///etc/passwd', 'scheme'],
    ['javascript:alert(1)', 'scheme'],
    ['https://u:p@cdn.example.com/a.jpg', 'credentials'],
    ['https://u@cdn.example.com/a.jpg', 'credentials'],
    ['http://cdn.example.com:8080/a.jpg', 'port'],
    ['http://127.0.0.1/', 'blocked_address'],
    ['http://169.254.169.254/latest/meta-data/', 'blocked_address'],
    ['http://[::1]/', 'blocked_address'],
    ['http://[::ffff:127.0.0.1]/', 'blocked_address'],
    ['http://0x7f.1/', 'blocked_address'],
    ['http://2130706433/', 'blocked_address'],
    ['http://10.0.0.5/a.jpg', 'blocked_address'],
    ['not a url', 'invalid'],
    [`https://cdn.example.com/${'a'.repeat(2048)}`, 'too_long'],
  ])('refuses %s (%s)', (raw, problem) => {
    expect(checkFetchUrl(raw)).toEqual({ ok: false, problem });
  });

  it.each(['https://cdn.example.com/a.jpg', 'http://cdn.example.com/a.mp4', 'https://cdn.example.com:443/a.jpg', 'http://cdn.example.com:80/a', 'https://8.8.8.8/a.png', 'https://localhost/a.png'])(
    'accepts %s (names are checked when they resolve)',
    (raw) => {
      expect(checkFetchUrl(raw).ok).toBe(true);
    },
  );
});

describe('SsrfSafeFetcher', () => {
  let server: Server;
  let port: number;
  let lastHeaders: IncomingHttpHeaders = {};
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

  const hosts: Record<string, string[]> = {
    'media.test': ['127.0.0.1'],
    'private.test': ['10.0.0.5'],
    'mixed.test': ['127.0.0.1', '10.0.0.5'],
    'mapped.test': ['::ffff:169.254.169.254'],
  };
  const resolve = async (hostname: string): Promise<ResolvedAddress[]> => {
    if (hostname === 'slow.test') return new Promise(() => undefined);
    const list = hosts[hostname];
    if (!list) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
    return list.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  };
  const fetcher = (opts: { connectTimeoutMs?: number; totalTimeoutMs?: number } = {}) =>
    new SsrfSafeFetcher({ resolve, allowAddresses: ['127.0.0.1'], allowPorts: [String(port)], ...opts });
  const at = (path: string, host = 'media.test') => `http://${host}:${port}${path}`;

  beforeAll(async () => {
    server = createServer((req, res) => {
      lastHeaders = req.headers;
      const url = new URL(req.url ?? '/', 'http://x');
      const path = url.pathname;
      if (path === '/a.png') res.writeHead(200, { 'content-type': 'image/png', 'set-cookie': 'a=b' }).end(PNG);
      else if (path === '/missing') res.writeHead(404).end('nope');
      else if (path === '/down') res.writeHead(503).end('later');
      else if (path === '/redirect') res.writeHead(302, { location: '/a.png' }).end();
      else if (path === '/to-private') res.writeHead(302, { location: 'http://192.168.1.1/x' }).end();
      else if (path === '/to-private-name') res.writeHead(301, { location: at('/a.png', 'private.test') }).end();
      else if (path === '/to-ftp') res.writeHead(302, { location: 'ftp://media.test/a.png' }).end();
      else if (path === '/no-location') res.writeHead(302).end();
      else if (path.startsWith('/hop/')) {
        const n = Number(path.slice(5));
        res.writeHead(307, { location: n > 0 ? `/hop/${n - 1}` : '/a.png' }).end();
      } else if (path === '/big') res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': '5000' }).end(Buffer.alloc(5000));
      else if (path === '/big-chunked') {
        res.writeHead(200, { 'content-type': 'video/mp4' });
        for (let i = 0; i < 10; i++) res.write(Buffer.alloc(500));
        res.end();
      } else if (path === '/stall') {
        res.writeHead(200, { 'content-type': 'image/png' });
        res.write(PNG.subarray(0, 4));
      } else res.writeHead(500).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });

  it('fetches a file, sending a generic user agent, no cookies and no compression', async () => {
    const out = await fetcher().fetch(at('/a.png'), { maxBytes: 1000 });
    expect(out).toEqual({ outcome: 'ok', body: PNG, contentType: 'image/png' });
    expect(lastHeaders['accept-encoding']).toBe('identity');
    expect(lastHeaders['user-agent']).toMatch(/^Mozilla\/5\.0 \(compatible;/);
    expect(lastHeaders.cookie).toBeUndefined();
  });

  it('follows a redirect, re-checking it', async () => {
    expect(await fetcher().fetch(at('/redirect'), { maxBytes: 1000 })).toMatchObject({ outcome: 'ok', body: PNG });
    expect(await fetcher().fetch(at('/hop/2'), { maxBytes: 1000 })).toMatchObject({ outcome: 'ok' });
  });

  it('stops after 3 redirects', async () => {
    expect(await fetcher().fetch(at('/hop/3'), { maxBytes: 1000 })).toMatchObject({ outcome: 'failed', detail: 'too many redirects' });
  });

  it('blocks a redirect to a private IP, to a name resolving to one, or to another scheme', async () => {
    expect(await fetcher().fetch(at('/to-private'), { maxBytes: 1000 })).toMatchObject({ outcome: 'blocked' });
    expect(await fetcher().fetch(at('/to-private-name'), { maxBytes: 1000 })).toMatchObject({ outcome: 'blocked' });
    expect(await fetcher().fetch(at('/to-ftp'), { maxBytes: 1000 })).toMatchObject({ outcome: 'blocked' });
  });

  it('blocks a name resolving to a private address, any address of a mixed answer, and an IPv4-mapped metadata address', async () => {
    expect(await fetcher().fetch(at('/a.png', 'private.test'), { maxBytes: 1000 })).toMatchObject({ outcome: 'blocked' });
    expect(await fetcher().fetch(at('/a.png', 'mixed.test'), { maxBytes: 1000 })).toMatchObject({ outcome: 'blocked' });
    expect(await fetcher().fetch(at('/a.png', 'mapped.test'), { maxBytes: 1000 })).toMatchObject({ outcome: 'blocked' });
  });

  it('blocks literal hosts and other ports before connecting (production policy)', async () => {
    const strict = new SsrfSafeFetcher({ resolve });
    expect(await strict.fetch(`http://127.0.0.1:${port}/a.png`, { maxBytes: 1000 })).toMatchObject({ outcome: 'blocked' });
    expect(await strict.fetch('http://127.0.0.1/a.png', { maxBytes: 1000 })).toMatchObject({ outcome: 'blocked' });
    expect(await strict.fetch('http://169.254.169.254/latest/meta-data/', { maxBytes: 1000 })).toMatchObject({ outcome: 'blocked' });
    expect(await strict.fetch('http://[::1]/', { maxBytes: 1000 })).toMatchObject({ outcome: 'blocked' });
    expect(await strict.fetch('http://media.test/a.png', { maxBytes: 1000 })).toMatchObject({ outcome: 'blocked' });
  });

  it('caps the body by Content-Length and while streaming', async () => {
    expect(await fetcher().fetch(at('/big'), { maxBytes: 4000 })).toEqual({ outcome: 'too_large' });
    expect(await fetcher().fetch(at('/big-chunked'), { maxBytes: 4000 })).toEqual({ outcome: 'too_large' });
    expect(await fetcher().fetch(at('/big-chunked'), { maxBytes: 5000 })).toMatchObject({ outcome: 'ok' });
  });

  it('a 4xx is a definitive failure; a 5xx, a refused connection or an unknown host throws so the job retries', async () => {
    expect(await fetcher().fetch(at('/missing'), { maxBytes: 1000 })).toMatchObject({ outcome: 'failed', status: 404 });
    expect(await fetcher().fetch(at('/no-location'), { maxBytes: 1000 })).toMatchObject({ outcome: 'failed', status: 302 });
    await expect(fetcher().fetch(at('/down'), { maxBytes: 1000 })).rejects.toBeInstanceOf(ExternalFetchTransientError);
    const closed = createServer();
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
    const closedPort = (closed.address() as AddressInfo).port;
    await new Promise((r) => closed.close(r));
    const refused = new SsrfSafeFetcher({ resolve, allowAddresses: ['127.0.0.1'], allowPorts: [String(closedPort)] });
    await expect(refused.fetch(`http://media.test:${closedPort}/a.png`, { maxBytes: 1000 })).rejects.toBeInstanceOf(ExternalFetchTransientError);
    await expect(fetcher().fetch(at('/a.png', 'unknown.test'), { maxBytes: 1000 })).rejects.toBeInstanceOf(ExternalFetchTransientError);
  });

  it('times out connecting and overall', async () => {
    await expect(fetcher({ connectTimeoutMs: 100 }).fetch(at('/a.png', 'slow.test'), { maxBytes: 1000 })).rejects.toThrow(/connect timeout/);
    await expect(fetcher({ totalTimeoutMs: 300 }).fetch(at('/stall'), { maxBytes: 1000 })).rejects.toThrow(/total timeout/);
  });
});
