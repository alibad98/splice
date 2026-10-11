// Tiny static + fake-API server for the CLS suite. Serves fixtures, the built player and the manifest API.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const hanging = new Set();

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/health') return void res.end('ok');
  if (url.pathname === '/v1/storefront/manifest') {
    const key = url.searchParams.get('key');
    res.setHeader('content-type', 'application/json');
    if (key === 'slow-content') {
      await new Promise((r) => setTimeout(r, 400)); // content, but after the shopper has scrolled
      return void res.end(JSON.stringify({ items: [{ id: '1', title: 'Story one' }] }));
    }
    if (key === 'content') return void res.end(JSON.stringify({ items: [{ id: '1', title: 'Story one' }, { id: '2', title: 'Story two' }] }));
    if (key === 'empty') return void res.end(JSON.stringify({ items: [] }));
    if (key === 'timeout') return void hanging.add(res); // never answers; the loader's timeout must win
    res.statusCode = 401; // invalid key
    return void res.end(JSON.stringify({ type: 'invalid-key' }));
  }
  const rel = url.pathname.startsWith('/dist/') ? url.pathname : `/e2e/fixtures${url.pathname}`;
  const file = normalize(join(root, rel));
  if (!file.startsWith(root)) return void res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.setHeader('content-type', types[extname(file)] ?? 'application/octet-stream');
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

server.listen(4173, '127.0.0.1');
process.on('SIGTERM', () => {
  for (const r of hanging) r.destroy();
  server.close();
});
