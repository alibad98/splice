import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('./', import.meta.url));
export default defineConfig({
  root, publicDir: '../public', server: { host: '127.0.0.1', port: 4174, fs: { allow: [fileURLToPath(new URL('../../../', import.meta.url))] } },
  resolve: { alias: [
    { find: /.*components\/session\/SessionProvider$|.*\.\.\/\.\.\/session\/SessionProvider$/, replacement: `${root}session.ts` },
    { find: 'next/navigation', replacement: `${root}navigation.ts` },
    { find: 'next/link', replacement: `${root}link.tsx` },
  ] },
  esbuild: { jsx: 'automatic' },
});
