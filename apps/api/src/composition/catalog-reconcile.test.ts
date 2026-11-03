// Story 2.6 composition tests: the daily catalog reconcile against live Postgres (non-owner RLS role, real pg-boss outbox),
// a fake CommercePlatform (pages plus a per-id `get` answer) and a fake token source standing in for
// integration.getAccessToken. One test per I/O matrix row, plus the fan-out, failure isolation, rollback and queue policy.
import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CatalogSyncStatus, EVENT_QUEUE, PRODUCT_VISIBLE_FIELDS, type EventEnvelope } from '@slips/contracts';
import { ensureTestAppRole, runMigrations, withStoreContext } from '@slips/db';
import { EnvelopeTokenCipher } from '../adapters/crypto/envelope-cipher.js';
import { instrumentJob } from '../adapters/telemetry/jobs.js';
import { PinoTelemetry } from '../adapters/telemetry/pino-telemetry.js';
import type { EventSender } from '../events/outbox.js';
import { grantEventPublishing } from '../events/queue-grants.js';
import { createHttpApp } from '../http.js';
import type { SessionConfig } from '../infra.module.js';
import { CatalogRepository } from '../modules/catalog/catalog.repository.js';
import { ABSENT_BATCH_SIZE, CATALOG_RECONCILE_QUEUE, CATALOG_RECONCILE_SCHEDULE_QUEUE, CatalogReconcile, ReconcileJob, reconcileOffsetSeconds } from '../modules/catalog/catalog-reconcile.js';
import { CatalogSync } from '../modules/catalog/catalog-sync.js';
import { toProductWrites } from '../modules/catalog/product-writes.js';
import { StoreDisconnectedError, StoreNotConnectedError } from '../modules/integration/errors.js';
import { IntegrationService } from '../modules/integration/integration.service.js';
import { SessionService } from '../modules/session/session.service.js';
import { PlatformUnavailableError, type CanonicalProduct, type CommercePlatform, type ProductPage } from '../ports/commerce-platform.js';
import { Metric } from '../ports/telemetry.js';
import { catalogJobHandlers, fanOutReconcile, RECONCILE_EXPIRE_SECONDS, RECONCILE_FANOUT_PAGE, RECONCILE_SINGLETON_SECONDS, type ActiveStoreSource } from '../worker/catalog-jobs.js';
import { QUEUES, queueOptions } from '../worker/queues.js';

const ADMIN_URL = 'postgres://slips:slips@127.0.0.1:5433/slips';
const APP_URL = 'postgres://slips_it_reconcile:it_reconcile_pw@127.0.0.1:5433/slips';
const SCHEMA = 'pgboss_reconcile_test';
const lines: string[] = [];
const telemetry = new PinoTelemetry({ role: 'worker', level: 'debug', stream: { write: (l: string) => void lines.push(l) } });
// Recorded by hand: the shared vitest preset restores spies before each test.
const counted: Array<[string, Record<string, string> | undefined, number | undefined]> = [];
const realCounter = telemetry.counter.bind(telemetry);
telemetry.counter = (name, labels, value) => {
  counted.push([name, labels as Record<string, string> | undefined, value]);
  realCounter(name, labels, value);
};
const countOf = (metric: string, label: string, value: string) => counted.filter((c) => c[0] === metric && c[1]?.[label] === value).reduce((n, c) => n + (c[2] ?? 1), 0);

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 4 });
let app: pg.Pool;
let boss: PgBoss;
let integration: IntegrationService;
const T = (iso: string) => new Date(iso);
/** Listing/fetch clock used by most tests: after every product time below. */
const NOW = T('2026-11-01T01:00:00Z').getTime();

const product = (id: string, over: Partial<CanonicalProduct> = {}): CanonicalProduct => ({
  externalId: id,
  name: `Product ${id}`,
  imageUrl: `https://cdn.example.com/${id}.jpg`,
  categories: [{ externalId: 'c1', name: 'Abayas' }],
  price: '12.50',
  salePrice: null,
  currency: 'SAR',
  taxInclusive: true,
  stock: 10,
  hasRequiredOptions: false,
  visible: true,
  sourceUpdatedAt: T('2026-10-30T09:00:00Z'),
  ...over,
});

