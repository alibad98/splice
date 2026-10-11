import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// Three entries: core loader (initial payload), lazy viewer, analytics batcher.
// scripts/check-size.mjs gates each against its gzip budget.
export default defineConfig({
  plugins: [preact()],
  build: {
    lib: {
      entry: { loader: 'src/index.ts', viewer: 'src/viewer/index.ts', analytics: 'src/analytics/index.ts' },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
    },
    rollupOptions: { external: [] },
  },
});
