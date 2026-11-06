import { describe, expect, it } from 'vitest';
import {
  ARCHIVABLE_STATUSES,
  CONTENT_ACTIONS,
  CONTENT_FORMATS,
  CONTENT_INVALID_TRANSITION,
  CONTENT_STATUSES,
  CONTENT_TRANSITIONS,
  CTA_ACTIONS,
  ContentCreateInput,
  ContentItem,
  canTransition,
  CONTENT_SORTS,
  CONTENT_TABS,
  ContentListQuery,
  ContentListResponse,
  TAB_STATUSES,
  CONTENT_CTA_URL_NOT_STORE_DOMAIN,
  CTA_STYLES,
  ContentUpdateInput,
  DEFAULT_CTA_STYLE,
  ctaUrlMatchesAction,
  isStoreDomainUrl,
  CONTENT_PRODUCT_NOT_LINKABLE,
  ContentFields,
  ContentProductSummary,
  CONTENT_SLIDE_ALT_REQUIRED,
  SLIDES_MAX,
  SLIDE_ALT_MAX,
  slideAltTextOk,
} from './content.js';
import { EVENT_CATALOG } from './events.js';

const item = {
  id: '019a473a-0000-7000-8000-000000000001',
  title: 'عباية العيد',
  format: 'story',
  cta_label: 'أضف للسلة',
  cta_action: 'add_to_cart',
  cta_url: null,
  cta_style: null,
  status: 'draft',
  archived_from: null,
  reactivate_to: null,
  auto_publish: false,
  first_published_at: null,
  product: null,
  slides: [],
  created_at: '2026-11-03T10:00:00.000Z',
  updated_at: '2026-11-03T10:00:00.000Z',
};

