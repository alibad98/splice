// Story 3.1 composition tests: live Postgres (non-owner RLS role, real pg-boss outbox), ContentLifecycle state machine
// exhaustive (status, action) matrix, and the merchant content API over HTTP.
import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CONTENT_ACTIONS,
  CONTENT_EVENT_NAMES,
  CONTENT_CTA_URL_NOT_STORE_DOMAIN,
  CONTENT_INVALID_LAYOUT,
  CONTENT_INVALID_TRANSITION,
  CONTENT_PRODUCT_NOT_LINKABLE,
  CONTENT_UNSUPPORTED_FORMAT,
  CONTENT_SLIDE_ALT_REQUIRED,
  CONTENT_STATUSES,
  MEDIA_NOT_ATTACHABLE,
  CONTENT_TRANSITIONS,
  ContentItem,
  ContentListResponse,
  EVENT_QUEUE,
  ProductListResponse,
  canTransition,
  type ContentAction,
  type ContentStatus,
  type EventEnvelope,
} from '@slips/contracts';
import { ensureTestAppRole, runMigrations, withStoreContext } from '@slips/db';
import { PinoTelemetry } from '../adapters/telemetry/pino-telemetry.js';
import { EventHandlerRegistry, eventDispatcher } from '../events/dispatcher.js';
import { uuidv7 } from '../events/outbox.js';
import { grantEventPublishing } from '../events/queue-grants.js';
import { createHttpApp } from '../http.js';
import type { SessionConfig } from '../infra.module.js';
import { ContentLifecycle, InvalidTransitionError, PublishEligibilityError } from '../modules/content/content-lifecycle.js';
import { contentStoreData } from '../modules/content/content.lifecycle.js';
import { MediaService } from '../modules/media/media.service.js';
import { SessionService } from '../modules/session/session.service.js';
import { registerContentEventHandlers } from '../worker/content-jobs.js';

const ADMIN_URL = process.env.CONTENT_TEST_ADMIN_URL ?? `postgres://slips:slips@127.0.0.1:${process.env.TEST_DATABASE_PORT ?? '5433'}/slips`;
const appUrl = new URL(ADMIN_URL);
appUrl.username = 'slips_it_content_comp';
appUrl.password = 'it_content_comp_pw';
const APP_URL = appUrl.toString();
const SCHEMA = 'pgboss_content_test';
const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const lines: string[] = [];
const telemetry = new PinoTelemetry({ role: 'http', level: 'debug', stream: { write: (l: string) => void lines.push(l) } });

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 4 });
let app: pg.Pool;
let boss: PgBoss;
let lifecycle: ContentLifecycle;

const validCreateInput = {
  placements: [{ type: 'home' as const }],
  title: 'عباية العيد الجديدة',
  format: 'story' as const,
  cta_label: 'أضف للسلة',
  cta_action: 'add_to_cart' as const,
};

/** Sequence of allowed transitions from a fresh `draft` item to reach any target `ContentStatus`. */
const PATH_TO_STATUS: Readonly<Record<ContentStatus, readonly ContentAction[]>> = {
  draft: [],
  processing: ['start_processing'],
  failed: ['start_processing', 'fail_processing'],
  scheduled: ['schedule'],
  published: ['publish'],
  ended: ['publish', 'end'],
  archived: ['publish', 'archive'],
  deactivated: ['publish', 'deactivate'],
};

const rowById = async (id: string) =>
  (await admin.query<Record<string, unknown>>('select * from content_items where id = $1', [id])).rows[0];

const eventsForContent = async (storeId: string, contentId: string): Promise<EventEnvelope[]> =>
  (
    await admin.query<{ data: EventEnvelope }>(
      `select data from ${SCHEMA}.job where name = $1 and data->>'store_id' = $2 and data->'payload'->>'content_id' = $3 order by created_on, id`,
      [EVENT_QUEUE, storeId, contentId],
    )
  ).rows.map((r) => r.data);

async function seedItemInStatus(storeId: string, target: ContentStatus) {
  return withStoreContext(app, storeId, async (tx) => {
    let row = await lifecycle.create(tx, storeId, validCreateInput);
    for (const step of PATH_TO_STATUS[target]) {
      row = await lifecycle.apply(tx, storeId, row.id, step);
    }
    return row;
  });
}

beforeAll(async () => {
  await runMigrations(admin);
  await ensureTestAppRole(admin, 'slips_it_content_comp', 'it_content_comp_pw');
  app = new pg.Pool({ connectionString: APP_URL, max: 6 });
  await admin.query(`drop schema if exists ${SCHEMA} cascade`);
  boss = new PgBoss({ connectionString: ADMIN_URL, schema: SCHEMA });
  await boss.start();
  await boss.createQueue(EVENT_QUEUE);
  await grantEventPublishing(admin, telemetry, EVENT_QUEUE, SCHEMA, 'slips_app');
  lifecycle = new ContentLifecycle(boss, telemetry);
});

afterAll(async () => {
  await boss?.stop({ graceful: false });
  await admin.query(`drop schema if exists ${SCHEMA} cascade`);
  await app?.end();
  await admin.end();
});

describe('ContentLifecycle exhaustive (status, action) transition matrix', () => {
  it.each([
    ['draft', 'publish'], ['draft', 'schedule'], ['scheduled', 'go_live'],
    ['deactivated', 'reactivate'], ['archived', 'undo_archive'],
  ] as const)('Home admission: %s + %s refuses atomically, then succeeds after Home is saved', async (status, action) => {
    const storeId = randomUUID();
    const item = await seedItemInStatus(storeId, status);
    await withStoreContext(app, storeId, async tx => {
      // Archived fields are read-only: remove via the owned command before archiving instead.
      if (status === 'archived') {
        await lifecycle.apply(tx, storeId, item.id, 'undo_archive');
        await lifecycle.edit(tx, storeId, item.id, { placements: [] });
        await lifecycle.apply(tx, storeId, item.id, 'archive');
      } else await lifecycle.edit(tx, storeId, item.id, { placements: [] });
    });
    const before = await rowById(item.id);
    const events = await eventsForContent(storeId, item.id);
    await expect(withStoreContext(app, storeId, tx => lifecycle.apply(tx, storeId, item.id, action))).rejects.toMatchObject({ reason: 'no_placement' });
    expect(await rowById(item.id)).toEqual(before);
    expect(await eventsForContent(storeId, item.id)).toEqual(events);
    if (status !== 'archived') {
      await withStoreContext(app, storeId, tx => lifecycle.edit(tx, storeId, item.id, { placements: [{ type: 'home' }] }));
      expect((await withStoreContext(app, storeId, tx => lifecycle.apply(tx, storeId, item.id, action))).status).toBe(action === 'schedule' ? 'scheduled' : 'published');
    }
  });

  it.each(['scheduled', 'published'] as const)('Undo and reactivate resolve %s before checking admission', async target => {
    const storeId = randomUUID();
    const item = await seedItemInStatus(storeId, target);
    await withStoreContext(app, storeId, async tx => {
      await lifecycle.edit(tx, storeId, item.id, { placements: [] });
      await lifecycle.apply(tx, storeId, item.id, 'deactivate');
    });
    await expect(withStoreContext(app, storeId, tx => lifecycle.apply(tx, storeId, item.id, 'reactivate'))).rejects.toBeInstanceOf(PublishEligibilityError);
    await withStoreContext(app, storeId, async tx => {
      await lifecycle.edit(tx, storeId, item.id, { placements: [{ type: 'home' }] });
      await lifecycle.apply(tx, storeId, item.id, 'reactivate');
      await lifecycle.edit(tx, storeId, item.id, { placements: [] });
      await lifecycle.apply(tx, storeId, item.id, 'archive');
    });
    const before = await rowById(item.id);
    const events = await eventsForContent(storeId, item.id);
    await expect(withStoreContext(app, storeId, tx => lifecycle.apply(tx, storeId, item.id, 'undo_archive'))).rejects.toBeInstanceOf(PublishEligibilityError);
    expect(await rowById(item.id)).toEqual(before);
    expect(await eventsForContent(storeId, item.id)).toEqual(events);
  });

  it.each([
    ['draft', 'publish'], ['draft', 'schedule'], ['scheduled', 'go_live'],
    ['deactivated', 'reactivate'], ['archived', 'undo_archive'],
  ] as const)('Reel admission (4.2 pilot): %s + %s refuses atomically with unsupported_format, even with Home and processed media', async (status, action) => {
    const storeId = randomUUID();
    const item = await seedItemInStatus(storeId, status);
    // Live items can not be edited into Reels; set the format directly to reach the admission check.
    await admin.query("update content_items set format = 'reel' where id = $1", [item.id]);
    const before = await rowById(item.id);
    const events = await eventsForContent(storeId, item.id);
    await expect(withStoreContext(app, storeId, tx => lifecycle.apply(tx, storeId, item.id, action))).rejects.toMatchObject({ name: 'PublishEligibilityError', reason: 'unsupported_format' });
    expect(await rowById(item.id)).toEqual(before);
    expect(await eventsForContent(storeId, item.id)).toEqual(events);
  });

  it('Reel admission (4.2 pilot): Undo and reactivate into Scheduled or Published refuse a Reel, a Story still returns', async () => {
    const storeId = randomUUID();
    for (const target of ['scheduled', 'published'] as const) {
      const item = await seedItemInStatus(storeId, target);
      await withStoreContext(app, storeId, tx => lifecycle.apply(tx, storeId, item.id, 'deactivate'));
      await admin.query("update content_items set format = 'reel' where id = $1", [item.id]);
      const before = await rowById(item.id);
      const events = await eventsForContent(storeId, item.id);
      await expect(withStoreContext(app, storeId, tx => lifecycle.apply(tx, storeId, item.id, 'reactivate'))).rejects.toMatchObject({ reason: 'unsupported_format' });
      expect(await rowById(item.id)).toEqual(before);
      expect(await eventsForContent(storeId, item.id)).toEqual(events);
      await withStoreContext(app, storeId, tx => lifecycle.edit(tx, storeId, item.id, { format: 'story' }));
      expect((await withStoreContext(app, storeId, tx => lifecycle.apply(tx, storeId, item.id, 'reactivate'))).status).toBe(target);
    }
  });

  it('Layout default (4.2 pilot): an omitted layout reads the integration default once; a sent or saved layout never does', async () => {
    const storeId = randomUUID();
    const defaults = { getDisplayDefaults: vi.fn(async () => ({ story_layout: 'ring' as const })) };
    const withDefaults = new ContentLifecycle(boss, telemetry, undefined, defaults);
    const created = await withStoreContext(app, storeId, tx => withDefaults.create(tx, storeId, validCreateInput));
    expect(defaults.getDisplayDefaults).toHaveBeenCalledTimes(1);
    expect(defaults.getDisplayDefaults).toHaveBeenCalledWith(storeId);
    expect((await admin.query('select layout from placements where content_id = $1', [created.id])).rows).toEqual([{ layout: 'ring' }]);
    await withStoreContext(app, storeId, tx => withDefaults.create(tx, storeId, { ...validCreateInput, placements: [{ type: 'home', layout: 'ring' }] }));
    const events = await eventsForContent(storeId, created.id);
    await withStoreContext(app, storeId, tx => withDefaults.edit(tx, storeId, created.id, { placements: [{ type: 'home' }] }));
    await withStoreContext(app, storeId, tx => withDefaults.edit(tx, storeId, created.id, { placements: [{ type: 'home', layout: 'ring' }] }));
    expect(defaults.getDisplayDefaults).toHaveBeenCalledTimes(1);
    // Re-sending the saved Home (with or without its layout) is no change: nothing written, no event.
    expect(await eventsForContent(storeId, created.id)).toEqual(events);
    // Without an integration owner (e.g. the worker before wiring) the fallback is Ring.
    const plain = await withStoreContext(app, storeId, tx => lifecycle.create(tx, storeId, validCreateInput));
    expect((await admin.query('select layout from placements where content_id = $1', [plain.id])).rows).toEqual([{ layout: 'ring' }]);
  });

  const pairs: Array<[ContentStatus, ContentAction]> = CONTENT_STATUSES.flatMap((status) =>
    CONTENT_ACTIONS.map((action): [ContentStatus, ContentAction] => [status, action]),
  );

  it.each(pairs)('from %s + %s matches CONTENT_TRANSITIONS', async (status, action) => {
    const storeId = randomUUID();
    const seeded = await seedItemInStatus(storeId, status);
    const beforeEvents = await eventsForContent(storeId, seeded.id);
    const beforeRow = await rowById(seeded.id);
    const allowed = canTransition(status, action);

    if (!allowed) {
      await expect(
        withStoreContext(app, storeId, (tx) => lifecycle.apply(tx, storeId, seeded.id, action)),
      ).rejects.toBeInstanceOf(InvalidTransitionError);
      expect(await rowById(seeded.id)).toEqual(beforeRow);
      expect(await eventsForContent(storeId, seeded.id)).toHaveLength(beforeEvents.length);
      return;
    }

    const updated = await withStoreContext(app, storeId, (tx) => lifecycle.apply(tx, storeId, seeded.id, action));
    const afterEvents = await eventsForContent(storeId, seeded.id);
    expect(afterEvents).toHaveLength(beforeEvents.length + 1);
    const lastEvent = afterEvents.at(-1)!;
    const def = CONTENT_TRANSITIONS[action];
    expect(lastEvent.name).toBe(def.event);

    if (action === 'delete') {
      expect(updated.deletedAt).toBeInstanceOf(Date);
      expect(lastEvent.payload).toEqual({
        v: 1,
        store_id: storeId,
        content_id: seeded.id,
        from: status,
      });
      return;
    }

    const expectedTo: ContentStatus =
      def.to === 'reactivate_to'
        ? (seeded.reactivateTo as ContentStatus)
        : def.to === 'archived_from'
          ? (seeded.archivedFrom as ContentStatus)
          : (def.to as ContentStatus);

    expect(updated.status).toBe(expectedTo);
    expect(lastEvent.payload).toEqual({
      v: 1,
      store_id: storeId,
      content_id: seeded.id,
      from: status,
      to: expectedTo,
    });
  });

  it('reactivate returns a scheduled item that was deactivated back to scheduled', async () => {
    const storeId = randomUUID();
    const result = await withStoreContext(app, storeId, async (tx) => {
      const created = await lifecycle.create(tx, storeId, validCreateInput);
      const scheduled = await lifecycle.apply(tx, storeId, created.id, 'schedule');
      const deactivated = await lifecycle.apply(tx, storeId, created.id, 'deactivate');
      expect(deactivated.status).toBe('deactivated');
      expect(deactivated.reactivateTo).toBe('scheduled');
      const reactivated = await lifecycle.apply(tx, storeId, created.id, 'reactivate');
      return { scheduled, reactivated };
    });
    expect(result.reactivated.status).toBe('scheduled');
    expect(result.reactivated.reactivateTo).toBeNull();
    expect(result.reactivated.firstPublishedAt).toBeNull();
  });

  it('go_live from scheduled sets first_published_at to the passed now; deactivate + reactivate does not move it', async () => {
    const storeId = randomUUID();
    const t0 = new Date('2026-11-01T10:00:00.000Z');
    const t1 = new Date('2026-11-01T11:00:00.000Z');
    const t2 = new Date('2026-11-01T12:00:00.000Z');
    const t3 = new Date('2026-11-01T13:00:00.000Z');
    await withStoreContext(app, storeId, async (tx) => {
      const created = await lifecycle.create(tx, storeId, validCreateInput, t0);
      const scheduled = await lifecycle.apply(tx, storeId, created.id, 'schedule', t0);
      expect(scheduled.firstPublishedAt).toBeNull();
      const live = await lifecycle.apply(tx, storeId, created.id, 'go_live', t1);
      expect(live.status).toBe('published');
      expect(live.firstPublishedAt?.toISOString()).toBe(t1.toISOString());
      await lifecycle.apply(tx, storeId, created.id, 'deactivate', t2);
      const reactivated = await lifecycle.apply(tx, storeId, created.id, 'reactivate', t3);
      expect(reactivated.status).toBe('published');
      expect(reactivated.firstPublishedAt?.toISOString()).toBe(t1.toISOString());
    });
  });

  it('deactivated -> archive -> undo_archive returns to deactivated keeping reactivate_to; reactivate then returns to published', async () => {
    const storeId = randomUUID();
    await withStoreContext(app, storeId, async (tx) => {
      const item = await seedItemInStatus(storeId, 'deactivated');
      await lifecycle.apply(tx, storeId, item.id, 'archive');
      const undone = await lifecycle.apply(tx, storeId, item.id, 'undo_archive');
      expect(undone.status).toBe('deactivated');
      expect(undone.reactivateTo).toBe('published');
      const reactivated = await lifecycle.apply(tx, storeId, item.id, 'reactivate');
      expect(reactivated.status).toBe('published');
    });
  });

  it('deactivated -> archive -> restore returns to draft with reactivate_to and archived_from cleared', async () => {
    const storeId = randomUUID();
    await withStoreContext(app, storeId, async (tx) => {
      const item = await seedItemInStatus(storeId, 'deactivated');
      await lifecycle.apply(tx, storeId, item.id, 'archive');
      const restored = await lifecycle.apply(tx, storeId, item.id, 'restore');
      expect(restored.status).toBe('draft');
      expect(restored.reactivateTo).toBeNull();
      expect(restored.archivedFrom).toBeNull();
    });
  });
});

