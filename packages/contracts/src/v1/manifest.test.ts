import { describe, expect, it } from 'vitest';
import { MANIFEST_PLACEMENT_MAX_ITEMS, StoreManifest } from './manifest.js';

const id = '019a0000-0000-7000-8000-000000000001';
const slide = { id, media_asset_id: id, kind: 'video', alt_text: null, status: 'scanned', source_url: '/v1/media/id/source', poster_url: null, renditions: [] };
const manifest = { v: 1, store_id: id, placements: [{ type: 'home', layout: 'ring', item_ids: [id] }], items: [{ id, title: 'Preview', format: 'story', cta_label: 'Shop', cta_action: 'open_product', cta_url: null, cta_style: null, product: null, slides: [slide] }] };
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

  it('accepts a dropped CTA as null label, action and URL', () => {
    const dropped = { ...manifest, items: [{ ...manifest.items[0], cta_label: null, cta_action: null, cta_url: null }] };
    expect(StoreManifest.parse(dropped)).toEqual(dropped);
    for (const change of [
      { cta_label: '' }, { cta_action: 'buy' }, { cta_label: undefined }, { cta_action: undefined },
      // Half-null CTAs: label and action are null together, and a null action carries no URL.
      { cta_label: null }, { cta_action: null }, { cta_action: null, cta_label: null, cta_url: 'https://shop.example/a' }, { cta_action: null, cta_url: 'https://shop.example/a' },
    ]) {
      expect(StoreManifest.safeParse({ ...manifest, items: [{ ...manifest.items[0], ...change }] }).success).toBe(false);
    }
  });

  it('requires placements: Home with a pilot layout and at most ten item ids', () => {
    expect(StoreManifest.safeParse({ ...manifest, placements: [] }).success).toBe(true);
    const without: Partial<typeof manifest> = { ...manifest };
    delete without.placements;
    expect(StoreManifest.safeParse(without).success).toBe(false);
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `019a0000-0000-7000-8000-${String(i).padStart(12, '0')}`);
    expect(StoreManifest.safeParse({ ...manifest, placements: [{ type: 'home', layout: 'ring', item_ids: ids(MANIFEST_PLACEMENT_MAX_ITEMS) }] }).success).toBe(true);
    for (const placement of [
      { type: 'home', layout: 'ring', item_ids: ids(MANIFEST_PLACEMENT_MAX_ITEMS + 1) },
      { type: 'category', layout: 'ring', item_ids: [] },
      { type: 'home', layout: 'bar', item_ids: [] },
      { type: 'home', layout: 'ring', item_ids: ['not-a-uuid'] },
      { type: 'home', item_ids: [] },
    ]) expect(StoreManifest.safeParse({ ...manifest, placements: [placement] }).success).toBe(false);
  });
});
