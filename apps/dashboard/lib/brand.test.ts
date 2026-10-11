import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const files = ['app/icon.svg', ...['logo-mark', 'logo-mark-dark', 'logo-wordmark-en', 'logo-wordmark-en-dark', 'logo-wordmark-ar', 'logo-wordmark-ar-dark', 'app-icon'].map((n) => `public/brand/${n}.svg`)];

describe('brand assets', () => {
  it.each(files)('%s exists and has no purple', (f) => {
    const url = new URL(`../${f}`, import.meta.url);
    expect(existsSync(url)).toBe(true);
    for (const hex of readFileSync(url, 'utf8').match(/#[0-9a-fA-F]{6}\b/g) ?? []) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
      const purple = b > r && b > g && r > g + 20 && b - g > 40;
      expect(purple, hex).toBe(false);
    }
  });
});