describe('merchant content API & I/O matrix', () => {
  let nest: INestApplication;
  let base: string;
  const sessionConfig: SessionConfig = {
    secret: randomBytes(32),
    secureCookies: true,
    embeddedTtlMs: 15 * 60_000,
    directMaxAgeMs: 3_600_000,
    idleMs: 3_600_000,
  };

  beforeAll(async () => {
    const httpPool = new pg.Pool({ connectionString: APP_URL, max: 4 });
    nest = await createHttpApp(
      { CORS_ORIGINS: 'http://localhost:3000', LOG_LEVEL: 'silent' },
      { pool: httpPool, events: boss, telemetry, session: sessionConfig },
    );
    await nest.listen(0);
    base = await nest.getUrl();
  });

  afterAll(async () => {
    await nest?.close();
  });

  const installedStore = async (): Promise<{ storeId: string; token: string }> => {
    const storeId = randomUUID();
    await admin.query(
      `insert into stores (id, store_id, platform, platform_store_id, name, synced_domains) values ($1, $1, 'salla', $2, 'Content Store', '{shop.example.com}') on conflict do nothing`,
      [storeId, `content-${storeId}`],
    );
    return { storeId, token: (await nest.get(SessionService).create(storeId, 'embedded')).token };
  };

  const request = async (token: string, method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return { res, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
  };

  it('Create: POST /v1/content with valid body returns 201 draft item with UUIDv7 id and emits content.item.created; invalid body answers 400 invalid_body', async () => {
    const { storeId, token } = await installedStore();
    const { res, body } = await request(token, 'POST', '/v1/content', validCreateInput);
    expect(res.status).toBe(201);
    const created = ContentItem.parse(body);
    expect(created.id).toMatch(UUID_V7_RE);
    expect(created).toMatchObject({
      v: 1,
      title: validCreateInput.title,
      format: 'story',
      cta_label: validCreateInput.cta_label,
      cta_action: 'add_to_cart',
      cta_url: null,
      cta_style: null,
      status: 'draft',
      archived_from: null,
      reactivate_to: null,
      auto_publish: false,
      first_published_at: null,
    });

    const events = await eventsForContent(storeId, created.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.name).toBe('content.item.created');
    expect(events[0]!.payload).toEqual({
      v: 1,
      store_id: storeId,
      content_id: created.id,
      from: null,
      to: 'draft',
    });

    // GET /v1/content/:id returns the created item
    const getRes = await request(token, 'GET', `/v1/content/${created.id}`);
    expect(getRes.res.status).toBe(200);
    expect(ContentItem.parse(getRes.body)).toEqual(created);

    // open_link with a URL and a style: both survive create, GET and the stored row
    const linkInput = { ...validCreateInput, cta_action: 'open_link', cta_url: 'https://shop.example.com/p/1', cta_style: 'light' };
    const linkRes = await request(token, 'POST', '/v1/content', linkInput);
    expect(linkRes.res.status).toBe(201);
    const linkItem = ContentItem.parse(linkRes.body);
    expect(linkItem).toMatchObject({ cta_action: 'open_link', cta_url: 'https://shop.example.com/p/1', cta_style: 'light' });
    const linkGet = await request(token, 'GET', `/v1/content/${linkItem.id}`);
    expect(ContentItem.parse(linkGet.body)).toEqual(linkItem);
    expect(await rowById(linkItem.id)).toMatchObject({ cta_url: 'https://shop.example.com/p/1', cta_style: 'light' });

    // Invalid bodies -> 400 invalid_body
    for (const bad of [
      { ...validCreateInput, title: '' },
      { ...validCreateInput, title: 'x'.repeat(81) },
      { ...validCreateInput, format: 'ready' },
      { ...validCreateInput, cta_label: '' },
      { ...validCreateInput, cta_action: 'open_link' },
      { ...validCreateInput, cta_action: 'add_to_cart', cta_url: 'https://shop.example.com' },
      { ...validCreateInput, unknown_field: 1 },
    ]) {
      const badRes = await request(token, 'POST', '/v1/content', bad);
      expect(badRes.res.status).toBe(400);
      expect(badRes.res.headers.get('content-type')).toContain('application/problem+json');
      expect(badRes.body).toMatchObject({ status: 400, code: 'invalid_body' });
    }
  });

  it('Allowed move, Undo archive, and Restore: archive on published sets archived + archived_from=published; undo-archive returns to published; restore moves archived to draft', async () => {
    const { storeId, token } = await installedStore();
    const published = await seedItemInStatus(storeId, 'published');

    // Allowed move: archive on a published item
    const archRes = await request(token, 'POST', `/v1/content/${published.id}/archive`);
    expect(archRes.res.status).toBe(200);
    const archived = ContentItem.parse(archRes.body);
    expect(archived).toMatchObject({ status: 'archived', archived_from: 'published' });

    let events = await eventsForContent(storeId, published.id);
    expect(events.at(-1)).toMatchObject({
      name: 'content.item.archived',
      payload: { v: 1, store_id: storeId, content_id: published.id, from: 'published', to: 'archived' },
    });

    // Undo archive: returns to published and emits content.item.unarchived
    const undoRes = await request(token, 'POST', `/v1/content/${published.id}/undo-archive`);
    expect(undoRes.res.status).toBe(200);
    const unarchived = ContentItem.parse(undoRes.body);
    expect(unarchived).toMatchObject({ status: 'published', archived_from: null });

    events = await eventsForContent(storeId, published.id);
    expect(events.at(-1)).toMatchObject({
      name: 'content.item.unarchived',
      payload: { v: 1, store_id: storeId, content_id: published.id, from: 'archived', to: 'published' },
    });

    // Archive again, then Restore -> draft
    await request(token, 'POST', `/v1/content/${published.id}/archive`);
    const restoreRes = await request(token, 'POST', `/v1/content/${published.id}/restore`);
    expect(restoreRes.res.status).toBe(200);
    const restored = ContentItem.parse(restoreRes.body);
    expect(restored).toMatchObject({ status: 'draft', archived_from: null });

    events = await eventsForContent(storeId, published.id);
    expect(events.at(-1)).toMatchObject({
      name: 'content.item.restored',
      payload: { v: 1, store_id: storeId, content_id: published.id, from: 'archived', to: 'draft' },
    });
  });

  it('Disallowed: restore on draft and archive on processing answer 409 problem type invalid-transition and leave row and outbox unchanged', async () => {
    const { storeId, token } = await installedStore();
    const draft = await seedItemInStatus(storeId, 'draft');
    const draftRowBefore = await rowById(draft.id);
    const draftEventsBefore = await eventsForContent(storeId, draft.id);

    const restoreDraft = await request(token, 'POST', `/v1/content/${draft.id}/restore`);
    expect(restoreDraft.res.status).toBe(409);
    expect(restoreDraft.res.headers.get('content-type')).toContain('application/problem+json');
    expect(restoreDraft.body).toMatchObject({
      type: CONTENT_INVALID_TRANSITION,
      status: 409,
      code: 'invalid_transition',
    });
    expect(await rowById(draft.id)).toEqual(draftRowBefore);
    expect(await eventsForContent(storeId, draft.id)).toHaveLength(draftEventsBefore.length);

    const processing = await seedItemInStatus(storeId, 'processing');
    const procRowBefore = await rowById(processing.id);
    const procEventsBefore = await eventsForContent(storeId, processing.id);

    const archiveProc = await request(token, 'POST', `/v1/content/${processing.id}/archive`);
    expect(archiveProc.res.status).toBe(409);
    expect(archiveProc.res.headers.get('content-type')).toContain('application/problem+json');
    expect(archiveProc.body).toMatchObject({
      type: CONTENT_INVALID_TRANSITION,
      status: 409,
      code: 'invalid_transition',
    });
    expect(await rowById(processing.id)).toEqual(procRowBefore);
    expect(await eventsForContent(storeId, processing.id)).toHaveLength(procEventsBefore.length);
  });

  it('First publish: first_published_at is set on the first transition into published and never moved across deactivate/reactivate or end/archive/restore/publish', async () => {
    const storeId = randomUUID();
    const t0 = new Date('2026-11-01T10:00:00.000Z');
    const t1 = new Date('2026-11-01T11:00:00.000Z');
    const t2 = new Date('2026-11-01T12:00:00.000Z');
    const t3 = new Date('2026-11-01T13:00:00.000Z');
    const t4 = new Date('2026-11-01T14:00:00.000Z');
    const t5 = new Date('2026-11-01T15:00:00.000Z');

    await withStoreContext(app, storeId, async (tx) => {
      const created = await lifecycle.create(tx, storeId, validCreateInput, t0);
      expect(created.firstPublishedAt).toBeNull();

      const firstPub = await lifecycle.apply(tx, storeId, created.id, 'publish', t1);
      expect(firstPub.firstPublishedAt?.toISOString()).toBe(t1.toISOString());

      const deactivated = await lifecycle.apply(tx, storeId, created.id, 'deactivate', t2);
      expect(deactivated.firstPublishedAt?.toISOString()).toBe(t1.toISOString());

      const reactivated = await lifecycle.apply(tx, storeId, created.id, 'reactivate', t3);
      expect(reactivated.status).toBe('published');
      expect(reactivated.firstPublishedAt?.toISOString()).toBe(t1.toISOString());

      const ended = await lifecycle.apply(tx, storeId, created.id, 'end', t4);
      expect(ended.firstPublishedAt?.toISOString()).toBe(t1.toISOString());

      await lifecycle.apply(tx, storeId, created.id, 'archive', t4);
      await lifecycle.apply(tx, storeId, created.id, 'restore', t4);
      const secondPub = await lifecycle.apply(tx, storeId, created.id, 'publish', t5);
      expect(secondPub.status).toBe('published');
      expect(secondPub.firstPublishedAt?.toISOString()).toBe(t1.toISOString());
    });
  });

  it('Delete: DELETE on any non-deleted item sets deleted_at, keeps the row, emits content.item.deleted, and makes later GET or DELETE answer 404', async () => {
    const { storeId, token } = await installedStore();
    const published = await seedItemInStatus(storeId, 'published');

    const delRes = await request(token, 'DELETE', `/v1/content/${published.id}`);
    expect(delRes.res.status).toBe(204);

    const dbRow = await rowById(published.id);
    expect(dbRow).toBeDefined();
    expect(dbRow!.deleted_at).toBeInstanceOf(Date);

    const events = await eventsForContent(storeId, published.id);
    expect(events.at(-1)).toMatchObject({
      name: 'content.item.deleted',
      payload: { v: 1, store_id: storeId, content_id: published.id, from: 'published' },
    });

    // Later GET -> 404
    const getRes = await request(token, 'GET', `/v1/content/${published.id}`);
    expect(getRes.res.status).toBe(404);

    // Delete twice -> 404
    const delAgain = await request(token, 'DELETE', `/v1/content/${published.id}`);
    expect(delAgain.res.status).toBe(404);
  });

  it('Cross-store: store B session cannot GET, archive, undo-archive, restore or DELETE store A item (answers 404)', async () => {
    const storeA = await installedStore();
    const storeB = await installedStore();
    const itemA = await seedItemInStatus(storeA.storeId, 'published');

    expect((await request(storeB.token, 'GET', `/v1/content/${itemA.id}`)).res.status).toBe(404);
    expect((await request(storeB.token, 'POST', `/v1/content/${itemA.id}/archive`)).res.status).toBe(404);
    expect((await request(storeB.token, 'POST', `/v1/content/${itemA.id}/undo-archive`)).res.status).toBe(404);
    expect((await request(storeB.token, 'POST', `/v1/content/${itemA.id}/restore`)).res.status).toBe(404);
    expect((await request(storeB.token, 'DELETE', `/v1/content/${itemA.id}`)).res.status).toBe(404);

    // Store A item is untouched
    expect((await request(storeA.token, 'GET', `/v1/content/${itemA.id}`)).res.status).toBe(200);
  });

  it('Malformed id: GET, archive and DELETE on a non-UUID id answer 404 content_not_found', async () => {
    const { token } = await installedStore();
    for (const [method, path] of [
      ['GET', '/v1/content/not-a-uuid'],
      ['POST', '/v1/content/not-a-uuid/archive'],
      ['DELETE', '/v1/content/not-a-uuid'],
    ] as const) {
      const { res, body } = await request(token, method, path);
      expect(res.status).toBe(404);
      expect(body).toMatchObject({ code: 'content_not_found' });
    }
  });

  it('Edit (Story 3.3): PATCH on a draft changes only the sent fields, keeps the status and emits content.item.edited once; a no-op writes nothing', async () => {
    const { storeId, token } = await installedStore();
    const created = ContentItem.parse((await request(token, 'POST', '/v1/content', validCreateInput)).body);

    const { res, body } = await request(token, 'PATCH', `/v1/content/${created.id}`, { cta_label: 'تسوّق الآن', cta_style: 'outline' });
    expect(res.status).toBe(200);
    const edited = ContentItem.parse(body);
    expect(edited).toMatchObject({ id: created.id, status: 'draft', title: created.title, cta_label: 'تسوّق الآن', cta_style: 'outline' });
    expect(Date.parse(edited.updated_at)).toBeGreaterThanOrEqual(Date.parse(created.updated_at));

    let events = await eventsForContent(storeId, created.id);
    expect(events.map((e) => e.name)).toEqual(['content.item.created', 'content.item.edited']);
    expect(events[1]!.payload).toEqual({ v: 1, store_id: storeId, content_id: created.id, status: 'draft', changed: ['cta_label', 'cta_style'] });

    // Sending the same values again changes nothing: no write, no event.
    const same = await request(token, 'PATCH', `/v1/content/${created.id}`, { cta_label: 'تسوّق الآن' });
    expect(same.res.status).toBe(200);
    expect(ContentItem.parse(same.body).updated_at).toBe(edited.updated_at);
    events = await eventsForContent(storeId, created.id);
    expect(events).toHaveLength(2);

    // XSS: merchant text is stored verbatim.
    const xss = '<img src=x onerror=alert(1)>';
    expect(ContentItem.parse((await request(token, 'PATCH', `/v1/content/${created.id}`, { title: xss })).body).title).toBe(xss);
    expect(await rowById(created.id)).toMatchObject({ title: xss });

    // Bad bodies: empty, unknown field, status, too long title -> 400 invalid_body.
    for (const bad of [{}, { status: 'published' }, { extra: 1 }, { title: 'x'.repeat(81) }, { cta_style: 'pill' }, { cta_action: 'open_link' }]) {
      const r = await request(token, 'PATCH', `/v1/content/${created.id}`, bad);
      expect(r.res.status).toBe(400);
      expect(r.body).toMatchObject({ status: 400, code: 'invalid_body' });
    }
    expect(await eventsForContent(storeId, created.id)).toHaveLength(3);
  });

  it('Edit: open_link URL must be on the store domain (subdomains allowed); switching the action away clears the URL', async () => {
    const { storeId, token } = await installedStore();
    const created = ContentItem.parse((await request(token, 'POST', '/v1/content', validCreateInput)).body);

    const off = await request(token, 'PATCH', `/v1/content/${created.id}`, { cta_action: 'open_link', cta_url: 'https://evil.com/x' });
    expect(off.res.status).toBe(422);
    expect(off.res.headers.get('content-type')).toContain('application/problem+json');
    expect(off.body).toMatchObject({ status: 422, type: CONTENT_CTA_URL_NOT_STORE_DOMAIN, code: 'cta_url_not_store_domain' });
    const offCreate = await request(token, 'POST', '/v1/content', { ...validCreateInput, cta_action: 'open_link', cta_url: 'https://evil.com/x' });
    expect(offCreate.res.status).toBe(422);
    expect(offCreate.body).toMatchObject({ type: CONTENT_CTA_URL_NOT_STORE_DOMAIN });

    const sub = await request(token, 'PATCH', `/v1/content/${created.id}`, { cta_action: 'open_link', cta_url: 'https://www.shop.example.com/p' });
    expect(sub.res.status).toBe(200);
    expect(ContentItem.parse(sub.body)).toMatchObject({ cta_action: 'open_link', cta_url: 'https://www.shop.example.com/p' });

    const back = await request(token, 'PATCH', `/v1/content/${created.id}`, { cta_action: 'add_to_cart' });
    expect(back.res.status).toBe(200);
    expect(ContentItem.parse(back.body)).toMatchObject({ cta_action: 'add_to_cart', cta_url: null });
    expect(await rowById(created.id)).toMatchObject({ cta_action: 'add_to_cart', cta_url: null });
    const events = await eventsForContent(storeId, created.id);
    expect(events.at(-1)!.payload).toMatchObject({ changed: ['cta_action', 'cta_url'] });
  });

  it('Edit: published items stay published; archived items answer 409 invalid-transition; other stores and deleted items answer 404', async () => {
    const a = await installedStore();
    const b = await installedStore();
    const published = await seedItemInStatus(a.storeId, 'published');
    // A legacy live Reel (set directly) can still be edited back to Story.
    await admin.query("update content_items set format = 'reel' where id = $1", [published.id]);
    const ok = await request(a.token, 'PATCH', `/v1/content/${published.id}`, { title: 'Live edit', format: 'story' });
    expect(ok.res.status).toBe(200);
    expect(ContentItem.parse(ok.body)).toMatchObject({ status: 'published', title: 'Live edit', format: 'story' });
    expect((await eventsForContent(a.storeId, published.id)).at(-1)!.payload).toMatchObject({ status: 'published', changed: ['title', 'format'] });

    const archived = await seedItemInStatus(a.storeId, 'archived');
    const before = await rowById(archived.id);
    const eventsBefore = await eventsForContent(a.storeId, archived.id);
    const conflict = await request(a.token, 'PATCH', `/v1/content/${archived.id}`, { title: 'Nope' });
    expect(conflict.res.status).toBe(409);
    expect(conflict.body).toMatchObject({ status: 409, type: CONTENT_INVALID_TRANSITION });
    expect(await rowById(archived.id)).toEqual(before);
    expect(await eventsForContent(a.storeId, archived.id)).toHaveLength(eventsBefore.length);

    const cross = await request(b.token, 'PATCH', `/v1/content/${published.id}`, { title: 'Hijack' });
    expect(cross.res.status).toBe(404);
    expect((await request(b.token, 'GET', `/v1/content/${published.id}`)).res.status).toBe(404);
    expect(await rowById(published.id)).toMatchObject({ title: 'Live edit' });

    await request(a.token, 'DELETE', `/v1/content/${published.id}`);
    expect((await request(a.token, 'PATCH', `/v1/content/${published.id}`, { title: 'Gone' })).res.status).toBe(404);
    expect((await request(a.token, 'PATCH', '/v1/content/not-a-uuid', { title: 'x' })).res.status).toBe(404);
  });

  it('Rollback: a transition whose transaction rolls back persists neither the status change nor the outbox event', async () => {
    const storeId = randomUUID();
    const draft = await seedItemInStatus(storeId, 'draft');
    const eventsBefore = await eventsForContent(storeId, draft.id);

    await expect(
      withStoreContext(app, storeId, async (tx) => {
        const moved = await lifecycle.apply(tx, storeId, draft.id, 'publish');
        expect(moved.status).toBe('published');
        throw new Error('simulated downstream failure');
      }),
    ).rejects.toThrow('simulated downstream failure');

    const rowAfter = await rowById(draft.id);
    expect(rowAfter!.status).toBe('draft');
    expect(rowAfter!.first_published_at).toBeNull();
    expect(await eventsForContent(storeId, draft.id)).toHaveLength(eventsBefore.length);
  });

  // ---- Story 3.2: GET /v1/content list matrix ----

  const seedTitled = async (storeId: string, title: string, target: ContentStatus = 'draft') =>
    withStoreContext(app, storeId, async (tx) => {
      let row = await lifecycle.create(tx, storeId, { ...validCreateInput, title });
      for (const step of PATH_TO_STATUS[target]) row = await lifecycle.apply(tx, storeId, row.id, step);
      return row;
    });

  const list = async (token: string, qs = '') => {
    const { res, body } = await request(token, 'GET', `/v1/content${qs}`);
    return { status: res.status, body, page: res.status === 200 ? ContentListResponse.parse(body) : null };
  };

  it('List tab filter: drafts lists draft, processing, failed; counts cover all 8 live items and never the deleted one', async () => {
    const { storeId, token } = await installedStore();
    for (const s of CONTENT_STATUSES) await seedItemInStatus(storeId, s);
    const gone = await seedItemInStatus(storeId, 'draft');
    await withStoreContext(app, storeId, (tx) => lifecycle.apply(tx, storeId, gone.id, 'delete'));

    const drafts = (await list(token, '?tab=drafts')).page!;
    expect(drafts.items.map((i) => i.status).sort()).toEqual(['draft', 'failed', 'processing']);
    expect(drafts.total).toBe(3);
    expect(drafts.counts).toEqual({ all: 8, published: 1, scheduled: 1, drafts: 3 });
    expect(drafts.items.map((i) => i.id)).not.toContain(gone.id);

    const all = (await list(token)).page!;
    expect(all.items.map((i) => i.status).sort()).toEqual([...CONTENT_STATUSES].sort());
    expect(all.counts).toEqual(drafts.counts);
    expect((await list(token, '?tab=published')).page!.items.map((i) => i.status)).toEqual(['published']);
    expect((await list(token, '?tab=scheduled')).page!.items.map((i) => i.status)).toEqual(['scheduled']);
  });

  it('List search: q matches title case-insensitively and leaves counts unchanged; q over 100 chars answers 400 invalid_query', async () => {
    const { storeId, token } = await installedStore();
    await seedTitled(storeId, 'Summer sale');
    await seedTitled(storeId, 'Reel');
    await seedTitled(storeId, '50%_off');

    const found = (await list(token, '?q=SALE')).page!;
    expect(found.items.map((i) => i.title)).toEqual(['Summer sale']);
    expect(found.total).toBe(1);
    expect(found.counts).toEqual({ all: 3, published: 0, scheduled: 0, drafts: 3 });
    // LIKE wildcards match literally
    expect((await list(token, `?q=${encodeURIComponent('%_')}`)).page!.items.map((i) => i.title)).toEqual(['50%_off']);

    const tooLong = await list(token, `?q=${'a'.repeat(101)}`);
    expect(tooLong.status).toBe(400);
    expect(tooLong.body).toMatchObject({ code: 'invalid_query' });
  });

  it('List sort + page: 12 items, sort=title page 2 of 10 returns items 11-12 with total 12; a page past the end is empty with the same total', async () => {
    const { storeId, token } = await installedStore();
    const titles = Array.from({ length: 12 }, (_, i) => `Item ${String(i + 1).padStart(2, '0')}`);
    for (const t of [...titles].reverse()) await seedTitled(storeId, t);

    const p2 = (await list(token, '?sort=title&page=2&page_size=10')).page!;
    expect(p2.items.map((i) => i.title)).toEqual(['Item 11', 'Item 12']);
    expect(p2).toMatchObject({ total: 12, page: 2, page_size: 10 });

    const desc = (await list(token, '?sort=-title')).page!;
    expect(desc.items[0]!.title).toBe('Item 12');
    // Default -updated: the most recently created (Item 01, seeded last) comes first
    expect((await list(token)).page!.items[0]!.title).toBe('Item 01');
    expect((await list(token, '?sort=updated')).page!.items[0]!.title).toBe('Item 12');

    const past = (await list(token, '?page=5&page_size=10')).page!;
    expect(past.items).toEqual([]);
    expect(past.total).toBe(12);
  });

  it('List cross-store and bad query: store B never sees store A rows or counts; bad tab, sort or page_size answers 400 invalid_query', async () => {
    const storeA = await installedStore();
    const storeB = await installedStore();
    await seedItemInStatus(storeA.storeId, 'published');
    const b = (await list(storeB.token)).page!;
    expect(b.items).toEqual([]);
    expect(b.counts).toEqual({ all: 0, published: 0, scheduled: 0, drafts: 0 });

    for (const qs of ['?tab=archived', '?sort=name', '?page_size=7', '?page=0']) {
      const bad = await list(storeA.token, qs);
      expect(bad.status, qs).toBe(400);
      expect(bad.body).toMatchObject({ code: 'invalid_query' });
    }
    expect((await fetch(`${base}/v1/content`)).status).toBe(401);
  });

  // ---- Story 3.4: product links ----
  const seedProduct = async (
    storeId: string,
    over: { name?: string; availability?: string; hasRequiredOptions?: boolean; deleted?: boolean; visible?: boolean } = {},
  ): Promise<string> =>
    (
      await admin.query<{ id: string }>(
        `insert into products (store_id, platform, external_id, name, image_url, price_minor, sale_price_minor, currency, tax_inclusive, availability, has_required_options, visible, source_updated_at, deleted_at)
         values ($1, 'salla', $2, $3, 'https://cdn.example.com/p.jpg', 15000, null, 'SAR', true, $4, $5, $6, now(), case when $7::boolean then now() else null end) returning id::text as id`,
        [storeId, `ext-${randomUUID()}`, over.name ?? 'Oud oil', over.availability ?? 'available', over.hasRequiredOptions ?? false, over.visible ?? true, over.deleted ?? false],
      )
    ).rows[0]!.id;
  const linkRow = async (contentId: string) =>
    (await admin.query<{ product_id: string | null }>('select product_id::text as product_id from content_product_links where content_id = $1', [contentId])).rows;
  const linkedCount = async (token: string, productId: string) => {
    const page = ProductListResponse.parse((await request(token, 'GET', '/v1/products?page_size=50')).body);
    return page.items.find((p) => p.id === productId)?.linked_content_count;
  };

  it('Link / Unlink (Story 3.4): PATCH product_id sets item.product, emits content.item.edited with product_id, and the Products count follows; unlink keeps the row with no product', async () => {
    const { storeId, token } = await installedStore();
    const productId = await seedProduct(storeId, { name: 'زيت العود' });
    const draft = await seedItemInStatus(storeId, 'draft');
    expect(await linkedCount(token, productId)).toBe(0);

    const linked = await request(token, 'PATCH', `/v1/content/${draft.id}`, { product_id: productId });
    expect(linked.res.status).toBe(200);
    const item = ContentItem.parse(linked.body);
    expect(item.status).toBe('draft');
    expect(item.product).toEqual({
      id: productId,
      name: 'زيت العود',
      image_url: 'https://cdn.example.com/p.jpg',
      price_minor: 15000,
      sale_price_minor: null,
      currency: 'SAR',
      availability: 'available',
      has_required_options: false,
      deleted: false,
    });
    expect((await eventsForContent(storeId, draft.id)).at(-1)).toMatchObject({ name: 'content.item.edited', payload: { status: 'draft', changed: ['product_id'] } });
    expect(await linkedCount(token, productId)).toBe(1);
    expect(ContentItem.parse((await request(token, 'GET', `/v1/content/${draft.id}`)).body).product?.id).toBe(productId);
    const listed = ContentListResponse.parse((await request(token, 'GET', '/v1/content')).body);
    expect(listed.items.find((i) => i.id === draft.id)?.product?.name).toBe('زيت العود');

    // Linking the same product again changes nothing.
    const eventsBefore = (await eventsForContent(storeId, draft.id)).length;
    await request(token, 'PATCH', `/v1/content/${draft.id}`, { product_id: productId });
    expect(await eventsForContent(storeId, draft.id)).toHaveLength(eventsBefore);

    const unlinked = await request(token, 'PATCH', `/v1/content/${draft.id}`, { product_id: null });
    expect(unlinked.res.status).toBe(200);
    expect(ContentItem.parse(unlinked.body).product).toBeNull();
    expect(await linkRow(draft.id)).toEqual([{ product_id: null }]);
    expect(await linkedCount(token, productId)).toBe(0);
    expect((await eventsForContent(storeId, draft.id)).at(-1)).toMatchObject({ payload: { changed: ['product_id'] } });
  });

  it('Link on create, out of stock and required options: POST with product_id links it; the summary carries the stored bucket and the options flag', async () => {
    const { storeId, token } = await installedStore();
    const productId = await seedProduct(storeId, { availability: 'out_of_stock', hasRequiredOptions: true });
    const created = await request(token, 'POST', '/v1/content', { ...validCreateInput, product_id: productId });
    expect(created.res.status).toBe(201);
    const item = ContentItem.parse(created.body);
    expect(item.product).toMatchObject({ id: productId, availability: 'out_of_stock', has_required_options: true, deleted: false });
    expect(await linkRow(item.id)).toEqual([{ product_id: productId }]);
  });

  it('Bad product: a deleted, other-store or unknown product_id answers 422 product-not-linkable and writes nothing', async () => {
    const { storeId, token } = await installedStore();
    const other = await installedStore();
    const deleted = await seedProduct(storeId, { deleted: true });
    const foreign = await seedProduct(other.storeId);
    const draft = await seedItemInStatus(storeId, 'draft');
    const rowBefore = await rowById(draft.id);
    const eventsBefore = (await eventsForContent(storeId, draft.id)).length;

    for (const productId of [deleted, foreign, randomUUID()]) {
      const res = await request(token, 'PATCH', `/v1/content/${draft.id}`, { title: 'Changed', product_id: productId });
      expect(res.res.status).toBe(422);
      expect(res.res.headers.get('content-type')).toContain('application/problem+json');
      expect(res.body).toMatchObject({ type: CONTENT_PRODUCT_NOT_LINKABLE, status: 422, code: 'product_not_linkable' });
    }
    expect(await rowById(draft.id)).toEqual(rowBefore);
    expect(await eventsForContent(storeId, draft.id)).toHaveLength(eventsBefore);
    expect(await linkRow(draft.id)).toEqual([]);

    const created = await request(token, 'POST', '/v1/content', { ...validCreateInput, product_id: foreign });
    expect(created.res.status).toBe(422);
    expect((await admin.query('select 1 from content_items where store_id = $1', [storeId])).rowCount).toBe(1);
    expect((await request(token, 'PATCH', `/v1/content/${draft.id}`, { product_id: 'not-a-uuid' })).res.status).toBe(400);
  });

  it('Hidden product: linking one answers 422 product-not-linkable; an item already linked to a product hidden since may still re-send it', async () => {
    const { storeId, token } = await installedStore();
    const hidden = await seedProduct(storeId, { visible: false });
    const draft = await seedItemInStatus(storeId, 'draft');
    const res = await request(token, 'PATCH', `/v1/content/${draft.id}`, { product_id: hidden });
    expect(res.res.status).toBe(422);
    expect(res.body).toMatchObject({ type: CONTENT_PRODUCT_NOT_LINKABLE });
    expect((await request(token, 'POST', '/v1/content', { ...validCreateInput, product_id: hidden })).res.status).toBe(422);

    const shown = await seedProduct(storeId);
    expect((await request(token, 'PATCH', `/v1/content/${draft.id}`, { product_id: shown })).res.status).toBe(200);
    await admin.query('update products set visible = false where id = $1', [shown]);
    const again = await request(token, 'PATCH', `/v1/content/${draft.id}`, { title: 'Still linked', product_id: shown });
    expect(again.res.status).toBe(200);
    expect(ContentItem.parse(again.body).title).toBe('Still linked');
  });

  it('Legacy CTA style: an edit that does not set cta_style keeps a stored style outside the presets', async () => {
    const { storeId, token } = await installedStore();
    const draft = await seedItemInStatus(storeId, 'draft');
    await admin.query(`update content_items set cta_style = 'brand-blue' where id = $1`, [draft.id]);
    expect((await request(token, 'PATCH', `/v1/content/${draft.id}`, { title: 'New title' })).res.status).toBe(200);
    expect((await admin.query<{ cta_style: string }>('select cta_style from content_items where id = $1', [draft.id])).rows[0]!.cta_style).toBe('brand-blue');
  });

  it('Counts: two items link P and one of them is deleted, so P counts 1', async () => {
    const { storeId, token } = await installedStore();
    const productId = await seedProduct(storeId);
    const a = await seedItemInStatus(storeId, 'draft');
    const b = await seedItemInStatus(storeId, 'published');
    for (const id of [a.id, b.id]) expect((await request(token, 'PATCH', `/v1/content/${id}`, { product_id: productId })).res.status).toBe(200);
    expect(await linkedCount(token, productId)).toBe(2);
    expect((await request(token, 'DELETE', `/v1/content/${a.id}`)).res.status).toBe(204);
    expect(await linkedCount(token, productId)).toBe(1);
  });

  it('Product deleted: catalog.product.deleted emits content.item.edited once per linked live item (redelivery emits nothing); the item reads deleted until the product is re-created', async () => {
    const { storeId, token } = await installedStore();
    const productId = await seedProduct(storeId);
    const live1 = await seedItemInStatus(storeId, 'draft');
    const live2 = await seedItemInStatus(storeId, 'published');
    const gone = await seedItemInStatus(storeId, 'draft');
    const unlinked = await seedItemInStatus(storeId, 'draft');
    for (const id of [live1.id, live2.id, gone.id]) await request(token, 'PATCH', `/v1/content/${id}`, { product_id: productId });
    await request(token, 'DELETE', `/v1/content/${gone.id}`);
    const before = new Map<string, number>();
    for (const id of [live1.id, live2.id, gone.id, unlinked.id]) before.set(id, (await eventsForContent(storeId, id)).length);

    await admin.query('update products set deleted_at = now() where id = $1', [productId]);
    const registry = new EventHandlerRegistry();
    registerContentEventHandlers(registry, telemetry, lifecycle);
    const dispatch = eventDispatcher(app, registry);
    const envelope: EventEnvelope = {
      v: 1,
      trace_id: 't',
      store_id: storeId,
      event_id: uuidv7(),
      name: 'catalog.product.deleted',
      occurred_at: new Date().toISOString(),
      payload: { v: 1, store_id: storeId, product_id: productId, external_id: 'ext' },
    };
    await dispatch(envelope, { id: envelope.event_id, data: envelope });
    await dispatch(envelope, { id: envelope.event_id, data: envelope });

    for (const [id, status] of [
      [live1.id, 'draft'],
      [live2.id, 'published'],
    ] as const) {
      const events = await eventsForContent(storeId, id);
      expect(events).toHaveLength(before.get(id)! + 1);
      expect(events.at(-1)).toMatchObject({ name: 'content.item.edited', payload: { v: 1, store_id: storeId, content_id: id, status, changed: ['product_id'] } });
    }
    for (const id of [gone.id, unlinked.id]) expect(await eventsForContent(storeId, id)).toHaveLength(before.get(id)!);

    const flagged = ContentItem.parse((await request(token, 'GET', `/v1/content/${live1.id}`)).body);
    expect(flagged.product).toMatchObject({ id: productId, deleted: true });
    expect(await linkRow(live1.id)).toEqual([{ product_id: productId }]);
    const listed = ContentListResponse.parse((await request(token, 'GET', '/v1/content')).body);
    expect(listed.items.find((i) => i.id === live2.id)?.product?.deleted).toBe(true);
    // A deleted product can not be linked anew.
    expect((await request(token, 'PATCH', `/v1/content/${unlinked.id}`, { product_id: productId })).res.status).toBe(422);

    // Re-created with the same id: the tombstone is cleared and so is the flag.
    await admin.query('update products set deleted_at = null where id = $1', [productId]);
    expect(ContentItem.parse((await request(token, 'GET', `/v1/content/${live1.id}`)).body).product).toMatchObject({ id: productId, deleted: false });
  });

  // ---- Story 3.6: slides ----
  const seedAsset = async (storeId: string, kind: 'image' | 'video' = 'image', status: 'uploaded' | 'scanned' | 'processed' | 'failed' = 'uploaded'): Promise<string> =>
    (
      await admin.query<{ id: string }>(
        `insert into media_assets (store_id, kind, content_type, size_bytes, sha256, upload_key, status, failure_reason)
         values ($1, $2, $3, 1000, $4, 'stores/x/uploads/y', $5, $6) returning id::text as id`,
        [storeId, kind, kind === 'image' ? 'image/jpeg' : 'video/mp4', randomBytes(32).toString('hex'), status, status === 'failed' ? 'type_mismatch' : null],
      )
    ).rows[0]!.id;
  const slideRows = async (contentId: string) =>
    (
      await admin.query<{ media_asset_id: string; position: number; alt_text: string | null; kind: string; deleted: boolean; id: string }>(
        'select id::text as id, media_asset_id::text as media_asset_id, position, alt_text, kind, deleted_at is not null as deleted from slides where content_id = $1 order by deleted_at nulls first, position',
        [contentId],
      )
    ).rows;

  it.each(CONTENT_STATUSES)('Story 3.13: duplicate %s resets lifecycle metadata and emits one created event', async status => {
    const { storeId, token } = await installedStore();
    const source = await seedItemInStatus(storeId, status);
    await admin.query('update content_items set auto_publish = true where id = $1', [source.id]);
    const before = await rowById(source.id);
    const sourceEvents = await eventsForContent(storeId, source.id);
    const result = await request(token, 'POST', `/v1/content/${source.id}/duplicate`);
    expect(result.res.status).toBe(201);
    const copy = ContentItem.parse(result.body);
    expect(copy.id).not.toBe(source.id);
    expect(copy).toMatchObject({ title: source.title + ' (copy)', status: 'draft', auto_publish: false, archived_from: null, reactivate_to: null, first_published_at: null, slides: [] });
    expect(await rowById(source.id)).toEqual(before);
    expect(await eventsForContent(storeId, source.id)).toEqual(sourceEvents);
    expect((await eventsForContent(storeId, copy.id)).map(event => event.name)).toEqual(['content.item.created']);
  });

  it('Story 3.13: duplicate retains hidden/deleted products and ordered pending/failed media; deleting the original keeps shared media', async () => {
    const { storeId, token } = await installedStore();
    const productId = await seedProduct(storeId);
    const image = await seedAsset(storeId, 'image', 'processed');
    const video = await seedAsset(storeId, 'video', 'scanned');
    const removed = await seedAsset(storeId, 'image', 'processed');
    const source = ContentItem.parse((await request(token, 'POST', '/v1/content', {
      ...validCreateInput, product_id: productId, auto_publish: true,
      cta_action: 'open_link', cta_url: 'https://shop.example.com/p', cta_style: 'light',
      slides: [{ media_asset_id: video, alt_text: 'Video' }, { media_asset_id: image, alt_text: 'صورة المنتج' }, { media_asset_id: removed, alt_text: 'Removed' }],
    })).body);
    expect((await request(token, 'PATCH', `/v1/content/${source.id}`, { slides: [{ media_asset_id: video, alt_text: 'Video' }, { media_asset_id: image, alt_text: 'صورة المنتج' }] })).res.status).toBe(200);
    await admin.query("update media_assets set status = 'failed', failure_reason = 'processing_failed' where id = $1", [image]);
    await admin.query('update products set visible = false, deleted_at = now() where id = $1', [productId]);
    // Put a surrogate pair precisely at the truncation boundary.
    await admin.query('update content_items set title = $2 where id = $1', [source.id, 'x'.repeat(72) + '😀' + 'y'.repeat(6)]);
    const before = await rowById(source.id);
    const result = await request(token, 'POST', `/v1/content/${source.id}/duplicate`);
    expect(result.res.status).toBe(201);
    const copy = ContentItem.parse(result.body);
    expect(copy.title).toBe('x'.repeat(72) + ' (copy)');
    expect(copy.title.length).toBeLessThanOrEqual(80);
    expect(copy).toMatchObject({ status: 'draft', auto_publish: false, product: { id: productId, deleted: true }, cta_action: 'open_link', cta_url: source.cta_url, cta_style: source.cta_style });
    expect(copy.slides.map(slide => [slide.media_asset_id, slide.alt_text, slide.status])).toEqual([[video, 'Video', 'scanned'], [image, 'صورة المنتج', 'failed']]);
    expect(copy.slides.every(slide => !source.slides.some(original => original.id === slide.id))).toBe(true);
    expect(await rowById(source.id)).toEqual(before);
    expect((await eventsForContent(storeId, copy.id)).map(event => event.name)).toEqual(['content.item.created']);
    expect((await request(token, 'DELETE', `/v1/content/${source.id}`)).res.status).toBe(204);
    expect(ContentItem.parse((await request(token, 'GET', `/v1/content/${copy.id}`)).body).slides).toEqual(copy.slides);
    expect((await admin.query('select id from media_assets where id = any($1::uuid[])', [[video, image]])).rows).toHaveLength(2);
    for (const tab of ['all', 'published', 'scheduled', 'drafts']) {
      const list = ContentListResponse.parse((await request(token, 'GET', `/v1/content?tab=${tab}`)).body);
      expect(list.items.some(item => item.id === source.id)).toBe(false);
    }
  });

  it('Story 3.13: invalid, missing, foreign and deleted duplicate sources return the existing 404 without writes', async () => {
    const { storeId, token } = await installedStore();
    const other = await installedStore();
    const foreign = await seedItemInStatus(other.storeId, 'draft');
    const deleted = await seedItemInStatus(storeId, 'draft');
    await withStoreContext(app, storeId, tx => lifecycle.apply(tx, storeId, deleted.id, 'delete'));
    const before = await admin.query('select count(*)::int as count from content_items where store_id = $1', [storeId]);
    for (const id of ['invalid', randomUUID(), foreign.id, deleted.id]) {
      const result = await request(token, 'POST', `/v1/content/${id}/duplicate`);
      expect(result.res.status).toBe(404);
      expect(result.body).toMatchObject({ code: 'content_not_found' });
    }
    expect((await admin.query('select count(*)::int as count from content_items where store_id = $1', [storeId])).rows).toEqual(before.rows);
  });

  it('Story 3.13: duplication and its event roll back together if the transaction fails', async () => {
    const { storeId, token } = await installedStore();
    const productId = await seedProduct(storeId);
    const image = await seedAsset(storeId, 'image', 'processed');
    const source = ContentItem.parse((await request(token, 'POST', '/v1/content', { ...validCreateInput, product_id: productId, slides: [{ media_asset_id: image, alt_text: 'Photo' }] })).body);
    let copyId = '';
    await expect(withStoreContext(app, storeId, async tx => {
      copyId = (await lifecycle.duplicate(tx, storeId, source.id)).id;
      throw new Error('rollback duplicate');
    })).rejects.toThrow('rollback duplicate');
    expect(await rowById(copyId)).toBeUndefined();
    expect(await slideRows(copyId)).toEqual([]);
    expect((await admin.query('select id from content_product_links where content_id = $1', [copyId])).rows).toEqual([]);
    expect(await eventsForContent(storeId, copyId)).toEqual([]);
  });

  it('Story 3.13: one Published PATCH commits combined fields, product and ordered slides with exactly one edited event; rejected edits commit nothing', async () => {
    const { storeId, token } = await installedStore();
    const source = await seedItemInStatus(storeId, 'published');
    await admin.query("update content_items set format = 'reel' where id = $1", [source.id]);
    const productId = await seedProduct(storeId);
    const image = await seedAsset(storeId, 'image', 'processed');
    const video = await seedAsset(storeId, 'video', 'processed');
    const patch = { title: 'Combined live edit', format: 'story', cta_label: 'View', cta_action: 'open_link', cta_url: 'https://shop.example.com/p', cta_style: 'light', product_id: productId, slides: [{ media_asset_id: video, alt_text: null }, { media_asset_id: image, alt_text: 'Product photo' }] };
    const beforeEvents = await eventsForContent(storeId, source.id);
    const result = await request(token, 'PATCH', `/v1/content/${source.id}`, patch);
    expect(result.res.status).toBe(200);
    const saved = ContentItem.parse(result.body);
    expect(saved).toMatchObject({ title: patch.title, format: patch.format, cta_label: patch.cta_label, cta_action: patch.cta_action, cta_url: patch.cta_url, cta_style: patch.cta_style, slides: patch.slides, status: 'published', product: { id: productId } });
    const edited = (await eventsForContent(storeId, source.id)).slice(beforeEvents.length);
    expect(edited.map(event => event.name)).toEqual(['content.item.edited']);
    const row = await rowById(source.id);
    const slides = await slideRows(source.id);
    const bad = await request(token, 'PATCH', `/v1/content/${source.id}`, { title: 'Do not save', product_id: null, slides: [{ media_asset_id: image, alt_text: '' }] });
    expect(bad.res.status).toBe(422);
    expect(await rowById(source.id)).toEqual(row);
    expect(await slideRows(source.id)).toEqual(slides);
    expect(ContentItem.parse((await request(token, 'GET', `/v1/content/${source.id}`)).body).product?.id).toBe(productId);
    expect((await eventsForContent(storeId, source.id)).slice(beforeEvents.length)).toEqual(edited);
  });

  it('Story 3.9: shared retry recovery and failed-slide replacements preserve lifecycle events and reasons', async () => {
    const { storeId, token } = await installedStore();
    const media = nest.get(MediaService); const commands = nest.get(ContentLifecycle);
    const shared = await seedAsset(storeId, 'video', 'scanned');
    const ready = await seedAsset(storeId, 'video', 'processed');
    const pending = await seedAsset(storeId, 'video', 'scanned');
    const slide = (id: string) => ({ media_asset_id: id, alt_text: null });
    const create = async () => ContentItem.parse((await request(token, 'POST', '/v1/content', { ...validCreateInput, auto_publish: false, slides: [slide(shared), slide(ready)] })).body);
    const a = await create(); const b = await create();
    const sync = () => withStoreContext(app, storeId, tx => commands.syncSlideProcessing(tx, storeId, shared, async ids => new Map([...(await media.getAssetsByIds(storeId, ids))].map(([id, asset]) => [id, asset.status]))));
    const get = async (id: string) => ContentItem.parse((await request(token, 'GET', '/v1/content/' + id)).body);
    const fail = async () => { await admin.query("update media_assets set status = 'failed', failure_reason = 'processing_failed' where id = $1", [shared]); await sync(); };
    await fail();
    expect((await get(b.id)).status_reason).toEqual({ code: 'processing_failed', kind: 'video' });
    await request(token, 'POST', '/v1/content/' + a.id + '/retry');
    await sync();
    expect(await get(b.id)).toMatchObject({ status: 'processing', status_reason: null });
    await admin.query("update media_assets set status = 'processed' where id = $1", [shared]); await sync();
    expect(await get(b.id)).toMatchObject({ status: 'draft', auto_publish: false, status_reason: null });
    await fail();
    await request(token, 'POST', '/v1/content/' + a.id + '/retry');
    await admin.query("update media_assets set status = 'processed' where id = $1", [shared]); await sync();
    expect(await get(b.id)).toMatchObject({ status: 'draft', status_reason: null });
    expect((await eventsForContent(storeId, b.id)).at(-1)).toMatchObject({ name: 'content.item.processed', payload: { from: 'failed', to: 'draft' } });
    await fail();
    const replacing = ContentItem.parse((await request(token, 'PATCH', '/v1/content/' + a.id, { slides: [slide(pending), slide(ready)] })).body);
    expect(replacing).toMatchObject({ status: 'processing', status_reason: null });
    expect((await eventsForContent(storeId, a.id)).at(-1)).toMatchObject({ name: 'content.item.processing_started', payload: { from: 'failed', to: 'processing' } });
    const retained = ContentItem.parse((await request(token, 'PATCH', '/v1/content/' + b.id, { slides: [slide(ready)] })).body);
    expect(retained).toMatchObject({ status: 'draft', status_reason: null });
    expect(retained.slides).toHaveLength(1);
    expect((await eventsForContent(storeId, b.id)).at(-1)).toMatchObject({ name: 'content.item.processed', payload: { from: 'failed', to: 'draft' } });
    await admin.query("update media_assets set status = 'processed' where id = $1", [pending]);
    await withStoreContext(app, storeId, tx => commands.syncSlideProcessing(tx, storeId, pending, async ids => new Map([...(await media.getAssetsByIds(storeId, ids))].map(([id, asset]) => [id, asset.status]))));
    expect(await get(a.id)).toMatchObject({ status: 'draft', auto_publish: false, status_reason: null });
    expect((await eventsForContent(storeId, a.id)).at(-1)).toMatchObject({ name: 'content.item.processed', payload: { from: 'processing', to: 'draft' } });
  });

  it('Story 3.9: failure events, retry restrictions, recovery and auto-publish without placement', async () => {
    const { storeId, token } = await installedStore();
    const asset = await seedAsset(storeId, 'video', 'scanned');
    const item = ContentItem.parse((await request(token, 'POST', '/v1/content', { ...validCreateInput, placements: [], auto_publish: true, slides: [{ media_asset_id: asset, alt_text: null }] })).body);
    const registry = new EventHandlerRegistry();
    registerContentEventHandlers(registry, telemetry, nest.get(ContentLifecycle), nest.get(MediaService));
    const dispatch = eventDispatcher(app, registry);
    const emit = async (name: 'media.asset.failed' | 'media.asset.processed', reason: 'processing_failed' | 'below_min_resolution' = 'processing_failed') => {
      const ev: EventEnvelope = { v: 1, trace_id: 'quality-test', store_id: storeId, event_id: uuidv7(), name, occurred_at: new Date().toISOString(), payload: name === 'media.asset.failed' ? { v: 1, store_id: storeId, asset_id: asset, reason } : { v: 1, store_id: storeId, asset_id: asset, kind: 'video' } };
      await dispatch(ev, { id: ev.event_id, data: ev });
    };
    expect((await request(token, 'POST', '/v1/content/' + item.id + '/retry')).res.status).toBe(409);
    await admin.query("update media_assets set status = 'failed', failure_reason = 'processing_failed' where id = $1", [asset]);
    await emit('media.asset.failed');
    let failed = ContentItem.parse((await request(token, 'GET', '/v1/content/' + item.id)).body);
    expect(failed).toMatchObject({ status: 'failed', status_reason: { code: 'processing_failed', kind: 'video' } });
    const retry = await request(token, 'POST', '/v1/content/' + item.id + '/retry');
    expect(retry.res.status).toBe(200);
    expect(ContentItem.parse(retry.body).status).toBe('processing');
    expect((await admin.query('select status, failure_reason from media_assets where id = $1', [asset])).rows[0]).toEqual({ status: 'scanned', failure_reason: null });
    await admin.query("update media_assets set status = 'processed' where id = $1", [asset]);
    await emit('media.asset.processed');
    const finished = ContentItem.parse((await request(token, 'GET', '/v1/content/' + item.id)).body);
    expect(finished).toMatchObject({ status: 'draft', auto_publish: true, status_reason: { code: 'no_placement' } });
    const off = ContentItem.parse((await request(token, 'PATCH', '/v1/content/' + item.id, { auto_publish: false })).body);
    expect(off.status_reason).toBeNull();
    await admin.query("update media_assets set status = 'failed', failure_reason = 'below_min_resolution' where id = $1", [asset]);
    await emit('media.asset.failed', 'below_min_resolution');
    failed = ContentItem.parse((await request(token, 'GET', '/v1/content/' + item.id)).body);
    expect(failed.status).toBe('failed');
    expect((await request(token, 'POST', '/v1/content/' + item.id + '/retry')).res.status).toBe(409);
    const recovered = ContentItem.parse((await request(token, 'PATCH', '/v1/content/' + item.id, { slides: [] })).body);
    expect(recovered).toMatchObject({ status: 'draft', status_reason: null });
    expect((await eventsForContent(storeId, item.id)).filter(e => e.name === 'content.item.published')).toEqual([]);
  });

  it('Home API: scoped persistence, strict choices, publish, copy omission and one atomic Published edit', async () => {
    const { storeId, token } = await installedStore();
    const other = await installedStore();
    const item = ContentItem.parse((await request(token, 'POST', '/v1/content', { ...validCreateInput, placements: [] })).body);
    const before = await rowById(item.id); const events = await eventsForContent(storeId, item.id);
    const refused = await request(token, 'POST', `/v1/content/${item.id}/publish`);
    expect(refused.res.status).toBe(422); expect(refused.body).toMatchObject({ code: 'no_placement', type: 'no-placement' });
    expect(await rowById(item.id)).toEqual(before); expect(await eventsForContent(storeId, item.id)).toEqual(events);
    for (const placements of [[{ type: 'category' }], [{ type: 'product', target_id: randomUUID() }], [{ type: 'home' }, { type: 'home' }]]) expect((await request(token, 'PATCH', `/v1/content/${item.id}`, { placements })).res.status).toBe(400);
    expect((await request(other.token, 'PATCH', `/v1/content/${item.id}`, { placements: [{ type: 'home' }] })).res.status).toBe(404);
    expect((await request(other.token, 'GET', `/v1/content/${item.id}`)).res.status).toBe(404);
    expect((await request(token, 'PATCH', `/v1/content/${item.id}`, { placements: [{ type: 'home' }] })).res.status).toBe(200);
    expect(ContentItem.parse((await request(token, 'GET', `/v1/content/${item.id}`)).body).placements).toEqual([{ type: 'home', layout: 'ring' }]);
    const unplaced = ContentItem.parse((await request(token, 'POST', '/v1/content', { ...validCreateInput, placements: [] })).body);
    const listed = ContentListResponse.parse((await request(token, 'GET', '/v1/content')).body);
    expect(listed.items.find(row => row.id === item.id)?.placements).toEqual([{ type: 'home', layout: 'ring' }]);
    expect(listed.items.find(row => row.id === unplaced.id)?.placements).toEqual([]);
    expect(ContentItem.parse((await request(token, 'POST', `/v1/content/${item.id}/publish`)).body).status).toBe('published');
    const count = (await eventsForContent(storeId, item.id)).length;
    const changed = await request(token, 'PATCH', `/v1/content/${item.id}`, { title: 'Saved together', placements: [] });
    expect(ContentItem.parse(changed.body)).toMatchObject({ title: 'Saved together', status: 'published', placements: [] });
    const after = await eventsForContent(storeId, item.id);
    expect(after).toHaveLength(count + 1); expect(after.at(-1)).toMatchObject({ name: 'content.item.edited', payload: { changed: ['title', 'placements'] } });
    await expect(withStoreContext(app, storeId, async tx => { await nest.get(ContentLifecycle).edit(tx, storeId, item.id, { title: 'Rollback', placements: [{ type: 'home' }] }); throw new Error('rollback'); })).rejects.toThrow('rollback');
    expect(ContentItem.parse((await request(token, 'GET', `/v1/content/${item.id}`)).body)).toMatchObject({ title: 'Saved together', placements: [] });
    expect(await eventsForContent(storeId, item.id)).toEqual(after);
    await request(token, 'PATCH', `/v1/content/${item.id}`, { placements: [{ type: 'home' }] });
    expect(ContentItem.parse((await request(token, 'POST', `/v1/content/${item.id}/duplicate`)).body)).toMatchObject({ status: 'draft', placements: [] });
  });

  it('Home QC: processed media auto-publishes once, pending or failed media never enters live destinations', async () => {
    const { storeId, token } = await installedStore();
    const asset = await seedAsset(storeId, 'video', 'scanned');
    const item = ContentItem.parse((await request(token, 'POST', '/v1/content', { ...validCreateInput, auto_publish: true, slides: [{ media_asset_id: asset, alt_text: null }] })).body);
    const commands = nest.get(ContentLifecycle); const media = nest.get(MediaService);
    const resolve = async (ids: readonly string[]) => new Map([...(await media.getAssetsByIds(storeId, ids))].map(([id, asset]) => [id, asset.status]));
    await admin.query("update media_assets set status = 'processed' where id = $1", [asset]);
    await withStoreContext(app, storeId, tx => commands.syncSlideProcessing(tx, storeId, asset, resolve));
    await withStoreContext(app, storeId, tx => commands.syncSlideProcessing(tx, storeId, asset, resolve));
    expect(ContentItem.parse((await request(token, 'GET', `/v1/content/${item.id}`)).body)).toMatchObject({ status: 'published', first_published_at: expect.any(String), status_reason: null });
    expect((await eventsForContent(storeId, item.id)).filter(e => e.name === 'content.item.published')).toHaveLength(1);
    await request(token, 'POST', `/v1/content/${item.id}/archive`);
    for (const state of ['scanned', 'failed']) {
      await admin.query("update media_assets set status = $2, failure_reason = case when $2 = 'failed' then 'processing_failed' else null end where id = $1", [asset, state]);
      const before = await rowById(item.id); const events = await eventsForContent(storeId, item.id);
      const refused = await request(token, 'POST', `/v1/content/${item.id}/undo-archive`);
      expect(refused.res.status).toBe(422); expect(refused.body).toMatchObject({ code: 'media_not_ready' });
      expect(await rowById(item.id)).toEqual(before); expect(await eventsForContent(storeId, item.id)).toEqual(events);
    }
  });

  it('Ring layout (4.2 pilot): new Home is Ring with and without a settings row, legacy rows read as Ring, other layouts 422 without mutation', async () => {
    const { storeId, token } = await installedStore();
    const other = await installedStore();
    const created = await request(token, 'POST', '/v1/content', validCreateInput);
    expect(created.res.status).toBe(201);
    const item = ContentItem.parse(created.body);
    expect(item.placements).toEqual([{ type: 'home', layout: 'ring' }]);
    expect((await admin.query('select layout from placements where content_id = $1', [item.id])).rows).toEqual([{ layout: 'ring' }]);
    // A stored display default is inherited by new placements; another store's row is never read.
    await admin.query("insert into store_settings (store_id, story_layout) values ($1, 'ring')", [storeId]);
    const inherited = ContentItem.parse((await request(token, 'POST', '/v1/content', { ...validCreateInput, placements: [] })).body);
    expect(ContentItem.parse((await request(token, 'PATCH', `/v1/content/${inherited.id}`, { placements: [{ type: 'home' }] })).body).placements).toEqual([{ type: 'home', layout: 'ring' }]);
    expect((await request(other.token, 'GET', `/v1/content/${inherited.id}`)).res.status).toBe(404);
    // A Home row written before migration 0023 (no layout sent) reads back as Ring.
    const legacy = ContentItem.parse((await request(token, 'POST', '/v1/content', { ...validCreateInput, placements: [] })).body);
    await admin.query("insert into placements (store_id, content_id, type) values ($1, $2, 'home')", [storeId, legacy.id]);
    const listed = ContentListResponse.parse((await request(token, 'GET', '/v1/content')).body);
    expect(listed.items.find(row => row.id === legacy.id)?.placements).toEqual([{ type: 'home', layout: 'ring' }]);
    expect(ContentItem.parse((await request(token, 'GET', `/v1/content/${legacy.id}`)).body).placements).toEqual([{ type: 'home', layout: 'ring' }]);

    const items = await admin.query('select count(*)::int as n from content_items where store_id = $1', [storeId]);
    for (const layout of ['bar', 'strip', 'carousel', 'unknown', 3]) {
      const create = await request(token, 'POST', '/v1/content', { ...validCreateInput, placements: [{ type: 'home', layout }] });
      expect(create.res.status).toBe(422);
      expect(create.res.headers.get('content-type')).toContain('application/problem+json');
      expect(create.body).toMatchObject({ type: CONTENT_INVALID_LAYOUT, code: 'invalid_layout', status: 422 });
    }
    expect((await admin.query('select count(*)::int as n from content_items where store_id = $1', [storeId])).rows).toEqual(items.rows);
    const unplaced = ContentItem.parse((await request(token, 'POST', '/v1/content', { ...validCreateInput, placements: [] })).body);
    for (const target of [item, unplaced]) {
      const row = await rowById(target.id);
      const events = await eventsForContent(storeId, target.id);
      const placementsBefore = (await admin.query('select * from placements where content_id = $1', [target.id])).rows;
      const patch = await request(token, 'PATCH', `/v1/content/${target.id}`, { title: 'Not saved', placements: [{ type: 'home', layout: 'bar' }] });
      expect(patch.res.status).toBe(422);
      expect(patch.body).toMatchObject({ type: CONTENT_INVALID_LAYOUT, code: 'invalid_layout' });
      expect(await rowById(target.id)).toEqual(row);
      expect(await eventsForContent(storeId, target.id)).toEqual(events);
      expect((await admin.query('select * from placements where content_id = $1', [target.id])).rows).toEqual(placementsBefore);
    }
    // Other invalid placement shapes keep their 400.
    expect((await request(token, 'PATCH', `/v1/content/${item.id}`, { placements: [{ type: 'category', layout: 'ring' }] })).res.status).toBe(400);
  });

  it('Ring layout (4.2 pilot): Published items save layout explicitly with one edited event, and export carries the layout', async () => {
    const { storeId, token } = await installedStore();
    const item = ContentItem.parse((await request(token, 'POST', '/v1/content', { ...validCreateInput, placements: [] })).body);
    expect((await request(token, 'PATCH', `/v1/content/${item.id}`, { placements: [{ type: 'home', layout: 'ring' }] })).res.status).toBe(200);
    expect(ContentItem.parse((await request(token, 'POST', `/v1/content/${item.id}/publish`)).body)).toMatchObject({ status: 'published', placements: [{ type: 'home', layout: 'ring' }] });
    const count = (await eventsForContent(storeId, item.id)).length;
    const same = await request(token, 'PATCH', `/v1/content/${item.id}`, { title: 'Ring title', placements: [{ type: 'home', layout: 'ring' }] });
    expect(ContentItem.parse(same.body)).toMatchObject({ status: 'published', title: 'Ring title', placements: [{ type: 'home', layout: 'ring' }] });
    const after = await eventsForContent(storeId, item.id);
    expect(after).toHaveLength(count + 1);
    expect(after.at(-1)).toMatchObject({ name: 'content.item.edited', payload: { status: 'published', changed: ['title'] } });
    const exported = (await withStoreContext(app, storeId, tx => contentStoreData.export!({ storeId, installEpoch: 1, tx }))) as { placements: Array<Record<string, unknown>> };
    expect(exported.placements).toEqual([expect.objectContaining({ content_id: item.id, type: 'home', layout: 'ring' })]);
  });

  it('Reel admission (4.2 pilot): Reel drafts are created and edited, publish answers 422 unsupported-format, QC auto-publish stays Draft with the reason', async () => {
    const { storeId, token } = await installedStore();
    const asset = await seedAsset(storeId, 'video', 'scanned');
    const created = await request(token, 'POST', '/v1/content', { ...validCreateInput, format: 'reel', auto_publish: true, slides: [{ media_asset_id: asset, alt_text: null }] });
    expect(created.res.status).toBe(201);
    const reel = ContentItem.parse(created.body);
    expect(reel).toMatchObject({ format: 'reel', status: 'processing', placements: [{ type: 'home', layout: 'ring' }] });
    expect((await request(token, 'PATCH', `/v1/content/${reel.id}`, { title: 'Reel draft edit' })).res.status).toBe(200);
    const commands = nest.get(ContentLifecycle); const media = nest.get(MediaService);
    const resolve = async (ids: readonly string[]) => new Map([...(await media.getAssetsByIds(storeId, ids))].map(([id, a]) => [id, a.status]));
    await admin.query("update media_assets set status = 'processed' where id = $1", [asset]);
    await withStoreContext(app, storeId, tx => commands.syncSlideProcessing(tx, storeId, asset, resolve));
    const finished = ContentItem.parse((await request(token, 'GET', `/v1/content/${reel.id}`)).body);
    expect(finished).toMatchObject({ status: 'draft', auto_publish: true, first_published_at: null, status_reason: { code: 'unsupported_format' } });
    expect((await eventsForContent(storeId, reel.id)).filter(e => e.name === 'content.item.published')).toEqual([]);
    const before = await rowById(reel.id); const events = await eventsForContent(storeId, reel.id);
    const refused = await request(token, 'POST', `/v1/content/${reel.id}/publish`);
    expect(refused.res.status).toBe(422);
    expect(refused.body).toMatchObject({ type: CONTENT_UNSUPPORTED_FORMAT, code: 'unsupported_format' });
    expect(await rowById(reel.id)).toEqual(before); expect(await eventsForContent(storeId, reel.id)).toEqual(events);
    // The same item as a Story publishes.
    expect((await request(token, 'PATCH', `/v1/content/${reel.id}`, { format: 'story' })).res.status).toBe(200);
    expect(ContentItem.parse((await request(token, 'POST', `/v1/content/${reel.id}/publish`)).body).status).toBe('published');
  });

  it('Reel edit (4.2 pilot): a Published or Scheduled Story can not become a Reel; a Draft can', async () => {
    const { storeId, token } = await installedStore();
    for (const status of ['published', 'scheduled'] as const) {
      const live = await seedItemInStatus(storeId, status);
      const row = await rowById(live.id); const events = await eventsForContent(storeId, live.id);
      const refused = await request(token, 'PATCH', `/v1/content/${live.id}`, { title: 'Not saved', format: 'reel' });
      expect(refused.res.status).toBe(422);
      expect(refused.res.headers.get('content-type')).toContain('application/problem+json');
      expect(refused.body).toMatchObject({ type: CONTENT_UNSUPPORTED_FORMAT, code: 'unsupported_format' });
      expect(await rowById(live.id)).toEqual(row);
      expect(await eventsForContent(storeId, live.id)).toEqual(events);
    }
    const draft = await seedItemInStatus(storeId, 'draft');
    const ok = await request(token, 'PATCH', `/v1/content/${draft.id}`, { format: 'reel' });
    expect(ok.res.status).toBe(200);
    expect(ContentItem.parse(ok.body)).toMatchObject({ status: 'draft', format: 'reel' });
  });

  it('Mixed invalid bodies (4.2 pilot): a layout issue next to another issue stays 400 invalid_body', async () => {
    const { storeId, token } = await installedStore();
    const item = ContentItem.parse((await request(token, 'POST', '/v1/content', validCreateInput)).body);
    for (const body of [{ title: '', placements: [{ type: 'home', layout: 'bar' }] }, { placements: [{ type: 'category', layout: 'bar' }] }]) {
      const patch = await request(token, 'PATCH', `/v1/content/${item.id}`, body);
      expect(patch.res.status).toBe(400);
      expect(patch.body).toMatchObject({ code: 'invalid_body' });
      const create = await request(token, 'POST', '/v1/content', { ...validCreateInput, ...body });
      expect(create.res.status).toBe(400);
      expect(create.body).toMatchObject({ code: 'invalid_body' });
    }
    expect((await admin.query('select count(*)::int as n from content_items where store_id = $1', [storeId])).rows).toEqual([{ n: 1 }]);
  });

  it('Slides (Story 3.7): an importing asset is attachable; the slide carries its source_url (null for uploads), also once the import failed', async () => {
    const { storeId, token } = await installedStore();
    const link = 'https://cdn.example.com/a.jpg';
    const importing = (
      await admin.query<{ id: string }>(
        `insert into media_assets (store_id, kind, status, source_url) values ($1, 'image', 'importing', $2) returning id::text as id`,
        [storeId, link],
      )
    ).rows[0]!.id;
    const uploaded = await seedAsset(storeId, 'video');
    const created = await request(token, 'POST', '/v1/content', { ...validCreateInput, slides: [{ media_asset_id: importing, alt_text: 'Red' }, { media_asset_id: uploaded, alt_text: null }] });
    expect(created.res.status).toBe(201);
    const item = ContentItem.parse(created.body);
    expect(item.slides.map((s) => [s.status, s.source_url])).toEqual([
      ['importing', link],
      ['uploaded', null],
    ]);
    await admin.query(`update media_assets set status = 'failed', failure_reason = 'fetch_failed' where id = $1`, [importing]);
    const reloaded = ContentItem.parse((await request(token, 'GET', `/v1/content/${item.id}`)).body);
    expect(reloaded.slides[0]).toMatchObject({ status: 'failed', failure_reason: 'fetch_failed', source_url: link });
  });

  it('Slides (Stories 3.6, 3.8): POST with in-flight slides saves them in order and moves item to processing; GET and list return them with kind, status and poster_url', async () => {
    const { storeId, token } = await installedStore();
    const img1 = await seedAsset(storeId, 'image');
    const img2 = await seedAsset(storeId, 'image', 'scanned');
    const vid = await seedAsset(storeId, 'video', 'processed');
    const slides = [
      { media_asset_id: img1, alt_text: '  Red abaya  ' },
      { media_asset_id: img2, alt_text: 'Black abaya' },
      { media_asset_id: vid, alt_text: null },
    ];
    const created = await request(token, 'POST', '/v1/content', { ...validCreateInput, slides });
    expect(created.res.status).toBe(201);
    const item = ContentItem.parse(created.body);
    expect(item.status).toBe('processing');
    expect(item.slides.map((s) => [s.media_asset_id, s.kind, s.alt_text, s.status, s.failure_reason, s.poster_url])).toEqual([
      [img1, 'image', 'Red abaya', 'uploaded', null, null],
      [img2, 'image', 'Black abaya', 'scanned', null, null],
      [vid, 'video', null, 'processed', null, `/v1/media/${vid}/poster`],
    ]);
    expect((await slideRows(item.id)).map((r) => r.position)).toEqual([0, 1, 2]);

    // Inspection fails later: the reload shows it failed with the reason.
    await admin.query(`update media_assets set status = 'failed', failure_reason = 'type_mismatch' where id = $1`, [img2]);
    const reloaded = ContentItem.parse((await request(token, 'GET', `/v1/content/${item.id}`)).body);
    expect(reloaded.slides.map((s) => s.media_asset_id)).toEqual([img1, img2, vid]);
    expect(reloaded.slides[1]).toMatchObject({ status: 'failed', failure_reason: 'type_mismatch', alt_text: 'Black abaya' });
    const listed = ContentListResponse.parse((await request(token, 'GET', '/v1/content')).body);
    expect(listed.items.find((i) => i.id === item.id)?.slides).toHaveLength(3);
    expect(listed.items.find((i) => i.id === item.id)?.slides[1]?.status).toBe('failed');

    // The saved failed slide can be re-sent with the list (reordered): it is already the item's.
    const reordered = await request(token, 'PATCH', `/v1/content/${item.id}`, { slides: [slides[2], slides[0], slides[1]] });
    expect(reordered.res.status).toBe(200);
    expect(ContentItem.parse(reordered.body).slides.map((s) => s.media_asset_id)).toEqual([vid, img1, img2]);
    expect(ContentItem.parse(reordered.body).status).toBe('failed');
    expect((await eventsForContent(storeId, item.id)).slice(-2)).toMatchObject([
      { name: 'content.item.edited', payload: { status: 'processing', changed: ['slides'] } },
      { name: 'content.item.processing_failed', payload: { from: 'processing', to: 'failed' } },
    ]);
  });

  it.each([['POST', 'processed'], ['POST', 'failed'], ['PATCH', 'processed'], ['PATCH', 'failed']] as const)('%s rechecks a stale attachment after media becomes %s before content writes', async (method, status) => {
    const { storeId, token } = await installedStore();
    const target = method === 'PATCH' ? ContentItem.parse((await request(token, 'POST', '/v1/content', validCreateInput)).body).id : null;
    const asset = await seedAsset(storeId, 'video', 'scanned');
    const media = nest.get(MediaService);
    const original = media.getAssetsByIds.bind(media);
    let interleaved = false;
    const spy = vi.spyOn(media, 'getAssetsByIds').mockImplementation(async (store, ids, options) => {
      const result = await original(store, ids, options);
      if (!interleaved && ids.includes(asset) && !options?.lockForAttachment) {
        interleaved = true;
        await admin.query("update media_assets set status = $2, failure_reason = $3 where id = $1", [asset, status, status === 'failed' ? 'processing_failed' : null]);
        // The completion event was already consumed while the asset had no referencing item.
        await withStoreContext(app, storeId, tx => lifecycle.syncSlideProcessing(tx, storeId, asset, async () => new Map([[asset, status]])));
      }
      return result;
    });
    try {
      const created = await request(token, method, target ? `/v1/content/${target}` : '/v1/content', { ...validCreateInput, slides: [{ media_asset_id: asset, alt_text: null }] });
      expect(interleaved).toBe(true);
      if (status === 'failed') {
        expect(created.res.status).toBe(422);
        expect(created.body).toMatchObject({ code: 'media_not_attachable' });
      } else {
        expect(created.res.status).toBe(method === 'POST' ? 201 : 200);
        expect(ContentItem.parse(created.body)).toMatchObject({ status: 'draft', slides: [{ status: 'processed' }] });
      }
    } finally { spy.mockRestore(); }
  });

  it('holds attachment asset locks through commit so a concurrent completion waits for the reference', async () => {
    const { storeId } = await installedStore();
    const asset = await seedAsset(storeId, 'video', 'scanned');
    const media = nest.get(MediaService);
    const commands = nest.get(ContentLifecycle);
    const updater = await admin.connect();
    let update: Promise<pg.QueryResult> | undefined;
    try {
      await updater.query('begin');
      // eslint-disable-next-line no-restricted-syntax -- test-only lock timeout, never changes tenant context
      await updater.query("set local lock_timeout = '5s'");
      const pid = (await updater.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]!.pid;
      const row = await withStoreContext(app, storeId, async tx => {
        const item = await commands.create(tx, storeId, { ...validCreateInput, slides: [{ media_asset_id: asset, alt_text: null }] }, new Date(), new Map([[asset, { kind: 'video', status: 'scanned' }]]));
        update = updater.query("update media_assets set status = 'processed' where id = $1", [asset]);
        await vi.waitFor(async () => {
          const activity = await admin.query('select wait_event_type from pg_stat_activity where pid = $1', [pid]);
          expect(activity.rows[0]?.wait_event_type).toBe('Lock');
        });
        return item;
      });
      await update;
      await updater.query('commit');
      await withStoreContext(app, storeId, tx => commands.syncSlideProcessing(tx, storeId, asset, async ids => new Map([...(await media.getAssetsByIds(storeId, ids))].map(([id, value]) => [id, value.status]))));
      expect((await rowById(row.id))!.status).toBe('draft');
    } finally {
      await update?.catch(() => undefined);
      await updater.query('rollback');
      updater.release();
    }
  });

  it('Story 3.8 processing cycle: draft -> processing when in-flight slides are attached, and processing -> draft when all live slides reach processed (or are edited to processed); deleted items are ignored', async () => {
    const { storeId, token } = await installedStore();
    const s1 = await seedAsset(storeId, 'video', 'scanned');
    const s2 = await seedAsset(storeId, 'image', 'scanned');
    const ready = await seedAsset(storeId, 'image', 'processed');

    // Creating with already-processed slides stays draft.
    const readyDraft = ContentItem.parse(
      (await request(token, 'POST', '/v1/content', { ...validCreateInput, slides: [{ media_asset_id: ready, alt_text: 'Ready' }] })).body,
    );
    expect(readyDraft.status).toBe('draft');
    expect(readyDraft.slides[0]?.poster_url).toBe(`/v1/media/${ready}/poster`);

    // Editing the draft to attach in-flight slides moves it draft -> processing (start_processing).
    const patched = ContentItem.parse(
      (
        await request(token, 'PATCH', `/v1/content/${readyDraft.id}`, {
          slides: [
            { media_asset_id: s1, alt_text: null },
            { media_asset_id: s2, alt_text: 'Second' },
          ],
        })
      ).body,
    );
    expect(patched.status).toBe('processing');
    expect((await eventsForContent(storeId, readyDraft.id)).at(-1)).toMatchObject({
      name: 'content.item.processing_started',
      payload: { from: 'draft', to: 'processing' },
    });

    // Wire worker content event handlers with MediaService.
    const registry = new EventHandlerRegistry();
    registerContentEventHandlers(registry, telemetry, lifecycle, nest.get(MediaService));
    const dispatch = eventDispatcher(app, registry);

    // First slide finishes processing; second is still scanned -> item stays processing.
    await admin.query(`update media_assets set status = 'processed' where id = $1`, [s1]);
    const ev1: EventEnvelope = {
      v: 1,
      trace_id: 't1',
      store_id: storeId,
      event_id: uuidv7(),
      name: 'media.asset.processed',
      occurred_at: new Date().toISOString(),
      payload: { v: 1, store_id: storeId, asset_id: s1, kind: 'video' },
    };
    await dispatch(ev1, { id: ev1.event_id, data: ev1 });
    expect((await rowById(readyDraft.id))!.status).toBe('processing');

    // Second slide finishes processing -> all live slides are processed -> item moves processing -> draft (finish_processing).
    await admin.query(`update media_assets set status = 'processed' where id = $1`, [s2]);
    const ev2: EventEnvelope = {
      v: 1,
      trace_id: 't2',
      store_id: storeId,
      event_id: uuidv7(),
      name: 'media.asset.processed',
      occurred_at: new Date().toISOString(),
      payload: { v: 1, store_id: storeId, asset_id: s2, kind: 'image' },
    };
    await dispatch(ev2, { id: ev2.event_id, data: ev2 });
    expect((await rowById(readyDraft.id))!.status).toBe('draft');
    expect((await eventsForContent(storeId, readyDraft.id)).at(-1)).toMatchObject({
      name: 'content.item.processed',
      payload: { from: 'processing', to: 'draft' },
    });

    // Deleting an item while processing and then receiving media.asset.processed does not fail.
    const s3 = await seedAsset(storeId, 'video', 'scanned');
    const doomed = ContentItem.parse(
      (await request(token, 'POST', '/v1/content', { ...validCreateInput, slides: [{ media_asset_id: s3, alt_text: null }] })).body,
    );
    expect(doomed.status).toBe('processing');
    expect((await request(token, 'DELETE', `/v1/content/${doomed.id}`)).res.status).toBe(204);
    await admin.query(`update media_assets set status = 'processed' where id = $1`, [s3]);
    const ev3: EventEnvelope = {
      v: 1,
      trace_id: 't3',
      store_id: storeId,
      event_id: uuidv7(),
      name: 'media.asset.processed',
      occurred_at: new Date().toISOString(),
      payload: { v: 1, store_id: storeId, asset_id: s3, kind: 'video' },
    };
    await expect(dispatch(ev3, { id: ev3.event_id, data: ev3 })).resolves.not.toThrow();

    // Editing a processing item so all remaining live slides are processed transitions it processing -> draft (finish_processing).
    const s4 = await seedAsset(storeId, 'video', 'scanned');
    const editingToReady = ContentItem.parse(
      (await request(token, 'POST', '/v1/content', { ...validCreateInput, slides: [{ media_asset_id: s4, alt_text: null }] })).body,
    );
    expect(editingToReady.status).toBe('processing');
    const editedReady = ContentItem.parse(
      (await request(token, 'PATCH', `/v1/content/${editingToReady.id}`, { slides: [{ media_asset_id: ready, alt_text: 'Ready' }] })).body,
    );
    expect(editedReady.status).toBe('draft');
    expect((await eventsForContent(storeId, editingToReady.id)).at(-1)).toMatchObject({
      name: 'content.item.processed',
      payload: { from: 'processing', to: 'draft' },
    });

    // Receiving media.asset.scanned on a draft item with a scanned slide transitions it draft -> processing (start_processing).
    const s5 = await seedAsset(storeId, 'video', 'scanned');
    const restoredDraft = await seedItemInStatus(storeId, 'draft');
    await withStoreContext(app, storeId, tx => lifecycle.edit(tx, storeId, restoredDraft.id, { slides: [{ media_asset_id: s5, alt_text: null }] }, new Date(), new Map([[s5, 'video']])));
    const scannedEv: EventEnvelope = {
      v: 1,
      trace_id: 't4',
      store_id: storeId,
      event_id: uuidv7(),
      name: 'media.asset.scanned',
      occurred_at: new Date().toISOString(),
      payload: {
        v: 1,
        store_id: storeId,
        asset_id: s5,
        kind: 'video',
        size_bytes: 1024,
      },
    };
    await dispatch(scannedEv, { id: scannedEv.event_id, data: scannedEv });
    expect((await rowById(restoredDraft.id))!.status).toBe('processing');
    expect((await eventsForContent(storeId, restoredDraft.id)).at(-1)).toMatchObject({
      name: 'content.item.processing_started',
      payload: { from: 'draft', to: 'processing' },
    });
  });

  it('Slides: move later, remove and re-add revive the soft-deleted slide; a no-op writes nothing; a published item stays published', async () => {
    const { storeId, token } = await installedStore();
    const [a, b, c] = [await seedAsset(storeId), await seedAsset(storeId), await seedAsset(storeId, 'video')];
    const item = await seedItemInStatus(storeId, 'published');
    const s = (id: string, alt: string | null = 'alt') => ({ media_asset_id: id, alt_text: alt });
    expect((await request(token, 'PATCH', `/v1/content/${item.id}`, { slides: [s(a), s(b), s(c, null)] })).res.status).toBe(200);
    const [firstA] = (await slideRows(item.id)).filter((r) => r.media_asset_id === a);

    // Move slide 2 later: it becomes 3.
    const moved = ContentItem.parse((await request(token, 'PATCH', `/v1/content/${item.id}`, { slides: [s(a), s(c, null), s(b)] })).body);
    expect(moved.slides.map((x) => x.media_asset_id)).toEqual([a, c, b]);
    expect(moved.status).toBe('published');

    // Same list again: nothing written, no event.
    const eventsBefore = (await eventsForContent(storeId, item.id)).length;
    expect((await request(token, 'PATCH', `/v1/content/${item.id}`, { slides: [s(a), s(c, null), s(b)] })).res.status).toBe(200);
    expect(await eventsForContent(storeId, item.id)).toHaveLength(eventsBefore);

    // Remove a: soft-deleted, not hard-deleted.
    const removed = ContentItem.parse((await request(token, 'PATCH', `/v1/content/${item.id}`, { slides: [s(c, null), s(b)] })).body);
    expect(removed.slides.map((x) => x.media_asset_id)).toEqual([c, b]);
    expect((await slideRows(item.id)).find((r) => r.media_asset_id === a)).toMatchObject({ id: firstA!.id, deleted: true });

    // Re-add a: the same row is revived (one row per asset), at its new position with the new alt text.
    const revived = ContentItem.parse((await request(token, 'PATCH', `/v1/content/${item.id}`, { slides: [s(b), s(a, 'new alt'), s(c, null)] })).body);
    expect(revived.slides.map((x) => [x.media_asset_id, x.alt_text])).toEqual([
      [b, 'alt'],
      [a, 'new alt'],
      [c, null],
    ]);
    const rows = await slideRows(item.id);
    expect(rows.filter((r) => r.media_asset_id === a)).toEqual([expect.objectContaining({ id: firstA!.id, deleted: false, position: 1 })]);
    expect(rows).toHaveLength(3);
    expect(revived.id).toBe(item.id);
    expect((await rowById(item.id))!.status).toBe('published');

    // Clear all slides.
    expect(ContentItem.parse((await request(token, 'PATCH', `/v1/content/${item.id}`, { slides: [] })).body).slides).toEqual([]);
    expect((await slideRows(item.id)).every((r) => r.deleted)).toBe(true);
  });

  it('Slides: other-store, unknown and failed assets answer 422 media-not-attachable; an image without alt text 422 slide-alt-text-required; nothing is written', async () => {
    const { storeId, token } = await installedStore();
    const other = await installedStore();
    const foreign = await seedAsset(other.storeId);
    const failed = await seedAsset(storeId, 'image', 'failed');
    const image = await seedAsset(storeId);
    const draft = await seedItemInStatus(storeId, 'draft');
    const rowBefore = await rowById(draft.id);
    const eventsBefore = (await eventsForContent(storeId, draft.id)).length;

    for (const id of [foreign, failed, randomUUID()]) {
      const res = await request(token, 'PATCH', `/v1/content/${draft.id}`, { title: 'Changed', slides: [{ media_asset_id: id, alt_text: 'x' }] });
      expect(res.res.status).toBe(422);
      expect(res.res.headers.get('content-type')).toContain('application/problem+json');
      expect(res.body).toMatchObject({ type: MEDIA_NOT_ATTACHABLE, status: 422, code: 'media_not_attachable' });
    }
    for (const alt of [null, '   ']) {
      const res = await request(token, 'PATCH', `/v1/content/${draft.id}`, { title: 'Changed', slides: [{ media_asset_id: image, alt_text: alt }] });
      expect(res.res.status).toBe(422);
      expect(res.body).toMatchObject({ type: CONTENT_SLIDE_ALT_REQUIRED, code: 'slide_alt_text_required' });
    }
    expect(await rowById(draft.id)).toEqual(rowBefore);
    expect(await eventsForContent(storeId, draft.id)).toHaveLength(eventsBefore);
    expect(await slideRows(draft.id)).toEqual([]);

    const created = await request(token, 'POST', '/v1/content', { ...validCreateInput, slides: [{ media_asset_id: image, alt_text: null }] });
    expect(created.res.status).toBe(422);
    expect(created.body).toMatchObject({ type: CONTENT_SLIDE_ALT_REQUIRED });
    expect((await request(token, 'POST', '/v1/content', { ...validCreateInput, slides: [{ media_asset_id: failed, alt_text: 'x' }] })).body).toMatchObject({
      type: MEDIA_NOT_ATTACHABLE,
    });
    expect((await admin.query('select 1 from content_items where store_id = $1', [storeId])).rowCount).toBe(1);

    // Duplicate assets and more than 10 slides are invalid bodies; archived items are read-only.
    const dup = await request(token, 'PATCH', `/v1/content/${draft.id}`, { slides: [{ media_asset_id: image, alt_text: 'a' }, { media_asset_id: image, alt_text: 'b' }] });
    expect(dup.res.status).toBe(400);
    const many = Array.from({ length: 11 }, () => ({ media_asset_id: randomUUID(), alt_text: 'x' }));
    expect((await request(token, 'PATCH', `/v1/content/${draft.id}`, { slides: many })).res.status).toBe(400);
    const archived = await seedItemInStatus(storeId, 'archived');
    const ro = await request(token, 'PATCH', `/v1/content/${archived.id}`, { slides: [{ media_asset_id: image, alt_text: 'x' }] });
    expect(ro.res.status).toBe(409);
  });
});

describe('worker content event handlers & store data lifecycle', () => {
  it('dispatches all 14 content events to the logging handlers without error', async () => {
    const registry = new EventHandlerRegistry();
    registerContentEventHandlers(registry, telemetry, lifecycle);
    const dispatch = eventDispatcher(app, registry);
    const storeId = randomUUID();
    const contentId = uuidv7();

    for (const name of CONTENT_EVENT_NAMES) {
      const payload =
        name === 'content.item.created'
          ? { v: 1, store_id: storeId, content_id: contentId, from: null, to: 'draft' }
          : name === 'content.item.deleted'
            ? { v: 1, store_id: storeId, content_id: contentId, from: 'draft' }
            : name === 'content.item.edited'
              ? { v: 1, store_id: storeId, content_id: contentId, status: 'draft', changed: ['title'] }
              : { v: 1, store_id: storeId, content_id: contentId, from: 'draft', to: 'published' };
      const envelope: EventEnvelope = {
        v: 1,
        trace_id: 't',
        store_id: storeId,
        event_id: uuidv7(),
        name,
        occurred_at: new Date().toISOString(),
        payload,
      };
      await expect(dispatch(envelope, { id: envelope.event_id, data: envelope })).resolves.not.toThrow();
    }
  });

  it('contentStoreData exports, restores (no-op) and purges content items and their product links in batches', async () => {
    const storeId = randomUUID();
    for (let i = 0; i < 3; i++) await seedItemInStatus(storeId, 'draft');
    const linked = await seedItemInStatus(storeId, 'draft');
    await withStoreContext(app, storeId, (tx) => lifecycle.edit(tx, storeId, linked.id, { product_id: randomUUID() }));
    const assetA = randomUUID();
    const assetB = randomUUID();
    const kinds = new Map([
      [assetA, 'image' as const],
      [assetB, 'video' as const],
    ]);
    const s = (id: string, alt: string | null) => ({ media_asset_id: id, alt_text: alt });
    await withStoreContext(app, storeId, (tx) => lifecycle.edit(tx, storeId, linked.id, { slides: [s(assetA, 'a'), s(assetB, null)] }, new Date(), kinds));
    await withStoreContext(app, storeId, (tx) => lifecycle.edit(tx, storeId, linked.id, { slides: [s(assetB, null)] }, new Date(), kinds));

    await withStoreContext(app, storeId, (tx) => contentStoreData.restore!({ storeId, installEpoch: 1, tx }));
    const exported = (await withStoreContext(app, storeId, (tx) => contentStoreData.export!({ storeId, installEpoch: 1, tx }))) as {
      content_items: Array<Record<string, unknown>>;
    };
    expect(exported.content_items).toHaveLength(4);
    expect((exported as unknown as { placements: unknown[] }).placements).toHaveLength(4);
    expect((exported as unknown as { placements: Array<Record<string, unknown>> }).placements.every(p => p.layout === 'ring')).toBe(true);
    expect((exported as unknown as { content_product_links: Array<Record<string, unknown>> }).content_product_links).toEqual([
      expect.objectContaining({ content_id: linked.id, slide_id: null }),
    ]);
    expect(exported.content_items[0]).not.toHaveProperty('store_id');
    const exportedSlides = (exported as unknown as { slides: Array<Record<string, unknown>> }).slides;
    expect(exportedSlides).toHaveLength(2);
    expect(exportedSlides.find((r) => r.media_asset_id === assetA)).toMatchObject({ content_id: linked.id, kind: 'image', alt_text: 'a', deleted_at: expect.any(Date) });
    expect(exportedSlides[0]).not.toHaveProperty('store_id');

    const purge = () => withStoreContext(app, storeId, (tx) => contentStoreData.purge({ storeId, installEpoch: 1, tx, batchLimit: 2 }));
    // Two placement batches, then slides, then the link and content item batches.
    expect(await purge()).toEqual({ done: false });
    expect(await purge()).toEqual({ done: false });
    expect(await purge()).toEqual({ done: false });
    expect(await purge()).toEqual({ done: false });
    expect(await purge()).toEqual({ done: false });
    expect(await purge()).toEqual({ done: true });
    expect((await admin.query('select 1 from content_items where store_id = $1', [storeId])).rowCount).toBe(0);
    expect((await admin.query('select 1 from content_product_links where store_id = $1', [storeId])).rowCount).toBe(0);
    expect((await admin.query('select 1 from slides where store_id = $1', [storeId])).rowCount).toBe(0);
    expect((await admin.query('select 1 from placements where store_id = $1', [storeId])).rowCount).toBe(0);
  });
});