describe('content contracts', () => {
  it('defines the 8 content statuses (no ready), formats, CTA actions and invalid-transition problem slug', () => {
    expect(CONTENT_STATUSES).toEqual(['draft', 'processing', 'failed', 'scheduled', 'published', 'ended', 'archived', 'deactivated']);
    expect(CONTENT_STATUSES).not.toContain('ready');
    expect(CONTENT_FORMATS).toEqual(['story', 'reel']);
    expect(CTA_ACTIONS).toEqual(['add_to_cart', 'open_product', 'open_link']);
    expect(CONTENT_INVALID_TRANSITION).toBe('invalid-transition');
  });

  it('defines the transition table and canTransition for every status and action', () => {
    expect(canTransition(null, 'create')).toBe(true);
    for (const action of CONTENT_ACTIONS.filter((a) => a !== 'create')) expect(canTransition(null, action)).toBe(false);
    for (const status of CONTENT_STATUSES) expect(canTransition(status, 'create')).toBe(false);

    expect(CONTENT_TRANSITIONS.start_processing.from).toEqual(['draft', 'failed']);
    expect(CONTENT_TRANSITIONS.finish_processing).toMatchObject({ from: ['processing'], to: 'draft', event: 'content.item.processed' });
    expect(CONTENT_TRANSITIONS.fail_processing).toMatchObject({ from: ['processing'], to: 'failed', event: 'content.item.processing_failed' });
    expect(CONTENT_TRANSITIONS.publish).toMatchObject({ from: ['draft'], to: 'published', event: 'content.item.published' });
    expect(CONTENT_TRANSITIONS.schedule).toMatchObject({ from: ['draft'], to: 'scheduled', event: 'content.item.scheduled' });
    expect(CONTENT_TRANSITIONS.go_live).toMatchObject({ from: ['scheduled'], to: 'published', event: 'content.item.published' });
    expect(CONTENT_TRANSITIONS.end).toMatchObject({ from: ['published', 'scheduled'], to: 'ended', event: 'content.item.ended' });
    expect(CONTENT_TRANSITIONS.deactivate).toMatchObject({ from: ['published', 'scheduled'], to: 'deactivated', event: 'content.item.deactivated' });
    expect(CONTENT_TRANSITIONS.reactivate).toMatchObject({ from: ['deactivated'], to: 'reactivate_to', event: 'content.item.reactivated' });
    expect(CONTENT_TRANSITIONS.archive.from).toEqual(ARCHIVABLE_STATUSES);
    expect(canTransition('processing', 'archive')).toBe(false);
    expect(canTransition('archived', 'archive')).toBe(false);
    expect(canTransition('published', 'archive')).toBe(true);
    expect(CONTENT_TRANSITIONS.undo_archive).toMatchObject({ from: ['archived'], to: 'archived_from', event: 'content.item.unarchived' });
    expect(CONTENT_TRANSITIONS.restore).toMatchObject({ from: ['archived'], to: 'draft', event: 'content.item.restored' });
    expect(CONTENT_TRANSITIONS.delete).toMatchObject({ from: CONTENT_STATUSES, to: 'tombstone', event: 'content.item.deleted' });
  });

  it('validates ContentCreateInput strictly: title 1-80, cta_label 1-40, cta_url iff open_link', () => {
    expect(ContentCreateInput.parse({ title: 'Story 1', format: 'story', cta_label: 'Buy now', cta_action: 'add_to_cart' })).toMatchObject({
      title: 'Story 1',
      format: 'story',
      cta_label: 'Buy now',
      cta_action: 'add_to_cart',
    });
    expect(
      ContentCreateInput.parse({
        title: 'Reel 1',
        format: 'reel',
        cta_label: 'Learn more',
        cta_action: 'open_link',
        cta_url: 'https://shop.example.com/p/1',
        cta_style: 'light',
      }),
    ).toMatchObject({ cta_action: 'open_link', cta_url: 'https://shop.example.com/p/1', cta_style: 'light' });

    // Unknown property rejected (strict)
    expect(ContentCreateInput.safeParse({ title: 'S', format: 'story', cta_label: 'Buy', cta_action: 'add_to_cart', extra: true }).success).toBe(false);
    // Title bounds (1..80)
    expect(ContentCreateInput.safeParse({ title: '', format: 'story', cta_label: 'Buy', cta_action: 'add_to_cart' }).success).toBe(false);
    expect(ContentCreateInput.safeParse({ title: 'a'.repeat(81), format: 'story', cta_label: 'Buy', cta_action: 'add_to_cart' }).success).toBe(false);
    // CTA label bounds (1..40)
    expect(ContentCreateInput.safeParse({ title: 'S', format: 'story', cta_label: '', cta_action: 'add_to_cart' }).success).toBe(false);
    expect(ContentCreateInput.safeParse({ title: 'S', format: 'story', cta_label: 'a'.repeat(41), cta_action: 'add_to_cart' }).success).toBe(false);
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', '/relative', 'ftp://x.com']) {
      expect(ContentCreateInput.safeParse({ title: 'S', format: 'story', cta_label: 'Go', cta_action: 'open_link', cta_url: bad }).success).toBe(false);
    }
    expect(ContentCreateInput.safeParse({ title: 'S', format: 'story', cta_label: 'Go', cta_action: 'open_link', cta_url: 'https://shop.example.com/sale' }).success).toBe(true);
    expect(ContentCreateInput.safeParse({ title: 'S', format: 'story', cta_label: 'Buy', cta_action: 'add_to_cart', cta_style: 'pill' }).success).toBe(false);
    // cta_url required for open_link and forbidden for add_to_cart / open_product
    expect(ContentCreateInput.safeParse({ title: 'S', format: 'story', cta_label: 'Go', cta_action: 'open_link' }).success).toBe(false);
    expect(ContentCreateInput.safeParse({ title: 'S', format: 'story', cta_label: 'Go', cta_action: 'open_link', cta_url: null }).success).toBe(false);
    expect(ContentCreateInput.safeParse({ title: 'S', format: 'story', cta_label: 'Buy', cta_action: 'add_to_cart', cta_url: 'https://example.com' }).success).toBe(false);
    expect(ContentCreateInput.safeParse({ title: 'S', format: 'story', cta_label: 'View', cta_action: 'open_product', cta_url: 'https://example.com' }).success).toBe(false);
  });

  it('parses a ContentItem response with v:1 and rejects unknown statuses or formats', () => {
    expect(ContentItem.parse(item)).toMatchObject({ v: 1, id: item.id, status: 'draft' });
    expect(ContentItem.safeParse({ ...item, status: 'ready' }).success).toBe(false);
    expect(ContentItem.safeParse({ ...item, format: 'carousel' }).success).toBe(false);
  });
});

