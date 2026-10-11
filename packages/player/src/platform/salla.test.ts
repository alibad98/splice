import { describe, expect, it } from 'vitest';
import { readPageContext, readStoreLocator, type SallaEnv } from './salla.js';

const fake = (cfg: Record<string, unknown>, extra: Partial<SallaEnv> = {}): SallaEnv => ({ salla: { config: { get: (k: string) => cfg[k] } }, ...extra });

describe('salla StorefrontPlatform spike', () => {
  it('home page', () => {
    expect(readPageContext(fake({ 'page.slug': 'index', 'user.language_code': 'ar', 'store.id': 42 }))).toEqual({ pageType: 'home', targetId: null, lang: 'ar', dir: 'rtl' });
  });
  it('category page takes the id from the URL', () => {
    const ctx = readPageContext(fake({ 'page.slug': 'product.index', 'user.language_code': 'en' }, { location: { pathname: '/shirts/c123456' } }));
    expect(ctx).toEqual({ pageType: 'category', targetId: '123456', lang: 'en', dir: 'ltr' });
  });
  it('product page uses page.id and the languages is_rtl flag', () => {
    const ctx = readPageContext(fake({ 'page.slug': 'product.single', 'page.id': 987, 'user.language_code': 'en-US', languages: [{ code: 'en', is_rtl: true }] }));
    expect(ctx).toEqual({ pageType: 'product', targetId: '987', lang: 'en', dir: 'rtl' });
  });
  it('thank-you page', () => {
    expect(readPageContext(fake({ 'page.slug': 'thank-you', 'page.id': '5550', 'user.language_code': 'ar' })).targetId).toBe('5550');
  });
  it('missing salla global yields safe defaults', () => {
    expect(readPageContext({})).toEqual({ pageType: 'other', targetId: null, lang: 'ar', dir: 'rtl' });
    expect(readStoreLocator({})).toBeNull();
  });
  it('odd values never throw', () => {
    const throwing: SallaEnv = { salla: { config: { get: () => { throw new Error('boom'); } } } };
    expect(readPageContext(throwing).pageType).toBe('other');
    expect(readStoreLocator(throwing)).toBeNull();
    const ctx = readPageContext(fake({ 'page.slug': { x: 1 }, 'page.id': {}, 'user.language_code': null }, { document: { documentElement: { lang: 'en', dir: 'ltr' } } }));
    expect(ctx).toEqual({ pageType: 'other', targetId: null, lang: 'en', dir: 'ltr' });
    expect(readPageContext({ salla: { config: {} } }).pageType).toBe('other');
    expect(readPageContext(fake({ 'page.slug': 'product.single', 'page.id': '  ' })).targetId).toBeNull();
  });
  it('document dir is the fallback when languages is absent', () => {
    expect(readPageContext(fake({ 'user.language_code': 'en' }, { document: { documentElement: { dir: 'rtl' } } })).dir).toBe('rtl');
  });
  it('store locator', () => {
    expect(readStoreLocator(fake({ 'store.id': 1234 }))).toEqual({ platform: 'salla', platformStoreId: '1234' });
    expect(readStoreLocator(fake({ 'store.id': '' }))).toBeNull();
  });
});
