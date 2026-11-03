// Story 3.1 composition tests: live Postgres (non-owner RLS role, real pg-boss outbox), ContentLifecycle state machine
// exhaustive (status, action) matrix, and the merchant content API over HTTP.
import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CONTENT_ACTIONS,
  CONTENT_EVENT_NAMES,
  CONTENT_INVALID_TRANSITION,
  CONTENT_STATUSES,
  CONTENT_TRANSITIONS,
  ContentItem,
  EVENT_QUEUE,
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
import { ContentLifecycle, InvalidTransitionError } from '../modules/content/content-lifecycle.js';
import { contentStoreData } from '../modules/content/content.lifecycle.js';
import { SessionService } from '../modules/session/session.service.js';
import { registerContentEventHandlers } from '../worker/content-jobs.js';

const ADMIN_URL = 'postgres://slips:slips@127.0.0.1:5433/slips';
const APP_URL = 'postgres://slips_it_content_comp:it_content_comp_pw@127.0.0.1:5433/slips';
const SCHEMA = 'pgboss_content_test';
const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const lines: string[] = [];
const telemetry = new PinoTelemetry({ role: 'http', level: 'debug', stream: { write: (l: string) => void lines.push(l) } });

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 4 });
let app: pg.Pool;
let boss: PgBoss;
let lifecycle: ContentLifecycle;

const validCreateInput = {
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
      `insert into stores (id, store_id, platform, platform_store_id, name) values ($1, $1, 'salla', $2, 'Content Store') on conflict do nothing`,
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
});

describe('worker content event handlers & store data lifecycle', () => {
  it('dispatches all 13 content events to the logging handlers without error', async () => {
    const registry = new EventHandlerRegistry();
    registerContentEventHandlers(registry, telemetry);
    const dispatch = eventDispatcher(app, registry);
    const storeId = randomUUID();
    const contentId = uuidv7();

    for (const name of CONTENT_EVENT_NAMES) {
      const payload =
        name === 'content.item.created'
          ? { v: 1, store_id: storeId, content_id: contentId, from: null, to: 'draft' }
          : name === 'content.item.deleted'
            ? { v: 1, store_id: storeId, content_id: contentId, from: 'draft' }
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

  it('contentStoreData exports, restores (no-op) and purges content items in batches', async () => {
    const storeId = randomUUID();
    for (let i = 0; i < 3; i++) await seedItemInStatus(storeId, 'draft');

    await withStoreContext(app, storeId, (tx) => contentStoreData.restore!({ storeId, installEpoch: 1, tx }));
    const exported = (await withStoreContext(app, storeId, (tx) => contentStoreData.export!({ storeId, installEpoch: 1, tx }))) as {
      content_items: Array<Record<string, unknown>>;
    };
    expect(exported.content_items).toHaveLength(3);
    expect(exported.content_items[0]).not.toHaveProperty('store_id');

    const purge = () => withStoreContext(app, storeId, (tx) => contentStoreData.purge({ storeId, installEpoch: 1, tx, batchLimit: 2 }));
    expect(await purge()).toEqual({ done: false });
    expect(await purge()).toEqual({ done: true });
    expect((await admin.query('select 1 from content_items where store_id = $1', [storeId])).rowCount).toBe(0);
  });
});