describe('content list contracts (Story 3.2)', () => {
  it('maps tabs to statuses: drafts = draft, processing, failed; archived/deactivated/ended only under all', () => {
    expect(CONTENT_TABS).toEqual(['all', 'published', 'scheduled', 'drafts']);
    expect(TAB_STATUSES.all).toEqual(CONTENT_STATUSES);
    expect(TAB_STATUSES.drafts).toEqual(['draft', 'processing', 'failed']);
    expect(TAB_STATUSES.published).toEqual(['published']);
    expect(TAB_STATUSES.scheduled).toEqual(['scheduled']);
    for (const s of ['archived', 'deactivated', 'ended'] as const) {
      expect(CONTENT_TABS.filter((t) => TAB_STATUSES[t].includes(s))).toEqual(['all']);
    }
  });

  it('parses the list query with defaults and rejects bad values', () => {
    expect(ContentListQuery.parse({})).toEqual({ tab: 'all', sort: '-updated', page: 1, page_size: 10 });
    expect(ContentListQuery.parse({ tab: 'drafts', q: ' sale ', sort: 'title', page: '2', page_size: '25' })).toEqual({
      tab: 'drafts',
      q: 'sale',
      sort: 'title',
      page: 2,
      page_size: 25,
    });
    expect(CONTENT_SORTS).toEqual(['-updated', 'updated', 'title', '-title']);
    expect(ContentListQuery.safeParse({ tab: 'archived' }).success).toBe(false);
    expect(ContentListQuery.safeParse({ sort: 'name' }).success).toBe(false);
    expect(ContentListQuery.safeParse({ page: '0' }).success).toBe(false);
    expect(ContentListQuery.safeParse({ page_size: '7' }).success).toBe(false);
    expect(ContentListQuery.safeParse({ q: 'a'.repeat(101) }).success).toBe(false);
    expect(ContentListQuery.safeParse({ q: 'a'.repeat(100) }).success).toBe(true);
  });

  it('parses a list response with counts', () => {
    const parsed = ContentListResponse.parse({
      items: [{ ...item, status: 'failed' }],
      total: 1,
      page: 1,
      page_size: 10,
      counts: { all: 3, published: 1, scheduled: 0, drafts: 2 },
    });
    expect(parsed.v).toBe(1);
    expect(parsed.counts.drafts).toBe(2);
    expect(ContentListResponse.safeParse({ items: [], total: 0, page: 1, page_size: 10 }).success).toBe(false);
  });
});

