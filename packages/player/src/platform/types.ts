import type { ContentProductSummary } from '@slips/contracts';
export type PlatformResult = 'cart' | 'product' | 'link';
/** All commerce/navigation effects are delegated to the host adapter. */
export interface StorefrontPlatform {
  addToCart(product: ContentProductSummary): Promise<PlatformResult>;
  openProduct(product: ContentProductSummary): Promise<PlatformResult>;
  openLink(url: string): Promise<PlatformResult>;
  selectSlide(index: number): void;
}