/** Pages of products; `gets` answers `products.get` per id (null = not found; an Error is thrown). */
class FakePlatform {
  readonly platform = 'salla' as const;
  calls: number[] = [];
  getCalls: string[] = [];
  fail = new Map<number, Error>();
  gets = new Map<string, CanonicalProduct | null | Error>();
  skippedIds = new Map<number, string[]>();
  /** Runs while a page request is in flight (between request start and response). */
  onList?: (page: number) => Promise<void>;
  constructor(public pages: CanonicalProduct[][]) {}
  readonly products = {
    list: async (_session: { storeId: string; accessToken: string }, page: number): Promise<ProductPage> => {
      this.calls.push(page);
      await this.onList?.(page);
      const err = this.fail.get(page);
      if (err) {
        this.fail.delete(page);
        throw err;
      }
      const skippedExternalIds = this.skippedIds.get(page) ?? [];
      return { items: this.pages[page - 1] ?? [], skipped: skippedExternalIds.length, skippedExternalIds, hasMore: page < this.pages.length };
    },
    get: async (_session: { storeId: string; accessToken: string }, externalId: string): Promise<CanonicalProduct | null> => {
      this.getCalls.push(externalId);
      const answer = this.gets.get(externalId);
      if (answer instanceof Error) throw answer;
      if (answer === undefined) throw new Error(`test did not expect a get of ${externalId}`);
      return answer;
    },
  };
  // Catalog must never refresh tokens itself (AD-4).
  readonly auth = new Proxy({}, { get: () => () => { throw new Error('catalog called platform.auth'); } });
}

class FakeTokens {
  calls = 0;
  error?: Error;
  async getAccessToken(): Promise<string> {
    this.calls++;
    if (this.error) throw this.error;
    return `AT-${this.calls}`;
  }
}

const reconcileFor = (platform: FakePlatform, opts: { tokens?: FakeTokens; now?: () => number; events?: EventSender } = {}) =>
  new CatalogReconcile(app, platform as unknown as CommercePlatform, opts.tokens ?? new FakeTokens(), telemetry, opts.events ?? boss, opts.now ?? (() => NOW));
const LAST = { finalAttempt: true };
const NOT_LAST = { finalAttempt: false };

const repo = new CatalogRepository();
/** Store rows as the full sync would (no events), each with the given product time. */
const seed = (storeId: string, ...items: CanonicalProduct[]) =>
  withStoreContext(app, storeId, async () => {
    const { products, categories } = toProductWrites('salla', items, T('2026-10-30T09:00:00Z'));
    await repo.upsertCategories(categories);
    await repo.upsertProducts(products);
  });
const tombstone = (storeId: string, externalId: string, at: Date) =>
  withStoreContext(app, storeId, async () => {
    await repo.lockProductWrites();
    return repo.tombstoneProducts('salla', [externalId], at);
  });
const productRow = async (storeId: string, externalId: string) =>
  (await admin.query('select *, price_minor::int as price_minor from products where store_id = $1 and external_id = $2', [storeId, externalId])).rows[0] as Record<string, unknown> | undefined;
const stateOf = async (storeId: string) => (await admin.query('select * from catalog_sync_state where store_id = $1', [storeId])).rows[0] as Record<string, unknown> | undefined;
const eventsOf = async (storeId: string, name: string) =>
  (await admin.query<{ data: EventEnvelope }>(`select data from ${SCHEMA}.job where name = $1 and data->>'store_id' = $2 and data->>'name' = $3 order by created_on`, [EVENT_QUEUE, storeId, name])).rows.map((r) => r.data);
const insertStore = (id: string, state = 'active') =>
  admin.query(`insert into stores (id, store_id, platform, platform_store_id, name, lifecycle_state) values ($1, $1, 'salla', $2, 'Reconcile Store', $3)`, [id, `rec-${id}`, state]);
const finishedLine = (storeId: string) => lines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l.msg === 'catalog reconcile finished' && l.store_id === storeId);

beforeAll(async () => {
  await runMigrations(admin);
  await ensureTestAppRole(admin, 'slips_it_reconcile', 'it_reconcile_pw');
  app = new pg.Pool({ connectionString: APP_URL, max: 6 });
  await admin.query(`drop schema if exists ${SCHEMA} cascade`);
  boss = new PgBoss({ connectionString: ADMIN_URL, schema: SCHEMA });
  await boss.start();
  await boss.createQueue(EVENT_QUEUE);
  await boss.createQueue(CATALOG_RECONCILE_QUEUE);
  await grantEventPublishing(admin, telemetry, EVENT_QUEUE, SCHEMA, 'slips_app');
  const cipher = new EnvelopeTokenCipher({ k1: randomBytes(32).toString('base64') }, 'k1');
  integration = new IntegrationService(app, new FakePlatform([]) as unknown as CommercePlatform, cipher, telemetry, boss, { dashboardUrl: 'https://dash.example.com', stateSecret: randomBytes(32), secureCookies: false });
});
afterAll(async () => {
  await boss?.stop({ graceful: false });
  await admin.query(`drop schema if exists ${SCHEMA} cascade`);
  await app?.end();
  await admin.end();
});