describe('content editing contracts (Story 3.3)', () => {
  it('defines the CTA styles (ink default) and the store-domain problem slug', () => {
    expect(CTA_STYLES).toEqual(['ink', 'light', 'outline']);
    expect(DEFAULT_CTA_STYLE).toBe('ink');
    expect(CONTENT_CTA_URL_NOT_STORE_DOMAIN).toBe('cta-url-not-store-domain');
    expect(ContentItem.safeParse({ ...item, cta_style: 'outline' }).success).toBe(true);
    expect(ContentItem.safeParse({ ...item, cta_style: 'pill' }).success).toBe(false);
  });

  it('validates ContentUpdateInput as a strict, non-empty partial of the editable fields', () => {
    expect(ContentUpdateInput.parse({ title: 'New title' })).toEqual({ title: 'New title' });
    expect(ContentUpdateInput.parse({ cta_action: 'add_to_cart', cta_url: null })).toEqual({ cta_action: 'add_to_cart', cta_url: null });
    expect(ContentUpdateInput.safeParse({}).success).toBe(false);
    expect(ContentUpdateInput.safeParse({ status: 'published' }).success).toBe(false);
    expect(ContentUpdateInput.safeParse({ title: '' }).success).toBe(false);
    expect(ContentUpdateInput.safeParse({ title: 'a'.repeat(81) }).success).toBe(false);
    expect(ContentUpdateInput.safeParse({ cta_label: 'a'.repeat(41) }).success).toBe(false);
    expect(ContentUpdateInput.safeParse({ cta_url: 'javascript:alert(1)' }).success).toBe(false);
    expect(ContentUpdateInput.safeParse({ cta_style: 'pill' }).success).toBe(false);
    // The open-link rule is checked on the merged item, not on the patch alone.
    expect(ContentUpdateInput.safeParse({ cta_action: 'open_link' }).success).toBe(true);
    expect(ctaUrlMatchesAction({ cta_action: 'open_link', cta_url: null })).toBe(false);
    expect(ctaUrlMatchesAction({ cta_action: 'open_link', cta_url: 'https://a.b' })).toBe(true);
    expect(ctaUrlMatchesAction({ cta_action: 'add_to_cart', cta_url: null })).toBe(true);
    expect(ctaUrlMatchesAction({ cta_action: 'open_product', cta_url: 'https://a.b' })).toBe(false);
  });

  it('isStoreDomainUrl accepts the store host and its subdomains over http(s) only', () => {
    const domains = ['demo.salla.sa'];
    expect(isStoreDomainUrl('https://demo.salla.sa/p/1', domains)).toBe(true);
    expect(isStoreDomainUrl('http://demo.salla.sa', domains)).toBe(true);
    expect(isStoreDomainUrl('https://www.demo.salla.sa/p', domains)).toBe(true);
    expect(isStoreDomainUrl('https://DEMO.Salla.SA./x', domains)).toBe(true);
    expect(isStoreDomainUrl('https://evil.com/x', domains)).toBe(false);
    expect(isStoreDomainUrl('https://demo.salla.sa.evil.com/x', domains)).toBe(false);
    expect(isStoreDomainUrl('https://evildemo.salla.sa/x', domains)).toBe(false);
    expect(isStoreDomainUrl('https://user:pw@demo.salla.sa/x', domains)).toBe(false);
    expect(isStoreDomainUrl('ftp://demo.salla.sa/x', domains)).toBe(false);
    expect(isStoreDomainUrl('javascript:alert(1)//demo.salla.sa', domains)).toBe(false);
    expect(isStoreDomainUrl('not a url', domains)).toBe(false);
    expect(isStoreDomainUrl('https://demo.salla.sa/x', [])).toBe(false);
    expect(isStoreDomainUrl('https://shop.example.com/x', ['https://shop.example.com/', 'other.sa'])).toBe(true);
    expect(isStoreDomainUrl('https://shop.example.com/x', ['', ' '])).toBe(false);
  });
});

describe('content product link contracts (Story 3.4)', () => {
  const productId = '019a473a-0000-7000-8000-0000000000aa';
  const summary = {
    id: productId,
    name: 'زيت العود',
    image_url: null,
    price_minor: 15000,
    sale_price_minor: null,
    currency: 'SAR',
    availability: 'out_of_stock',
    has_required_options: true,
    deleted: false,
  };

  it('accepts product_id (uuid or null) on create and update, and nothing else', () => {
    const base = { title: 'S', format: 'story', cta_label: 'Buy', cta_action: 'add_to_cart' };
    expect(ContentCreateInput.parse({ ...base, product_id: productId }).product_id).toBe(productId);
    expect(ContentCreateInput.safeParse({ ...base, product_id: null }).success).toBe(true);
    expect(ContentCreateInput.safeParse({ ...base, product_id: 'p1' }).success).toBe(false);
    expect(ContentUpdateInput.parse({ product_id: null })).toEqual({ product_id: null });
    expect(ContentUpdateInput.safeParse({ product_id: productId }).success).toBe(true);
    expect(ContentUpdateInput.safeParse({ product_id: 42 }).success).toBe(false);
  });

  it('carries the product summary (or null) on a ContentItem and the problem slug', () => {
    expect(CONTENT_PRODUCT_NOT_LINKABLE).toBe('product-not-linkable');
    expect(ContentItem.parse({ ...item, product: summary }).product).toEqual(ContentProductSummary.parse(summary));
    expect(ContentItem.safeParse({ ...item, product: { ...summary, deleted: undefined } }).success).toBe(false);
    expect(ContentItem.safeParse({ ...item, product: { ...summary, availability: 'many' } }).success).toBe(false);
    const withoutProduct: Record<string, unknown> = { ...item };
    delete withoutProduct.product;
    expect(ContentItem.safeParse(withoutProduct).success).toBe(false);
  });

  it('lets content.item.edited name product_id as a changed field', () => {
    expect(ContentFields.keyof().options).toContain('product_id');
    const payload = { v: 1, store_id: productId, content_id: item.id, status: 'draft', changed: ['product_id'] };
    expect(EVENT_CATALOG['content.item.edited'].schema.safeParse(payload).success).toBe(true);
  });
});

