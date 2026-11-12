import type { StorefrontPlatform } from './types.js';
/** Preview adapter: deliberately contains no network, navigation or telemetry code. */
export class MockStorefrontPlatform implements StorefrontPlatform {
  async addToCart() {
    return 'cart' as const;
  }
  async openProduct() {
    return 'product' as const;
  }
  async openLink() {
    return 'link' as const;
  }
  selectSlide() {}
}
