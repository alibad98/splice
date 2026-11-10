import { describe, expect, it } from 'vitest';
import { StoreManifest } from './manifest.js';

const id = '019a0000-0000-7000-8000-000000000001';
const slide = { id, media_asset_id: id, kind: 'video', alt_text: null, status: 'scanned', source_url: '/v1/media/id/source', poster_url: null, renditions: [] };
const manifest = { v: 1, store_id: id, items: [{ id, title: 'Preview', format: 'story', cta_label: 'Shop', cta_action: 'open_product', cta_url: null, cta_style: null, product: null, slides: [slide] }] };
const product = { id, name: 'Product', image_url: null, price_minor: 1099, sale_price_minor: 999, currency: 'SAR', availability: 'out_of_stock', has_required_options: true, deleted: true };

describe('StoreManifest v1', () => {
  it('accepts explicit partial media and complete rendition/product snapshots', () => {
    expect(StoreManifest.parse(manifest)).toEqual(manifest);
    const full: Record<string, unknown> = { ...manifest };
    full.items = [{ ...manifest.items[0], product: { id, name: 'Product', image_url: null, price_minor: 1099, sale_price_minor: null, currency: 'SAR', availability: 'out_of_stock', has_required_options: true, deleted: true }, slides: [{ ...slide, status: 'processed', renditions: [{ profile: '720p', url: '/v1/media/id/renditions/720p', content_type: 'video/mp4', width: 720, height: 1280 }] }] }];
    expect(StoreManifest.safeParse(full).success).toBe(true);
  });

  it('requires the version, null fields, known enums and valid rendition dimensions', () => {
    for (const v of [undefined, 0, 2, '1']) expect(StoreManifest.safeParse({ ...manifest, v }).success).toBe(false);
    for (const change of [{ poster_url: undefined }, { status: 'ready' }, { kind: 'audio' }, { renditions: [{ profile: '4k', url: '/bytes', content_type: 'video/mp4', width: 720, height: 1280 }] }, { renditions: [{ profile: '720p', url: '/bytes', content_type: 'video/mp4', width: 0, height: 1280 }] }]) {
      expect(StoreManifest.safeParse({ ...manifest, items: [{ ...manifest.items[0], slides: [{ ...slide, ...change }] }] }).success).toBe(false);
    }
  });

  it('rejects fractional regular and sale prices independently in a complete product snapshot', () => {
    const withProduct = (snapshot: typeof product) => ({ ...manifest, items: [{ ...manifest.items[0], product: snapshot }] });
    expect(StoreManifest.safeParse(withProduct(product)).success).toBe(true);
    expect(StoreManifest.safeParse(withProduct({ ...product, price_minor: 1.5 })).success).toBe(false);
    expect(StoreManifest.safeParse(withProduct({ ...product, sale_price_minor: 1.5 })).success).toBe(false);
  });
});
