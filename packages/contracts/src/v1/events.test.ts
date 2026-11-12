import { describe, expect, it } from 'vitest';
import { CONTENT_EVENT_NAMES } from './content.js';
import { EVENT_CATALOG, EVENT_NAME_PATTERN, EVENT_OWNERS, EventEnvelope, isEventName, type EventName, type EventPayload } from './events.js';

describe('event catalog', () => {
  it.each(Object.keys(EVENT_CATALOG))('%s is named <module>.<entity>.<past-verb>, owned by its first segment, with a v1 schema', (name) => {
    const def = EVENT_CATALOG[name as EventName];
    expect(name).toMatch(EVENT_NAME_PATTERN);
    expect(EVENT_OWNERS).toContain(def.owner);
    expect(name.split('.')[0]).toBe(def.owner);
    expect(def.schema.safeParse({}).success).toBe(false);
  });

  it('validates a payload against its v1 schema and rejects a wrong version', () => {
    const schema = EVENT_CATALOG['integration.store.installed'].schema;
    const ok: EventPayload<'integration.store.installed'> = { v: 1, store_id: '11111111-1111-4111-8111-111111111111', install_epoch: 1 };
    expect(schema.safeParse(ok).success).toBe(true);
    expect(schema.safeParse({ ...ok, v: 2 }).success).toBe(false);
  });

  it('rejects unknown names at compile time and at runtime', () => {
    // @ts-expect-error not in the catalog
    const bad: EventName = 'integration.store.exploded';
    expect(isEventName(bad)).toBe(false);
    expect(isEventName('integration.store.installed')).toBe(true);
  });

  it('envelope requires a uuid event id and a well-formed name', () => {
    const base = { v: 1, trace_id: 't', event_id: '11111111-1111-4111-8111-111111111111', name: 'a.b.c', occurred_at: new Date().toISOString(), payload: {} };
    expect(EventEnvelope.safeParse(base).success).toBe(true);
    expect(EventEnvelope.safeParse({ ...base, name: 'nope' }).success).toBe(false);
  });
});

describe('integration.store.disconnected', () => {
  it('requires a known reason', () => {
    const schema = EVENT_CATALOG['integration.store.disconnected'].schema;
    const ok = { v: 1, store_id: '11111111-1111-4111-8111-111111111111', install_epoch: 1, reason: 'refresh_rejected' };
    expect(schema.safeParse(ok).success).toBe(true);
    expect(schema.safeParse({ ...ok, reason: 'because' }).success).toBe(false);
  });
});

describe('store lifecycle events', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  it('uninstalled carries the grace end; reinstalled and purged carry the epoch', () => {
    expect(EVENT_CATALOG['integration.store.uninstalled'].schema.safeParse({ v: 1, store_id: id, install_epoch: 1, grace_ends_at: '2026-11-10T10:00:00.000Z' }).success).toBe(true);
    expect(EVENT_CATALOG['integration.store.uninstalled'].schema.safeParse({ v: 1, store_id: id, install_epoch: 1 }).success).toBe(false);
    for (const name of ['integration.store.reinstalled', 'integration.store.reconnected', 'integration.store.purged'] as const) {
      expect(EVENT_CATALOG[name].owner).toBe('integration');
      expect(EVENT_CATALOG[name].schema.safeParse({ v: 1, store_id: id, install_epoch: 2 }).success).toBe(true);
      expect(EVENT_CATALOG[name].schema.safeParse({ v: 1, store_id: id }).success).toBe(false);
    }
  });
});

