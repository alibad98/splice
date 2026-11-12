import { cp, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const target = new URL('../public/player-preview/', import.meta.url);
await mkdir(target, { recursive: true });
await cp(new URL('../../../packages/player/dist/', import.meta.url), target, { recursive: true });
for (const name of ['index.html', 'bootstrap.js', 'preview.css']) await cp(new URL(`../preview/${name}`, import.meta.url), new URL(name, target));
const apiBase = process.env.NEXT_PUBLIC_API_URL || '/';
await writeFile(new URL('config.js', target), `export const apiBase = ${JSON.stringify(apiBase)};\n`);
console.log(`Prepared player preview at ${fileURLToPath(target)}`);
