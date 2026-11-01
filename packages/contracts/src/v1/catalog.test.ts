import { describe, expect, it } from 'vitest';
import { CatalogSyncStatus, ProductListQuery, ProductListResponse } from './catalog.js';

const row = {
  id: '0b6c8f2e-3d1a-4c7e-9a2b-1f0e5d4c3b2a',
  external_id: 'p1',
  name: 'Abaya',
  image_url: null,
  category_name: 'Abayas',
  more_categories: 0,
  price_minor: 15000,
  sale_price_minor: 12000,
  currency: 'SAR',
  tax_inclusive: true,
  availability: 'low',
  linked_content_count: 0,
  attributed_orders: null,
};

describe('catalog contracts', () => {
  it('defaults sort and page and coerces page from the query string', () => {
    expect(ProductListQuery.parse({})).toEqual({ sort: 'name', page: 1 });
    expect(ProductListQuery.parse({ page: '3', sort: '-price', q: ' abaya ' })).toEqual({ page: 3, sort: '-price', q: 'abaya' });
  });
  it('rejects page 0, an unknown sort and a search over 100 characters', () => {
    expect(ProductListQuery.safeParse({ page: '0' }).success).toBe(false);
    expect(ProductListQuery.safeParse({ page: 'x' }).success).toBe(false);
    expect(ProductListQuery.safeParse({ sort: 'x' }).success).toBe(false);
    expect(ProductListQuery.safeParse({ q: 'a'.repeat(101) }).success).toBe(false);
    expect(ProductListQuery.safeParse({ q: ['a', 'b'] }).success).toBe(false);
  });
  it('parses a product page with money in minor units and the stored bucket', () => {
    const page = ProductListResponse.parse({ items: [row], total: 1, page: 1, page_size: 50 });
    expect(page.v).toBe(1);
    expect(page.items[0]!.sale_price_minor).toBe(12000);
    expect(ProductListResponse.safeParse({ items: [{ ...row, availability: 'many' }], total: 1, page: 1, page_size: 50 }).success).toBe(false);
    expect(ProductListResponse.safeParse({ items: [{ ...row, price_minor: 1.5 }], total: 1, page: 1, page_size: 50 }).success).toBe(false);
  });
  it('parses sync status including never', () => {
    expect(CatalogSyncStatus.parse({ status: 'never', reason: null, last_synced_at: null }).v).toBe(1);
  });
});