describe('content slide contracts (Story 3.6)', () => {
  const a1 = '019a473a-0000-7000-8000-0000000000b1';
  const a2 = '019a473a-0000-7000-8000-0000000000b2';
  const base = { title: 'S', format: 'story', cta_label: 'Buy', cta_action: 'add_to_cart' };

  it('accepts an ordered slide list of unique assets up to SLIDES_MAX on create and update', () => {
    const slides = [
      { media_asset_id: a1, alt_text: 'Red abaya' },
      { media_asset_id: a2, alt_text: null },
    ];
    expect(ContentCreateInput.parse({ ...base, slides }).slides).toEqual(slides);
    expect(ContentUpdateInput.parse({ slides: [] })).toEqual({ slides: [] });
    expect(ContentUpdateInput.safeParse({ slides: [slides[0], slides[0]] }).success).toBe(false);
    expect(ContentUpdateInput.safeParse({ slides: [{ media_asset_id: 'x', alt_text: null }] }).success).toBe(false);
    expect(ContentUpdateInput.safeParse({ slides: [{ media_asset_id: a1 }] }).success).toBe(false);
    expect(ContentUpdateInput.safeParse({ slides: [{ media_asset_id: a1, alt_text: 'x'.repeat(SLIDE_ALT_MAX + 1) }] }).success).toBe(false);
    expect(ContentUpdateInput.safeParse({ slides: [{ media_asset_id: a1, alt_text: null, position: 1 }] }).success).toBe(false);
    const many = Array.from({ length: SLIDES_MAX + 1 }, (_, i) => ({ media_asset_id: `019a473a-0000-7000-8000-${String(i).padStart(12, '0')}`, alt_text: null }));
    expect(SLIDES_MAX).toBe(10);
    expect(ContentUpdateInput.safeParse({ slides: many.slice(0, SLIDES_MAX) }).success).toBe(true);
    expect(ContentUpdateInput.safeParse({ slides: many }).success).toBe(false);
  });

  it('requires alt text on image slides only', () => {
    expect(CONTENT_SLIDE_ALT_REQUIRED).toBe('slide-alt-text-required');
    expect(slideAltTextOk('image', 'Red abaya')).toBe(true);
    expect(slideAltTextOk('image', '   ')).toBe(false);
    expect(slideAltTextOk('image', null)).toBe(false);
    expect(slideAltTextOk('image', 'x'.repeat(SLIDE_ALT_MAX + 1))).toBe(false);
    expect(slideAltTextOk('video', null)).toBe(true);
    expect(slideAltTextOk('video', '')).toBe(true);
  });

  it('carries the slides with asset kind and status on a ContentItem', () => {
    const slide = { id: a2, media_asset_id: a1, kind: 'image', alt_text: 'Red', status: 'failed', failure_reason: 'type_mismatch' };
    expect(ContentItem.parse({ ...item, slides: [slide] }).slides).toEqual([{ ...slide, source_url: null }]);
    const imported = { ...slide, status: 'importing', failure_reason: null, source_url: 'https://cdn.example.com/a.jpg' };
    expect(ContentItem.parse({ ...item, slides: [imported] }).slides).toEqual([imported]);
    expect(ContentItem.safeParse({ ...item, slides: [{ ...slide, status: 'ready' }] }).success).toBe(false);
    const withoutSlides: Record<string, unknown> = { ...item };
    delete withoutSlides.slides;
    expect(ContentItem.safeParse(withoutSlides).success).toBe(false);
    expect(ContentFields.keyof().options).toContain('slides');
  });
});
