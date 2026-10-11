// Gzip budget gate for the player build (NFR8). Fails (exit 1) on a failing budget, warns otherwise.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { evaluate } from './size-budget.mjs';

const dist = new URL('../dist/', import.meta.url).pathname;
const stubFile = new URL('../stub/stub.js', import.meta.url).pathname;

const gz = (file) => gzipSync(readFileSync(file), { level: 9 }).length;

/** Entry file plus every chunk it statically imports (dynamic import() is lazy and excluded). */
function closure(entry, seen = new Set()) {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const src = readFileSync(entry, 'utf8');
  for (const m of src.matchAll(/(?:^|[;}\s])(?:import|export)\s[^'"()]*?from\s*["'](\.[^"']+)["']|(?:^|[;\s])import\s*["'](\.[^"']+)["']/g)) {
    closure(join(dirname(entry), m[1] ?? m[2]), seen);
  }
  return seen;
}

const total = (files) => [...files].reduce((n, f) => n + gz(f), 0);
const loaderFiles = closure(join(dist, 'loader.js'));
const sizes = {
  loader: total(loaderFiles),
  initial: total(loaderFiles) + gz(stubFile),
  viewer: total(closure(join(dist, 'viewer.js'))),
  analytics: total(closure(join(dist, 'analytics.js'))),
};

let failed = false;
for (const r of evaluate(sizes)) {
  const line = `${r.status.toUpperCase().padEnd(4)} ${r.label}: ${(r.size / 1024).toFixed(2)} KB gzip (cap ${(r.cap / 1024).toFixed(0)} KB)`;
  if (r.status === 'fail') {
    failed = true;
    console.error(line);
    if (process.env.GITHUB_ACTIONS) console.log(`::error::${line}`);
  } else if (r.status === 'warn') {
    console.warn(line);
    if (process.env.GITHUB_ACTIONS) console.log(`::warning::${line}`);
  } else console.log(line);
}
process.exit(failed ? 1 : 0);