describe('catalog events', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const run = '22222222-2222-4222-8222-222222222222';
  it('sync.requested carries the store and the run', () => {
    const schema = EVENT_CATALOG['catalog.sync.requested'].schema;
    expect(EVENT_CATALOG['catalog.sync.requested'].owner).toBe('catalog');
    expect(schema.safeParse({ v: 1, store_id: id, run_id: run }).success).toBe(true);
    expect(schema.safeParse({ v: 1, store_id: id }).success).toBe(false);
    expect(schema.safeParse({ v: 1, store_id: id, run_id: 'x' }).success).toBe(false);
  });
  it('sync.completed carries the run and the created/updated counts', () => {
    const schema = EVENT_CATALOG['catalog.sync.completed'].schema;
    expect(schema.safeParse({ v: 1, store_id: id, run_id: run, created: 3, updated: 0, finished_at: '2026-11-01T10:00:00.000Z' }).success).toBe(true);
    expect(schema.safeParse({ v: 1, store_id: id, run_id: run, created: -1, updated: 0, finished_at: '2026-11-01T10:00:00.000Z' }).success).toBe(false);
    expect(schema.safeParse({ v: 1, store_id: id, run_id: run, created: 1, finished_at: '2026-11-01T10:00:00.000Z' }).success).toBe(false);
  });
  it('product.updated carries the changed fields and the visible snapshot', () => {
    const schema = EVENT_CATALOG['catalog.product.updated'].schema;
    const ok = { v: 1, store_id: id, product_id: run, external_id: 'p1', changed: ['price_minor'], name: 'A', image_url: null, price_minor: 1250, sale_price_minor: null, currency: 'SAR', availability: 'low', has_required_options: false, visible: true };
    expect(EVENT_CATALOG['catalog.product.updated'].owner).toBe('catalog');
    expect(schema.safeParse(ok).success).toBe(true);
    expect(schema.safeParse({ ...ok, changed: [] }).success).toBe(false);
    expect(schema.safeParse({ ...ok, changed: ['stock'] }).success).toBe(false);
    expect(schema.safeParse({ ...ok, availability: 'gone' }).success).toBe(false);
    expect(schema.safeParse({ ...ok, product_id: 'x' }).success).toBe(false);
  });
  it('product.deleted carries the store, product and external id', () => {
    const schema = EVENT_CATALOG['catalog.product.deleted'].schema;
    const ok = { v: 1, store_id: id, product_id: run, external_id: 'p1' };
    expect(EVENT_CATALOG['catalog.product.deleted'].owner).toBe('catalog');
    expect(schema.safeParse(ok).success).toBe(true);
    expect(schema.safeParse({ ...ok, external_id: '' }).success).toBe(false);
    expect(schema.safeParse({ ...ok, product_id: 'x' }).success).toBe(false);
    expect(schema.safeParse({ ...ok, v: 2 }).success).toBe(false);
    expect(schema.safeParse({ v: 1, store_id: id, product_id: run }).success).toBe(false);
  });
});

describe('content events', () => {
  const storeId = '11111111-1111-4111-8111-111111111111';
  const contentId = '22222222-2222-4222-8222-222222222222';

  it('catalogues all 14 content events (13 lifecycle + edited) under owner content', () => {
    expect(CONTENT_EVENT_NAMES).toHaveLength(14);
    for (const name of CONTENT_EVENT_NAMES) {
      expect(EVENT_CATALOG[name].owner).toBe('content');
    }
    expect(EVENT_CATALOG['content.item.created'].schema.safeParse({ v: 1, store_id: storeId, content_id: contentId, from: null, to: 'draft' }).success).toBe(true);
    for (const name of CONTENT_EVENT_NAMES.filter((n) => n !== 'content.item.created' && n !== 'content.item.deleted' && n !== 'content.item.edited')) {
      expect(EVENT_CATALOG[name].schema.safeParse({ v: 1, store_id: storeId, content_id: contentId, from: 'draft', to: 'published' }).success).toBe(true);
      expect(EVENT_CATALOG[name].schema.safeParse({ v: 1, store_id: storeId, content_id: contentId, from: 'draft', to: 'ready' }).success).toBe(false);
    }
    expect(EVENT_CATALOG['content.item.deleted'].schema.safeParse({ v: 1, store_id: storeId, content_id: contentId, from: 'draft' }).success).toBe(true);
    expect(EVENT_CATALOG['content.item.deleted'].schema.safeParse({ v: 1, store_id: storeId, content_id: contentId, from: 'draft', to: 'archived' }).success).toBe(false);
  });

  it('content.item.edited carries the unchanged status and the changed field names', () => {
    const schema = EVENT_CATALOG['content.item.edited'].schema;
    const ok = { v: 1, store_id: storeId, content_id: contentId, status: 'published', changed: ['title', 'cta_url'] };
    expect(schema.safeParse(ok).success).toBe(true);
    expect(schema.safeParse({ ...ok, changed: [] }).success).toBe(false);
    expect(schema.safeParse({ ...ok, changed: ['status'] }).success).toBe(false);
    expect(schema.safeParse({ ...ok, from: 'draft' }).success).toBe(false);
  });
});
