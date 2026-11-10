import type { StorefrontPlatform } from './types.js';
import { it, expect, vi } from 'vitest';
import { MockStorefrontPlatform } from './mock.js';
import { manifest } from '../../test/manifest.js';
it('simulates every action without network or navigation', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch');
  const mock = new MockStorefrontPlatform();
  const platform: StorefrontPlatform = mock;
  expect(await platform.addToCart(manifest().items[0]!.product!)).toBe('cart');
  expect(await platform.openProduct(manifest().items[0]!.product!)).toBe(
    'product',
  );
  expect(await platform.openLink('https://shop.example')).toBe('link');
  platform.selectSlide(1);
  expect(fetch).not.toHaveBeenCalled();
});
