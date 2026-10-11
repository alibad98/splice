import { defineConfig } from 'vitest/config';
import { vitestPreset } from '@slips/config/vitest';
export default defineConfig({
  ...vitestPreset,
  test: { ...vitestPreset.test, include: ['**/*.test.ts', '**/*.test.tsx'], exclude: ['node_modules/**', '.next/**'] },
});
