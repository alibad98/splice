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
} from './content.js';

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
        cta_style: 'pill',
      }),
    ).toMatchObject({ cta_action: 'open_link', cta_url: 'https://shop.example.com/p/1', cta_style: 'pill' });

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
    expect(ContentCreateInput.safeParse({ title: 'S', format: 'story', cta_label: 'Buy', cta_action: 'add_to_cart', cta_style: 'a'.repeat(41) }).success).toBe(false);
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