describe('reconcile matrix', () => {
  it('Missing: a product Salla has and Slips does not is created, counted created, with no event', async () => {
    const storeId = randomUUID();
    const platform = new FakePlatform([[product('p1', { stock: 3 })]]);
    expect(await reconcileFor(platform).run(storeId, NOT_LAST)).toEqual({ finished: { created: 1, updated: 0, deleted: 0, unchanged: 0, stale: 0, skipped: 0 } });
    expect(await productRow(storeId, 'p1')).toMatchObject({ price_minor: 1250, availability: 'low', deleted_at: null });
    expect(await eventsOf(storeId, 'catalog.product.updated')).toHaveLength(0);
    expect(platform.getCalls).toEqual([]);
  });

  it('Differs: a missed price/stock change is written and announced with the changed visible fields', async () => {
    const storeId = randomUUID();
    await seed(storeId, product('p1'));
    const platform = new FakePlatform([[product('p1', { price: '15.00', stock: 0, sourceUpdatedAt: T('2026-10-31T09:00:00Z') })]]);
    expect(await reconcileFor(platform).run(storeId, NOT_LAST)).toMatchObject({ finished: { updated: 1, created: 0 } });
    expect(await productRow(storeId, 'p1')).toMatchObject({ price_minor: 1500, stock: 0, availability: 'out_of_stock' });
    const events = await eventsOf(storeId, 'catalog.product.updated');
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ external_id: 'p1', changed: ['price_minor', 'availability'], price_minor: 1500, availability: 'out_of_stock' });
  });

  it('Non-visible diff: stock within the same bucket and a changed category list are written, counted updated, with no event', async () => {
    const storeId = randomUUID();
    await seed(storeId, product('p1', { stock: 10 }));
    const platform = new FakePlatform([[product('p1', { stock: 8, categories: [{ externalId: 'c2', name: 'Gifts' }], sourceUpdatedAt: T('2026-10-31T09:00:00Z') })]]);
    expect(await reconcileFor(platform).run(storeId, NOT_LAST)).toMatchObject({ finished: { updated: 1, unchanged: 0 } });
    expect(await productRow(storeId, 'p1')).toMatchObject({ stock: 8, category_external_ids: ['c2'], availability: 'available' });
    expect(await eventsOf(storeId, 'catalog.product.updated')).toHaveLength(0);
  });

  it('Non-visible diff at the same source time: different stock and category list are written, counted updated, with no event', async () => {
    const storeId = randomUUID();
    await seed(storeId, product('p1', { stock: 10 }));
    const platform = new FakePlatform([[product('p1', { stock: 7, categories: [{ externalId: 'c3', name: 'New' }] })]]);
    expect(await reconcileFor(platform).run(storeId, NOT_LAST)).toMatchObject({ finished: { updated: 1, unchanged: 0, stale: 0 } });
    expect(await productRow(storeId, 'p1')).toMatchObject({ stock: 7, category_external_ids: ['c3'] });
    expect(await eventsOf(storeId, 'catalog.product.updated')).toHaveLength(0);
  });

  it('a deletion applied while the listing request is in flight is not revived by that listing', async () => {
    const storeId = randomUUID();
    await seed(storeId, product('p1'));
    let clock = NOW;
    const platform = new FakePlatform([[product('p1')]]);
    // The product.deleted webhook lands after the request started and before Salla's answer arrives.
    platform.onList = async () => {
      await tombstone(storeId, 'p1', new Date(NOW + 1000));
      clock = NOW + 2000;
    };
    expect(await reconcileFor(platform, { now: () => clock }).run(storeId, NOT_LAST)).toMatchObject({ finished: { stale: 1, updated: 0 } });
    expect((await productRow(storeId, 'p1'))!.deleted_at).toEqual(new Date(NOW + 1000));
    expect(await eventsOf(storeId, 'catalog.product.updated')).toHaveLength(0);
  });

  it('Unchanged: a listing equal to the stored row writes nothing and is counted unchanged', async () => {
    const storeId = randomUUID();
    await seed(storeId, product('p1'));
    const before = await productRow(storeId, 'p1');
    const platform = new FakePlatform([[product('p1')]]);
    expect(await reconcileFor(platform).run(storeId, NOT_LAST)).toEqual({ finished: { created: 0, updated: 0, deleted: 0, unchanged: 1, stale: 0, skipped: 0 } });
    expect((await productRow(storeId, 'p1'))!.updated_at).toEqual(before!.updated_at);
    expect(await eventsOf(storeId, 'catalog.product.updated')).toHaveLength(0);
  });

  it('Stale: a stored copy newer than the listing is kept and the skip is counted (source reconcile)', async () => {
    const storeId = randomUUID();
    await seed(storeId, product('p1', { price: '20.00', sourceUpdatedAt: T('2026-10-31T12:00:00Z') }));
    const staleBefore = countOf(Metric.CatalogStaleWrites, 'source', 'reconcile');
    const platform = new FakePlatform([[product('p1', { price: '15.00', sourceUpdatedAt: T('2026-10-31T09:00:00Z') })]]);
    expect(await reconcileFor(platform).run(storeId, NOT_LAST)).toMatchObject({ finished: { stale: 1, updated: 0 } });
    expect(await productRow(storeId, 'p1')).toMatchObject({ price_minor: 2000 });
    expect(countOf(Metric.CatalogStaleWrites, 'source', 'reconcile') - staleBefore).toBe(1);
  });

  it('Absent, gone: a live product missing from the listing that get answers "not found" for is tombstoned and announced', async () => {
    const storeId = randomUUID();
    await seed(storeId, product('p1'), product('p2'));
    const platform = new FakePlatform([[product('p1')]]);
    platform.gets.set('p2', null);
    const getAt = NOW + 5_000;
    const result = await reconcileFor(platform, { now: () => (platform.getCalls.length > 0 ? getAt : NOW) }).run(storeId, NOT_LAST);
    expect(result).toMatchObject({ finished: { deleted: 1, unchanged: 1 } });
    expect(platform.getCalls).toEqual(['p2']);
    const row = await productRow(storeId, 'p2');
    expect((row!.deleted_at as Date).getTime()).toBe(getAt);
    const deleted = await eventsOf(storeId, 'catalog.product.deleted');
    expect(deleted.map((e) => e.payload)).toEqual([{ v: 1, store_id: storeId, product_id: row!.id, external_id: 'p2' }]);
    expect(lines.some((l) => l.includes('"msg":"product deleted"') && l.includes('"source":"reconcile"') && l.includes(storeId))).toBe(true);
  });

  it('Absent, exists: a live product missing from the listing (paging drift) that get returns is written like a listed one, not deleted', async () => {
    const storeId = randomUUID();
    await seed(storeId, product('p1'), product('p2'));
    const platform = new FakePlatform([[product('p1')]]);
    platform.gets.set('p2', product('p2', { price: '9.00', sourceUpdatedAt: T('2026-10-31T09:00:00Z') }));
    expect(await reconcileFor(platform).run(storeId, NOT_LAST)).toMatchObject({ finished: { deleted: 0, updated: 1, unchanged: 1 } });
    expect(await productRow(storeId, 'p2')).toMatchObject({ deleted_at: null, price_minor: 900 });
    expect(await eventsOf(storeId, 'catalog.product.deleted')).toHaveLength(0);
    expect((await eventsOf(storeId, 'catalog.product.updated')).map((e) => (e.payload as { changed: string[] }).changed)).toEqual([['price_minor']]);
  });

  it('Revive: a tombstoned product listed after its deletion is revived with every visible field announced, at the listing time', async () => {
    const storeId = randomUUID();
    await seed(storeId, product('p1'));
    // A false 404 tombstoned it after Salla's own (older) change time.
    const deletedAt = T('2026-10-31T00:00:00Z');
    await tombstone(storeId, 'p1', deletedAt);
    // Fetched before the deletion: not evidence that it came back.
    expect(await reconcileFor(new FakePlatform([[product('p1')]]), { now: () => deletedAt.getTime() - 1000 }).run(storeId, NOT_LAST)).toMatchObject({ finished: { stale: 1, updated: 0 } });
    expect((await productRow(storeId, 'p1'))!.deleted_at).not.toBeNull();

    expect(await reconcileFor(new FakePlatform([[product('p1')]])).run(storeId, NOT_LAST)).toMatchObject({ finished: { updated: 1, deleted: 0 } });
    const row = await productRow(storeId, 'p1');
    expect(row!.deleted_at).toBeNull();
    expect((row!.source_updated_at as Date).getTime()).toBe(NOW);
    const events = await eventsOf(storeId, 'catalog.product.updated');
    expect(events).toHaveLength(1);
    expect((events[0]!.payload as { changed: string[] }).changed).toEqual([...PRODUCT_VISIBLE_FIELDS]);
  });

  it('Unreadable: a listed item the adapter could not read (id readable) is not written, never a deletion candidate, and counted skipped', async () => {
    const storeId = randomUUID();
    await seed(storeId, product('p1'), product('p9'), product('p8'));
    const platform = new FakePlatform([[product('p1'), product('p8', { currency: 'XXX' })]]);
    platform.skippedIds.set(1, ['p9']);
    const result = await reconcileFor(platform).run(storeId, NOT_LAST);
    expect(result).toEqual({ finished: { created: 0, updated: 0, deleted: 0, unchanged: 1, stale: 0, skipped: 2 } });
    expect(platform.getCalls).toEqual([]);
    expect(await productRow(storeId, 'p9')).toMatchObject({ deleted_at: null });
    expect(await productRow(storeId, 'p8')).toMatchObject({ deleted_at: null, currency: 'SAR' });
  });

  it.each([new StoreDisconnectedError(), new StoreNotConnectedError()])('Disconnected (%s): nothing is fetched or written; a skip line, no retry', async (error) => {
    const storeId = randomUUID();
    await seed(storeId, product('p1'));
    const platform = new FakePlatform([[product('p1', { price: '99.00', sourceUpdatedAt: T('2026-10-31T09:00:00Z') })]]);
    const tokens = new FakeTokens();
    tokens.error = error;
    const handler = catalogJobHandlers({} as CatalogSync, reconcileFor(platform, { tokens }), { activeStoreIds: async () => [] }, boss, telemetry)[CATALOG_RECONCILE_QUEUE]!;
    const job: ReconcileJob = { v: 1, trace_id: 'disc', store_id: storeId };
    await expect(telemetry.withContext({ store_id: storeId }, () => handler(job, { id: 'j', data: job, retryCount: 0, retryLimit: 4 }))).resolves.toBeUndefined();
    expect(platform.calls).toEqual([]);
    expect(await productRow(storeId, 'p1')).toMatchObject({ price_minor: 1250 });
    expect(await stateOf(storeId)).toBeUndefined();
    expect(lines.some((l) => l.includes('"msg":"catalog reconcile skipped"') && l.includes('"reason":"disconnected"') && l.includes(storeId))).toBe(true);
  });

  it('Outage: list or get throwing PlatformUnavailableError fails the attempt; the retry restarts from page 1; the last attempt logs a warning', async () => {
    const storeId = randomUUID();
    await seed(storeId, product('p1'), product('p3'));
    const platform = new FakePlatform([[product('p1')], [product('p2')]]);
    platform.fail.set(2, new PlatformUnavailableError('503'));
    const reconcile = reconcileFor(platform);
    await expect(reconcile.run(storeId, NOT_LAST)).rejects.toBeInstanceOf(PlatformUnavailableError);
    // The failed attempt neither deleted anything nor moved the last sync time.
    expect(await productRow(storeId, 'p3')).toMatchObject({ deleted_at: null });
    expect(await stateOf(storeId)).toBeUndefined();
    platform.gets.set('p3', new PlatformUnavailableError('503'));
    await expect(telemetry.withContext({ store_id: storeId }, () => reconcile.run(storeId, LAST))).rejects.toBeInstanceOf(PlatformUnavailableError);
    expect(platform.calls).toEqual([1, 2, 1, 2]);
    expect(await productRow(storeId, 'p3')).toMatchObject({ deleted_at: null });
    expect(lines.some((l) => l.includes('"msg":"catalog reconcile failed after its last attempt"') && l.includes(storeId))).toBe(true);
  });

  it('Never synced: the catalog is imported and a succeeded sync-state row is inserted with the last sync time', async () => {
    const storeId = randomUUID();
    await reconcileFor(new FakePlatform([[product('p1')]])).run(storeId, NOT_LAST);
    const state = await stateOf(storeId);
    expect(state).toMatchObject({ status: 'succeeded', reason: null });
    expect((state!.last_synced_at as Date).getTime()).toBe(NOW);
    expect(state!.run_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('an existing sync-state row only gets its last sync time moved (status, run id and updated_at kept)', async () => {
    const storeId = randomUUID();
    const sync = new CatalogSync(app, new FakePlatform([[product('p1')]]) as unknown as CommercePlatform, new FakeTokens(), telemetry, boss);
    await sync.run(storeId, randomUUID(), NOT_LAST);
    await admin.query(`update catalog_sync_state set status = 'failed', reason = 'internal', last_synced_at = '2026-10-01T00:00:00Z' where store_id = $1`, [storeId]);
    const before = await stateOf(storeId);
    await reconcileFor(new FakePlatform([[product('p1')]])).run(storeId, NOT_LAST);
    const after = await stateOf(storeId);
    expect(after).toMatchObject({ status: 'failed', reason: 'internal', run_id: before!.run_id, updated_at: before!.updated_at, finished_at: before!.finished_at });
    expect((after!.last_synced_at as Date).getTime()).toBe(NOW);
    // A full sync that finished later than a reconcile keeps its time: the last sync time never moves backwards.
    const later = new Date(NOW + 3_600_000);
    await admin.query('update catalog_sync_state set last_synced_at = $2 where store_id = $1', [storeId, later]);
    await reconcileFor(new FakePlatform([[product('p1')]])).run(storeId, NOT_LAST);
    expect((await stateOf(storeId))!.last_synced_at).toEqual(later);
  });

  it('confirms many absent products in batches and tombstones only the ones Salla does not have', async () => {
    const storeId = randomUUID();
    const local = Array.from({ length: ABSENT_BATCH_SIZE + 5 }, (_, i) => product(`a${String(i).padStart(3, '0')}`));
    await seed(storeId, ...local);
    const platform = new FakePlatform([[]]);
    local.forEach((p, i) => platform.gets.set(p.externalId, i % 2 === 0 ? null : p));
    const result = await reconcileFor(platform).run(storeId, NOT_LAST);
    expect(result).toMatchObject({ finished: { deleted: Math.ceil(local.length / 2), unchanged: Math.floor(local.length / 2) } });
    expect(await eventsOf(storeId, 'catalog.product.deleted')).toHaveLength(Math.ceil(local.length / 2));
  });
});

describe('reconcile job', () => {
  it('logs one finished line with the counts, store_id and trace_id from the job context, and meters the outcomes', async () => {
    const storeId = randomUUID();
    await seed(storeId, product('p1'), product('p2'), product('p3'));
    const platform = new FakePlatform([[product('p1'), product('p2', { price: '1.00', sourceUpdatedAt: T('2026-10-31T09:00:00Z') }), product('p4')]]);
    platform.gets.set('p3', null);
    const before = Object.fromEntries(['created', 'updated', 'deleted', 'unchanged'].map((o) => [o, countOf(Metric.CatalogReconcileProducts, 'outcome', o)]));
    const handlers = catalogJobHandlers({} as CatalogSync, reconcileFor(platform), { activeStoreIds: async () => [] }, boss, telemetry);
    const job: ReconcileJob = { v: 1, trace_id: 'trace-reconcile-1', store_id: storeId };
    await instrumentJob(telemetry, CATALOG_RECONCILE_QUEUE, handlers[CATALOG_RECONCILE_QUEUE]!)([{ id: 'job-1', data: job, retryCount: 0, retryLimit: 4 }]);
    const finished = finishedLine(storeId);
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({ trace_id: 'trace-reconcile-1', store_id: storeId, created: 1, updated: 1, deleted: 1, unchanged: 1, stale: 0, skipped: 0 });
    for (const outcome of ['created', 'updated', 'deleted', 'unchanged']) expect(countOf(Metric.CatalogReconcileProducts, 'outcome', outcome) - before[outcome]!).toBe(1);
    expect(new PinoTelemetry({ role: 'worker', level: 'silent' }).registry.render()).toContain('slips_catalog_reconcile_products_total{outcome="unchanged"} 0');
  });

  it('a rolled-back page leaves no event and no row', async () => {
    const storeId = randomUUID();
    await seed(storeId, product('p1'));
    const failing: EventSender = { send: async () => { throw new Error('outbox down'); } };
    const platform = new FakePlatform([[product('p1', { price: '30.00', sourceUpdatedAt: T('2026-10-31T09:00:00Z') }), product('p2')]]);
    await expect(reconcileFor(platform, { events: failing }).run(storeId, NOT_LAST)).rejects.toThrow('outbox down');
    expect(await productRow(storeId, 'p1')).toMatchObject({ price_minor: 1250 });
    expect(await productRow(storeId, 'p2')).toBeUndefined();
    expect(await eventsOf(storeId, 'catalog.product.updated')).toHaveLength(0);
  });

  it('the last attempt of a failing store logs the last-attempt warning and rethrows', async () => {
    const storeId = randomUUID();
    const platform = new FakePlatform([[product('p1')]]);
    platform.fail.set(1, new PlatformUnavailableError('503'));
    const handler = catalogJobHandlers({} as CatalogSync, reconcileFor(platform), { activeStoreIds: async () => [] }, boss, telemetry)[CATALOG_RECONCILE_QUEUE]!;
    const job: ReconcileJob = { v: 1, trace_id: 'last-attempt', store_id: storeId };
    await expect(telemetry.withContext({ store_id: storeId }, () => handler(job, { id: 'j', data: job, retryCount: 4, retryLimit: 4 }))).rejects.toBeInstanceOf(PlatformUnavailableError);
    expect(lines.some((l) => l.includes('"msg":"catalog reconcile failed after its last attempt"') && l.includes(storeId))).toBe(true);
  });

  it('one store failing does not stop the next store’s job', async () => {
    const a = randomUUID();
    const b = randomUUID();
    const failingPlatform = new FakePlatform([[product('pa')]]);
    failingPlatform.fail.set(1, new PlatformUnavailableError('503'));
    const stores: Record<string, FakePlatform> = { [a]: failingPlatform, [b]: new FakePlatform([[product('pb')]]) };
    const results: string[] = [];
    for (const storeId of [a, b]) {
      const handler = catalogJobHandlers({} as CatalogSync, reconcileFor(stores[storeId]!), { activeStoreIds: async () => [] }, boss, telemetry)[CATALOG_RECONCILE_QUEUE]!;
      const job: ReconcileJob = { v: 1, trace_id: `t-${storeId}`, store_id: storeId };
      results.push(await handler(job, { id: storeId, data: job, retryCount: 0, retryLimit: 4 }).then(() => 'ok', () => 'failed'));
    }
    expect(results).toEqual(['failed', 'ok']);
    expect(await productRow(b, 'pb')).toBeDefined();
    expect(await productRow(a, 'pa')).toBeUndefined();
  });

  it('a finished reconcile shows its time as the last sync time on GET /v1/catalog/sync', async () => {
    const sessionConfig: SessionConfig = { secret: randomBytes(32), secureCookies: true, embeddedTtlMs: 15 * 60_000, directMaxAgeMs: 3_600_000, idleMs: 3_600_000 };
    const nest: INestApplication = await createHttpApp({ CORS_ORIGINS: 'http://localhost:3000', LOG_LEVEL: 'silent' }, { pool: new pg.Pool({ connectionString: APP_URL, max: 2 }), events: boss, telemetry, session: sessionConfig });
    try {
      await nest.listen(0);
      const storeId = randomUUID();
      await insertStore(storeId);
      const token = (await nest.get(SessionService).create(storeId, 'embedded')).token;
      const status = async () => CatalogSyncStatus.parse(await (await fetch(`${await nest.getUrl()}/v1/catalog/sync`, { headers: { authorization: `Bearer ${token}` } })).json());
      expect(await status()).toMatchObject({ status: 'never', last_synced_at: null });
      const finishedAt = Date.now();
      await reconcileFor(new FakePlatform([[product('p1')]]), { now: () => finishedAt }).run(storeId, NOT_LAST);
      expect(await status()).toMatchObject({ status: 'succeeded', last_synced_at: new Date(finishedAt).toISOString() });
    } finally {
      await nest.close();
    }
  });
});

describe('reconcile fan-out', () => {
  it('pages past the first full page: the next call starts after its last id and page-2 stores are queued', async () => {
    const first = Array.from({ length: RECONCILE_FANOUT_PAGE }, () => randomUUID() as string).sort();
    const second = [randomUUID() as string];
    const calls: Array<{ after: string | null; limit: number }> = [];
    const source: ActiveStoreSource = {
      activeStoreIds: async (after, limit) => {
        calls.push({ after, limit });
        return calls.length === 1 ? first : calls.length === 2 ? second : [];
      },
    };
    const sent: string[] = [];
    const queued = await fanOutReconcile(source, { send: async (_q, data) => (sent.push((data as ReconcileJob).store_id!), 'job') });
    expect(calls).toEqual([{ after: null, limit: RECONCILE_FANOUT_PAGE }, { after: first.at(-1), limit: RECONCILE_FANOUT_PAGE }]);
    expect(queued).toBe(RECONCILE_FANOUT_PAGE + 1);
    expect(sent).toContain(second[0]);
  });


  it('lists active store ids in pages through active_store_ids(), skipping disconnected and uninstalled stores', async () => {
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    await insertStore(ids[0]!);
    await insertStore(ids[1]!);
    await insertStore(ids[2]!, 'disconnected');
    await insertStore(ids[3]!, 'uninstalled');
    const all: string[] = [];
    for (let after: string | null = null; ; ) {
      const page = await integration.activeStoreIds(after, 2);
      all.push(...page);
      if (page.length < 2) break;
      after = page[1]!;
    }
    expect(all).toEqual([...all].sort());
    expect(all).toEqual(expect.arrayContaining([ids[0], ids[1]]));
    expect(all).not.toContain(ids[2]);
    expect(all).not.toContain(ids[3]);
    // The app role can not read stores across tenants directly.
    expect((await app.query('select id from stores').catch(() => ({ rowCount: 0 }))).rowCount).toBe(0);
  });

  it('queues one catalog.reconcile per active store with distinct trace ids, the day-keyed singleton and the store offset; again the same day queues none', async () => {
    const active = [randomUUID(), randomUUID()];
    const disconnected = randomUUID();
    for (const id of active) await insertStore(id);
    await insertStore(disconnected, 'disconnected');
    // Only this test's stores, so other tests' stores do not matter.
    const ours = new Set<string>([...active, disconnected]);
    const allActive = async () => {
      const all: string[] = [];
      for (let after: string | null = null; ; ) {
        const page = await integration.activeStoreIds(after, 500);
        all.push(...page);
        if (page.length < 500) return all;
        after = page.at(-1)!;
      }
    };
    const source: ActiveStoreSource = { activeStoreIds: async (after) => (after ? [] : (await allActive()).filter((id) => ours.has(id))) };
    const sent: Array<{ data: ReconcileJob; options: Record<string, unknown> }> = [];
    const sender = { send: async (queue: string, data: object, options?: Record<string, unknown>) => (sent.push({ data: data as ReconcileJob, options: options! }), boss.send(queue, data, options)) };
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    expect(await fanOutReconcile(source, sender, now)).toBe(2);
    expect(sent.map((s) => s.data.store_id).sort()).toEqual([...active].sort());
    expect(new Set(sent.map((s) => s.data.trace_id)).size).toBe(2);
    for (const s of sent) {
      expect(ReconcileJob.safeParse(s.data).success).toBe(true);
      expect(s.options).toMatchObject({ singletonKey: `${s.data.store_id}:${day}`, singletonSeconds: RECONCILE_SINGLETON_SECONDS, expireInSeconds: RECONCILE_EXPIRE_SECONDS });
      expect((s.options.startAfter as Date).getTime()).toBe(Date.parse(`${day}T00:00:00Z`) + reconcileOffsetSeconds(s.data.store_id) * 1000);
    }
    const queued = await admin.query(`select data->>'store_id' as store_id from ${SCHEMA}.job where name = $1 and data->>'store_id' = any($2::text[])`, [CATALOG_RECONCILE_QUEUE, [...ours]]);
    expect(queued.rows.map((r: { store_id: string }) => r.store_id).sort()).toEqual([...active].sort());
    // Same UTC day: nothing new.
    expect(await fanOutReconcile(source, sender, now)).toBe(0);
    expect((await admin.query(`select 1 from ${SCHEMA}.job where name = $1 and data->>'store_id' = any($2::text[])`, [CATALOG_RECONCILE_QUEUE, [...ours]])).rowCount).toBe(2);
  });

  it('the schedule handler fans out and logs how many it queued', async () => {
    const sent: unknown[] = [];
    const handlers = catalogJobHandlers({} as CatalogSync, {} as CatalogReconcile, { activeStoreIds: async (after) => (after ? [] : [randomUUID() as string]) }, { send: async (_q, data) => (sent.push(data), 'job') }, telemetry);
    await handlers[CATALOG_RECONCILE_SCHEDULE_QUEUE]!({ v: 1, trace_id: 'schedule' }, { id: 's', data: {} });
    expect(sent).toHaveLength(1);
    expect(lines.some((l) => l.includes('"msg":"catalog reconcile scheduled"') && l.includes('"queued":1'))).toBe(true);
  });

  it('gives each store a fixed offset within the first hour', () => {
    const id = randomUUID();
    expect(reconcileOffsetSeconds(id)).toBe(reconcileOffsetSeconds(id));
    for (let i = 0; i < 200; i++) {
      const s = reconcileOffsetSeconds(randomUUID());
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(3600);
    }
  });
});

describe('queue', () => {
  it('runs the reconcile and its schedule on the batch queue with the AD-1 retry policy (5 attempts, 30 s to 15 min)', () => {
    expect(QUEUES).toContainEqual({ name: CATALOG_RECONCILE_QUEUE, group: 'batch' });
    expect(QUEUES).toContainEqual({ name: CATALOG_RECONCILE_SCHEDULE_QUEUE, group: 'batch' });
    expect(queueOptions('batch')).toEqual({ retryLimit: 4, retryDelay: 30, retryBackoff: true, retryDelayMax: 900 });
  });
});
