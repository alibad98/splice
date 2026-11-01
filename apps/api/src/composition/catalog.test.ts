// Story 2.1/2.2 composition tests: live Postgres (non-owner RLS role, real pg-boss outbox), a fake CommercePlatform and
// a fake token source standing in for integration.getAccessToken; the Products read API over HTTP.
import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CatalogSyncStatus, CategoryListResponse, EVENT_QUEUE, ProductListResponse, type EventEnvelope } from '@slips/contracts';
import { ensureTestAppRole, runMigrations, withStoreContext } from '@slips/db';
import { PinoTelemetry } from '../adapters/telemetry/pino-telemetry.js';
import { EventHandlerRegistry, eventDispatcher } from '../events/dispatcher.js';
import { uuidv7 } from '../events/outbox.js';
import { grantEventPublishing } from '../events/queue-grants.js';
import { availabilityBucket } from '../modules/catalog/availability.js';
import { catalogStoreData } from '../modules/catalog/catalog.lifecycle.js';
import { CatalogService } from '../modules/catalog/catalog.service.js';
import { CATALOG_FULL_SYNC_QUEUE, CatalogSync, FullSyncJob, RUN_HEARTBEAT_MS, RunBusyError, STALE_RUN_MS } from '../modules/catalog/catalog-sync.js';
import { StoreDisconnectedError, StoreNotConnectedError } from '../modules/integration/errors.js';
import { PlatformAuthRejectedError, PlatformUnavailableError, type CanonicalProduct, type CommercePlatform, type ProductPage } from '../ports/commerce-platform.js';
import { catalogJobHandlers, FULL_SYNC_SINGLETON_SECONDS, registerCatalogEventHandlers } from '../worker/catalog-jobs.js';
import { QUEUES, queueOptions } from '../worker/queues.js';
import { createHttpApp } from '../http.js';
import type { SessionConfig } from '../infra.module.js';
import { ContentService } from '../modules/content/content.service.js';
import { SessionService } from '../modules/session/session.service.js';

const ADMIN_URL = 'postgres://slips:slips@127.0.0.1:5433/slips';
const APP_URL = 'postgres://slips_it_catalog_sync:it_catalog_sync_pw@127.0.0.1:5433/slips';
const SCHEMA = 'pgboss_catalog_test';
const lines: string[] = [];
const telemetry = new PinoTelemetry({ role: 'worker', level: 'debug', stream: { write: (l: string) => void lines.push(l) } });

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 4 });
/** Run ids are event ids: time-ordered UUIDv7, strictly increasing here. */
let runClock = Date.now();
const nextRun = (): string => uuidv7(++runClock);
/** Any attempt but the job's last. */
const NOT_LAST = { finalAttempt: false };
let app: pg.Pool;
let boss: PgBoss;

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
  sourceUpdatedAt: new Date('2026-10-30T09:00:00Z'),
  ...over,
});

/** Pages of products; `fail` lets a test make a given page throw once. */
class FakePlatform {
  readonly platform = 'salla' as const;
  calls: number[] = [];
  tokensSeen: string[] = [];
  fail = new Map<number, Error>();
  /** Runs before a page is returned (to change state mid-sync). */
  onPage?: (page: number) => Promise<void>;
  constructor(public pages: CanonicalProduct[][]) {}
  readonly products = {
    list: async (session: { storeId: string; accessToken: string }, page: number): Promise<ProductPage> => {
      this.calls.push(page);
      this.tokensSeen.push(session.accessToken);
      await this.onPage?.(page);
      const err = this.fail.get(page);
      if (err) {
        this.fail.delete(page);
        throw err;
      }
      return { items: this.pages[page - 1] ?? [], hasMore: page < this.pages.length };
    },
  };
  // Catalog must never refresh tokens itself (AD-4): any auth call fails the test.
  readonly auth = new Proxy({}, { get: () => () => { throw new Error('catalog called platform.auth'); } });
}

class FakeTokens {
  calls = 0;
  failOn = new Map<number, Error>();
  async getAccessToken(): Promise<string> {
    this.calls++;
    const err = this.failOn.get(this.calls);
    if (err) throw err;
    return `AT-${this.calls}`;
  }
}

const syncFor = (platform: FakePlatform, tokens = new FakeTokens(), now = () => Date.now()) =>
  ({ sync: new CatalogSync(app, platform as unknown as CommercePlatform, tokens, telemetry, boss, now), tokens });

const productsOf = async (storeId: string) =>
  (await admin.query('select * from products where store_id = $1 order by external_id', [storeId])).rows as Array<Record<string, unknown>>;
const stateOf = async (storeId: string) => (await admin.query('select * from catalog_sync_state where store_id = $1', [storeId])).rows[0] as Record<string, unknown> | undefined;
const completedEvents = async (storeId: string) =>
  (await admin.query<{ data: EventEnvelope }>(`select data from ${SCHEMA}.job where name = $1 and data->>'store_id' = $2 and data->>'name' = 'catalog.sync.completed'`, [EVENT_QUEUE, storeId])).rows.map((r) => r.data);

beforeAll(async () => {
  await runMigrations(admin);
  await ensureTestAppRole(admin, 'slips_it_catalog_sync', 'it_catalog_sync_pw');
  app = new pg.Pool({ connectionString: APP_URL, max: 6 });
  await admin.query(`drop schema if exists ${SCHEMA} cascade`);
  boss = new PgBoss({ connectionString: ADMIN_URL, schema: SCHEMA });
  await boss.start();
  await boss.createQueue(EVENT_QUEUE);
  await boss.createQueue(CATALOG_FULL_SYNC_QUEUE);
  await grantEventPublishing(admin, telemetry, EVENT_QUEUE, SCHEMA, 'slips_app');
});
afterAll(async () => {
  await boss?.stop({ graceful: false });
  await admin.query(`drop schema if exists ${SCHEMA} cascade`);
  await app?.end();
  await admin.end();
});

describe('availability bucket', () => {
  it('is out of stock at 0, low at 1-5, available above 5 or when stock is unlimited/unreported', () => {
    expect([0, 1, 3, 5, 6, 100, null].map(availabilityBucket)).toEqual(['out_of_stock', 'low', 'low', 'low', 'available', 'available', 'available']);
    expect(availabilityBucket(-1)).toBe('out_of_stock');
  });
});

describe('install event -> full-sync job', () => {
  it('queues one catalog.full-sync per installed or reinstalled event, keyed by store, with the event id as run id; a redelivery queues nothing', async () => {
    const sent: Array<{ queue: string; data: Record<string, unknown>; options?: Record<string, unknown> }> = [];
    const sender = { send: async (queue: string, data: object, options?: Record<string, unknown>) => (sent.push({ queue, data: data as Record<string, unknown>, options }), 'job-id') };
    const registry = new EventHandlerRegistry();
    registerCatalogEventHandlers(registry, sender, telemetry);
    const dispatch = eventDispatcher(app, registry);
    const storeId = randomUUID();
    const envelope = (name: string): EventEnvelope => ({ v: 1, trace_id: 't', store_id: storeId, event_id: uuidv7(), name, occurred_at: new Date().toISOString(), payload: { v: 1, store_id: storeId, install_epoch: 1 } });
    const installed = envelope('integration.store.installed');
    await dispatch(installed, { id: 'j1', data: installed });
    await dispatch(installed, { id: 'j1', data: installed }); // redelivery
    const reinstalled = envelope('integration.store.reinstalled');
    await dispatch(reinstalled, { id: 'j2', data: reinstalled });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ queue: CATALOG_FULL_SYNC_QUEUE, data: { store_id: storeId, run_id: installed.event_id }, options: { singletonKey: storeId, singletonSeconds: FULL_SYNC_SINGLETON_SECONDS } });
    expect(sent[1]!.data.run_id).toBe(reinstalled.event_id);
    expect(FullSyncJob.safeParse(sent[0]!.data).success).toBe(true);
  });
});

describe('full sync', () => {
  it('imports every page with prices in minor units, buckets, flags and source time; records the sync and emits sync.completed in the same transaction', async () => {
    const storeId = randomUUID();
    const runId = nextRun();
    const platform = new FakePlatform([
      [product('p1', { stock: 0 }), product('p2', { stock: 3, salePrice: '9.99', hasRequiredOptions: true })],
      [product('p3', { stock: null, price: '1.250', currency: 'KWD', categories: [{ externalId: 'c2', name: 'Gifts' }] }), product('p4', { stock: 6, visible: false, sourceUpdatedAt: undefined })],
    ]);
    const { sync, tokens } = syncFor(platform);
    const handlers = catalogJobHandlers(sync);
    await handlers[CATALOG_FULL_SYNC_QUEUE]!({ v: 1, trace_id: 't', store_id: storeId, run_id: runId }, { id: 'j', data: {} });

    expect(platform.calls).toEqual([1, 2]);
    // Every call used a token from the token source, one per page; the platform's auth was never touched.
    expect(tokens.calls).toBe(2);
    expect(platform.tokensSeen).toEqual(['AT-1', 'AT-2']);

    const rows = await productsOf(storeId);
    expect(rows.map((r) => [r.external_id, r.availability, r.stock])).toEqual([
      ['p1', 'out_of_stock', 0],
      ['p2', 'low', 3],
      ['p3', 'available', null],
      ['p4', 'available', 6],
    ]);
    expect(rows[0]).toMatchObject({ platform: 'salla', name: 'Product p1', image_url: 'https://cdn.example.com/p1.jpg', price_minor: '1250', sale_price_minor: null, currency: 'SAR', tax_inclusive: true, has_required_options: false, visible: true, category_external_ids: ['c1'] });
    expect(rows[1]).toMatchObject({ sale_price_minor: '999', has_required_options: true });
    expect(rows[2]).toMatchObject({ price_minor: '1250', currency: 'KWD', category_external_ids: ['c2'] });
    expect(rows[3]).toMatchObject({ visible: false });
    expect((rows[0]!.source_updated_at as Date).toISOString()).toBe('2026-10-30T09:00:00.000Z');
    expect(rows[3]!.source_updated_at).toBeInstanceOf(Date); // falls back to fetch time
    const cats = (await admin.query('select external_id, name from categories where store_id = $1 order by external_id', [storeId])).rows;
    expect(cats).toEqual([{ external_id: 'c1', name: 'Abayas' }, { external_id: 'c2', name: 'Gifts' }]);

    const state = await stateOf(storeId);
    expect(state).toMatchObject({ status: 'succeeded', reason: null, created_count: 4, updated_count: 0, run_id: runId });
    expect(state!.last_synced_at).toBeInstanceOf(Date);
    const events = await completedEvents(storeId);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ v: 1, store_id: storeId, run_id: runId, created: 4, updated: 0 });

    // Unlimited or unreported stock counts as available, and the run logs how many products had it.
    expect(lines.some((l) => l.includes('catalog sync succeeded') && l.includes('"stock_unreported":1'))).toBe(true);
    expect(await new CatalogService(app, boss, telemetry).getSyncState(storeId)).toMatchObject({ status: 'succeeded', reason: null, created: 4, updated: 0 });
    expect((await new CatalogService(app, boss, telemetry).getSyncState(randomUUID())).status).toBe('never');
  });

  it('is idempotent: the same run again is skipped; a new run (reinstall) updates rows without duplicating them', async () => {
    const storeId = randomUUID();
    const runId = nextRun();
    const platform = new FakePlatform([[product('a'), product('b')]]);
    const { sync } = syncFor(platform);
    expect(await sync.run(storeId, runId, NOT_LAST)).toBe('succeeded');
    expect(await sync.run(storeId, runId, NOT_LAST)).toBe('already_succeeded');
    expect(platform.calls).toEqual([1]);

    platform.pages = [[product('a', { price: '15.00' }), product('b'), product('c')]];
    const rerun = nextRun();
    expect(await sync.run(storeId, rerun, NOT_LAST)).toBe('succeeded');
    const rows = await productsOf(storeId);
    expect(rows.map((r) => r.external_id)).toEqual(['a', 'b', 'c']);
    expect(rows[0]!.price_minor).toBe('1500');
    expect(await stateOf(storeId)).toMatchObject({ run_id: rerun, created_count: 1, updated_count: 2 });
    expect((await completedEvents(storeId)).map((e) => e.payload)).toEqual([
      expect.objectContaining({ created: 2, updated: 0 }),
      expect.objectContaining({ run_id: rerun, created: 1, updated: 2 }),
    ]);
  });

  it('deduplicates a product repeated on one page (last wins)', async () => {
    const storeId = randomUUID();
    const { sync } = syncFor(new FakePlatform([[product('d', { name: 'old' }), product('d', { name: 'new' })]]));
    expect(await sync.run(storeId, nextRun(), NOT_LAST)).toBe('succeeded');
    expect((await productsOf(storeId)).map((r) => r.name)).toEqual(['new']);
  });

  it('a transient platform error before the last attempt keeps the run running (not failed) for the retry; the retry resumes from the next page at once', async () => {
    const storeId = randomUUID();
    const runId = nextRun();
    const platform = new FakePlatform([[product('r1')], [product('r2')], [product('r3')]]);
    platform.fail.set(2, new PlatformUnavailableError('rate limited', 30));
    const { sync } = syncFor(platform);
    await expect(sync.run(storeId, runId, { finalAttempt: false })).rejects.toBeInstanceOf(PlatformUnavailableError);
    expect(await stateOf(storeId)).toMatchObject({ status: 'running', reason: 'platform_unavailable', next_page: 2, created_count: 1 });
    // The merchant sees a run in progress, never the attempt's error.
    expect(await new CatalogService(app, boss, telemetry).getSyncState(storeId)).toMatchObject({ status: 'running', reason: null, runId });
    expect(await completedEvents(storeId)).toHaveLength(0);

    // The retry comes well inside the heartbeat window and is not mistaken for a busy attempt.
    expect(await sync.run(storeId, runId, NOT_LAST)).toBe('succeeded');
    expect(platform.calls).toEqual([1, 2, 2, 3]);
    expect(await stateOf(storeId)).toMatchObject({ status: 'succeeded', reason: null, created_count: 3 });
    expect(await completedEvents(storeId)).toHaveLength(1);
  });

  it('an unexpected error is retried too; only the last attempt records failed (internal)', async () => {
    const storeId = randomUUID();
    const runId = nextRun();
    const platform = new FakePlatform([[product('x')]]);
    platform.fail.set(1, new Error('boom'));
    const { sync } = syncFor(platform);
    await expect(sync.run(storeId, runId, NOT_LAST)).rejects.toThrow('boom');
    expect(await stateOf(storeId)).toMatchObject({ status: 'running', reason: 'internal' });
    platform.fail.set(1, new Error('boom again'));
    await expect(sync.run(storeId, runId, { finalAttempt: true })).rejects.toThrow('boom again');
    expect(await stateOf(storeId)).toMatchObject({ status: 'failed', reason: 'internal' });
    expect(await new CatalogService(app, boss, telemetry).getSyncState(storeId)).toMatchObject({ status: 'failed', reason: 'internal' });
  });

  it('the last of 5 attempts failing with a 503 records failed + platform_unavailable and keeps the imported catalog', async () => {
    const storeId = randomUUID();
    const runId = nextRun();
    const platform = new FakePlatform([[product('l1')], [product('l2')]]);
    const handler = catalogJobHandlers(syncFor(platform).sync)[CATALOG_FULL_SYNC_QUEUE]!;
    const job = { v: 1, trace_id: 't', store_id: storeId, run_id: runId };
    for (let attempt = 0; attempt < 5; attempt++) {
      platform.fail.set(2, new PlatformUnavailableError('down'));
      await expect(handler(job, { id: 'j', data: job, retryCount: attempt, retryLimit: queueOptions('batch').retryLimit })).rejects.toBeInstanceOf(PlatformUnavailableError);
      expect((await stateOf(storeId))!.status, `attempt ${attempt + 1}`).toBe(attempt < 4 ? 'running' : 'failed');
    }
    expect(await stateOf(storeId)).toMatchObject({ status: 'failed', reason: 'platform_unavailable' });
    expect((await productsOf(storeId)).map((r) => r.external_id)).toEqual(['l1']);
  });

  it.each([
    ['auth_rejected', 'platform', () => new PlatformAuthRejectedError()],
    ['store_inactive', 'tokens', () => new StoreDisconnectedError()],
    ['store_inactive', 'tokens', () => new StoreNotConnectedError()],
  ] as const)('a final failure (%s) is recorded and not retried', async (reason, where, makeErr) => {
    const storeId = randomUUID();
    const platform = new FakePlatform([[product('f1')]]);
    const tokens = new FakeTokens();
    if (where === 'platform') platform.fail.set(1, makeErr());
    else tokens.failOn.set(1, makeErr());
    const { sync } = syncFor(platform, tokens);
    expect(await sync.run(storeId, nextRun(), NOT_LAST)).toEqual({ failed: reason });
    expect(await stateOf(storeId)).toMatchObject({ status: 'failed', reason });
    expect(await completedEvents(storeId)).toHaveLength(0);
  });

  it('a store uninstalled mid-sync stops at the next page as store_inactive and keeps what it imported', async () => {
    const storeId = randomUUID();
    const tokens = new FakeTokens();
    tokens.failOn.set(2, new StoreDisconnectedError());
    const platform = new FakePlatform([[product('u1')], [product('u2')]]);
    const { sync } = syncFor(platform, tokens);
    expect(await sync.run(storeId, nextRun(), NOT_LAST)).toEqual({ failed: 'store_inactive' });
    expect(platform.calls).toEqual([1]);
    expect((await productsOf(storeId)).map((r) => r.external_id)).toEqual(['u1']);
  });

  it('an unknown store currency (every product on the page) fails the run as unknown_currency without a retry and stores nothing', async () => {
    const storeId = randomUUID();
    const { sync } = syncFor(new FakePlatform([[product('m1', { currency: 'XYZ' }), product('m2', { currency: 'XYZ' })]]));
    expect(await sync.run(storeId, nextRun(), NOT_LAST)).toEqual({ failed: 'unknown_currency' });
    expect(await productsOf(storeId)).toEqual([]);
  });

  it('a few unreadable products (unknown currency, bad or negative amount) are skipped and counted; the rest import', async () => {
    const storeId = randomUUID();
    const runId = nextRun();
    const { sync } = syncFor(
      new FakePlatform([[product('k1'), product('k2', { currency: 'XYZ' }), product('k3', { price: '1,5' }), product('k4', { price: '-2.00' }), product('k5', { price: '10.00', salePrice: '9.999' })]]),
    );
    expect(await sync.run(storeId, runId, NOT_LAST)).toBe('succeeded');
    const rows = await productsOf(storeId);
    expect(rows.map((r) => r.external_id)).toEqual(['k1', 'k5']);
    expect(rows[1]!.sale_price_minor).toBeNull(); // 9.999 rounds to the regular price: no sale
    expect(lines.some((l) => l.includes('catalog sync skipped unreadable products') && l.includes('"skipped":3') && l.includes(runId))).toBe(true);
  });

  it('a run replaced by a newer run mid-sync stops: no more pages, no count changes, no completion event', async () => {
    const storeId = randomUUID();
    const runId = nextRun();
    const newer = nextRun();
    const platform = new FakePlatform([[product('v1')], [product('v2')], [product('v3')]]);
    platform.onPage = async (page) => {
      if (page === 2) await admin.query(`update catalog_sync_state set run_id = $2, status = 'running', created_count = 0 where store_id = $1`, [storeId, newer]);
    };
    const { sync } = syncFor(platform);
    expect(await sync.run(storeId, runId, NOT_LAST)).toBe('superseded');
    expect(platform.calls).toEqual([1, 2]);
    expect((await productsOf(storeId)).map((r) => r.external_id)).toEqual(['v1']);
    expect(await stateOf(storeId)).toMatchObject({ run_id: newer, status: 'running', created_count: 0 });
    expect(await completedEvents(storeId)).toHaveLength(0);
  });

  it('a retry of an older run never replaces a newer run, whatever its status', async () => {
    const storeId = randomUUID();
    const older = nextRun();
    const newer = nextRun();
    const platform = new FakePlatform([[product('o1')]]);
    platform.fail.set(1, new PlatformUnavailableError('down'));
    const { sync } = syncFor(platform);
    await expect(sync.run(storeId, older, NOT_LAST)).rejects.toBeInstanceOf(PlatformUnavailableError);
    expect(await sync.run(storeId, newer, NOT_LAST)).toBe('succeeded');
    expect(await sync.run(storeId, older, NOT_LAST)).toBe('superseded');
    expect(await stateOf(storeId)).toMatchObject({ run_id: newer, status: 'succeeded' });
    // A failed newer run is not taken over either; markFailed of the older run leaves it alone.
    await admin.query(`update catalog_sync_state set status = 'failed', reason = 'platform_unavailable' where store_id = $1`, [storeId]);
    expect(await sync.run(storeId, older, NOT_LAST)).toBe('superseded');
    expect(await stateOf(storeId)).toMatchObject({ run_id: newer, status: 'failed', reason: 'platform_unavailable' });
  });

  it('a second attempt of a run that is still writing pages backs off (retryable), then resumes once the run goes quiet', async () => {
    const storeId = randomUUID();
    const runId = nextRun();
    let clock = Date.now();
    await withStoreContext(app, storeId, (ctx) =>
      ctx.query(`insert into catalog_sync_state (store_id, run_id, status, next_page, created_count, updated_at) values ($1, $2, 'running', 2, 1, $3)`, [storeId, runId, new Date(clock)]),
    );
    const platform = new FakePlatform([[product('h1')], [product('h2')]]);
    const { sync } = syncFor(platform, new FakeTokens(), () => clock);
    await expect(sync.run(storeId, runId, NOT_LAST)).rejects.toBeInstanceOf(RunBusyError);
    expect(await stateOf(storeId)).toMatchObject({ status: 'running', next_page: 2 }); // not marked failed
    clock += RUN_HEARTBEAT_MS + 1;
    expect(await sync.run(storeId, runId, NOT_LAST)).toBe('succeeded');
    expect(platform.calls).toEqual([2]);
    expect(await stateOf(storeId)).toMatchObject({ status: 'succeeded', created_count: 2 });
  });

  it('on the last attempt, a failure before the import starts (busy run) still records failed', async () => {
    const storeId = randomUUID();
    const runId = nextRun();
    await withStoreContext(app, storeId, (ctx) => ctx.query(`insert into catalog_sync_state (store_id, run_id, status, next_page) values ($1, $2, 'running', 2)`, [storeId, runId]));
    const { sync } = syncFor(new FakePlatform([[product('b1')]]));
    await expect(sync.run(storeId, runId, NOT_LAST)).rejects.toBeInstanceOf(RunBusyError);
    expect(await stateOf(storeId)).toMatchObject({ status: 'running' });
    await expect(sync.run(storeId, runId, { finalAttempt: true })).rejects.toBeInstanceOf(RunBusyError);
    expect(await stateOf(storeId)).toMatchObject({ status: 'failed', reason: 'internal' });
  });

  it('a second run while another is fresh and running is superseded; a stale running run is replaced', async () => {
    const storeId = randomUUID();
    let clock = Date.now();
    await withStoreContext(app, storeId, (ctx) => ctx.query(`insert into catalog_sync_state (store_id, run_id, status, updated_at) values ($1, $2, 'running', $3)`, [storeId, nextRun(), new Date(clock)]));
    const platform = new FakePlatform([[product('s1')]]);
    const { sync } = syncFor(platform, new FakeTokens(), () => clock);
    expect(await sync.run(storeId, nextRun(), NOT_LAST)).toBe('superseded');
    expect(platform.calls).toEqual([]);
    clock += STALE_RUN_MS + 1;
    expect(await sync.run(storeId, nextRun(), NOT_LAST)).toBe('succeeded');
  });

  it('does not limit product count by plan and reads no billing data (AD-14)', async () => {
    const storeId = randomUUID();
    const many = Array.from({ length: 120 }, (_, i) => product(`n${String(i).padStart(3, '0')}`));
    const { sync } = syncFor(new FakePlatform([many.slice(0, 60), many.slice(60)]));
    expect(await sync.run(storeId, nextRun(), NOT_LAST)).toBe('succeeded');
    expect(await productsOf(storeId)).toHaveLength(120);
    const dir = fileURLToPath(new URL('../modules/catalog/', import.meta.url));
    for (const file of readdirSync(dir)) expect(readFileSync(`${dir}${file}`, 'utf8')).not.toMatch(/billing|entitlement|subscriptions/i);
  });
});

describe('catalog purge', () => {
  it('removes products in batches, then categories and sync state', async () => {
    const storeId = randomUUID();
    const { sync } = syncFor(new FakePlatform([[product('g1'), product('g2'), product('g3')]]));
    await sync.run(storeId, nextRun(), NOT_LAST);
    const purge = () => withStoreContext(app, storeId, (tx) => catalogStoreData.purge({ storeId, installEpoch: 1, tx, batchLimit: 2 }));
    expect(await purge()).toEqual({ done: false });
    expect(await productsOf(storeId)).toHaveLength(1);
    expect(await purge()).toEqual({ done: true });
    expect(await productsOf(storeId)).toHaveLength(0);
    expect((await admin.query('select 1 from categories where store_id = $1', [storeId])).rowCount).toBe(0);
    expect(await stateOf(storeId)).toBeUndefined();
  });
});

describe('queue', () => {
  it('runs catalog.full-sync on the batch queue with the AD-1 retry policy (5 attempts, 30 s to 15 min)', () => {
    expect(QUEUES).toContainEqual({ name: CATALOG_FULL_SYNC_QUEUE, group: 'batch' });
    expect(queueOptions('batch')).toEqual({ retryLimit: 4, retryDelay: 30, retryBackoff: true, retryDelayMax: 900 });
  });
});

// Story 2.2: the Products page read API over HTTP (session -> store, RLS, query validation, batch link counts).
describe('products read API', () => {
  let nest: INestApplication;
  let base: string;
  const sessionConfig: SessionConfig = { secret: randomBytes(32), secureCookies: true, embeddedTtlMs: 15 * 60_000, directMaxAgeMs: 3_600_000, idleMs: 3_600_000 };

  beforeAll(async () => {
    // A pool of its own: closing the app ends it.
    const httpPool = new pg.Pool({ connectionString: APP_URL, max: 4 });
    nest = await createHttpApp({ CORS_ORIGINS: 'http://localhost:3000', LOG_LEVEL: 'silent' }, { pool: httpPool, events: boss, telemetry, session: sessionConfig });
    await nest.listen(0);
    base = await nest.getUrl();
  });
  afterAll(async () => {
    await nest?.close();
  });

  /** An installed store row (sessions reference it) and an embedded session bearer for it. */
  const bearerFor = async (storeId: string) => {
    await admin.query(`insert into stores (id, store_id, platform, platform_store_id, name) values ($1, $1, 'salla', $2, 'Catalog Store') on conflict do nothing`, [storeId, `cat-${storeId}`]);
    return (await nest.get(SessionService).create(storeId, 'embedded')).token;
  };
  const get = async (token: string, path: string) => {
    const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
    return { res, body: (await res.json()) as unknown };
  };
  const list = async (token: string, qs = '') => ProductListResponse.parse((await get(token, `/v1/products${qs}`)).body);
  async function seededStore(items: CanonicalProduct[]): Promise<{ storeId: string; token: string }> {
    const storeId = randomUUID();
    const pages: CanonicalProduct[][] = [];
    for (let i = 0; i < items.length; i += 60) pages.push(items.slice(i, i + 60));
    const { sync } = syncFor(new FakePlatform(pages));
    expect(await sync.run(storeId, nextRun(), NOT_LAST)).toBe('succeeded');
    return { storeId, token: await bearerFor(storeId) };
  }

  it('lists the first 50 of 120 products sorted by name with the total; later pages and descending order follow', async () => {
    const many = Array.from({ length: 120 }, (_, i) => product(`n${String(i).padStart(3, '0')}`, { name: `Item ${String(119 - i).padStart(3, '0')}` }));
    const { token } = await seededStore(many);
    const { res, body } = await get(token, '/v1/products');
    expect(res.status).toBe(200);
    const page = ProductListResponse.parse(body);
    expect(page).toMatchObject({ total: 120, page: 1, page_size: 50 });
    expect(page.items).toHaveLength(50);
    expect(page.items[0]!.name).toBe('Item 000');
    expect(page.items[49]!.name).toBe('Item 049');
    const last = await list(token, '?page=3');
    expect(last.items).toHaveLength(20);
    expect(last.items.at(-1)!.name).toBe('Item 119');
    expect((await list(token, '?sort=-name')).items[0]!.name).toBe('Item 119');
    expect(await list(token, '?page=9')).toMatchObject({ items: [], total: 120 });
  });

  it('returns money in minor units with the sale price, the stored bucket, the first category (+N), 0 links and null orders; hidden products are excluded', async () => {
    const { token } = await seededStore([
      product('s1', { name: 'Sale', price: '150.00', salePrice: '120.00', stock: 3, categories: [{ externalId: 'c1', name: 'Abayas' }, { externalId: 'c2', name: 'Gifts' }, { externalId: 'c3', name: 'New' }] }),
      product('s2', { name: 'Gone', stock: 0, categories: [] }),
      product('s3', { name: 'Hidden', visible: false }),
    ]);
    const page = await list(token);
    expect(page.total).toBe(2);
    expect(page.items.map((i) => i.name)).toEqual(['Gone', 'Sale']);
    expect(page.items[1]).toMatchObject({ price_minor: 15000, sale_price_minor: 12000, currency: 'SAR', tax_inclusive: true, availability: 'low', category_name: 'Abayas', more_categories: 2, linked_content_count: 0, attributed_orders: null });
    expect(page.items[0]).toMatchObject({ availability: 'out_of_stock', category_name: null, more_categories: 0 });
  });

  it('sorts by effective price (sale price when set) both ways', async () => {
    const { token } = await seededStore([
      product('e1', { name: 'A', price: '100.00' }),
      product('e2', { name: 'B', price: '200.00', salePrice: '50.00' }),
      product('e3', { name: 'C', price: '75.00' }),
    ]);
    expect((await list(token, '?sort=price')).items.map((i) => i.name)).toEqual(['B', 'C', 'A']);
    expect((await list(token, '?sort=-price')).items.map((i) => i.name)).toEqual(['A', 'C', 'B']);
  });

  it('searches names case-insensitively in Arabic and English and treats % and _ literally', async () => {
    const { token } = await seededStore([
      product('a1', { name: 'عباية سوداء' }),
      product('a2', { name: 'Black ABAYA' }),
      product('a3', { name: '50% off scarf' }),
      product('a4', { name: 'plain_tee' }),
      product('a5', { name: 'plainXtee' }),
    ]);
    const names = async (q: string) => (await list(token, `?q=${encodeURIComponent(q)}`)).items.map((i) => i.name);
    expect(await names('عباية')).toEqual(['عباية سوداء']);
    expect(await names('abaya')).toEqual(['Black ABAYA']);
    expect(await names('%')).toEqual(['50% off scarf']);
    expect(await names('n_t')).toEqual(['plain_tee']);
    expect(await names('')).toHaveLength(5);
  });

  it('filters by category external id; an unknown id is an empty result; lists categories by name', async () => {
    const { token } = await seededStore([
      product('f1', { categories: [{ externalId: 'c1', name: 'Abayas' }] }),
      product('f2', { categories: [{ externalId: 'c2', name: 'Bags' }, { externalId: 'c1', name: 'Abayas' }] }),
      product('f3', { categories: [{ externalId: 'c2', name: 'Bags' }] }),
    ]);
    expect((await list(token, '?category=c1')).items.map((i) => i.external_id).sort()).toEqual(['f1', 'f2']);
    expect(await list(token, '?category=nope')).toMatchObject({ items: [], total: 0 });
    const cats = CategoryListResponse.parse((await get(token, '/v1/products/categories')).body);
    expect(cats.items).toEqual([{ external_id: 'c1', name: 'Abayas' }, { external_id: 'c2', name: 'Bags' }]);
  });

  it('never shows another store’s rows to a session of store B', async () => {
    await seededStore([product('x1', { name: 'Store A product', categories: [{ externalId: 'ca', name: 'Only A' }] })]);
    const b = await seededStore([product('y1', { name: 'Store B product' })]);
    expect((await list(b.token, '?q=product')).items.map((i) => i.name)).toEqual(['Store B product']);
    const cats = CategoryListResponse.parse((await get(b.token, '/v1/products/categories')).body);
    expect(cats.items.map((c) => c.name)).toEqual(['Abayas']);
  });

  it.each(['page=0', 'page=abc', 'sort=x', `q=${'a'.repeat(101)}`, 'q=a&q=b'])('answers 400 problem+json for %s', async (qs) => {
    const { token } = await seededStore([product('b1')]);
    const { res, body } = await get(token, `/v1/products?${qs}`);
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    expect(body).toMatchObject({ status: 400, code: 'invalid_query' });
  });

  it('needs a merchant session', async () => {
    for (const path of ['/v1/products', '/v1/products/categories', '/v1/catalog/sync']) expect((await fetch(`${base}${path}`)).status).toBe(401);
  });

  it('reads link counts in one batch call per page', async () => {
    const { token, storeId } = await seededStore([product('l1'), product('l2'), product('l3')]);
    const spy = vi.spyOn(nest.get(ContentService), 'getLinkCountsByProductIds');
    const page = await list(token);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(storeId, page.items.map((i) => i.id));
  });

  it('reports the sync state: never before the first run, succeeded with its time after it', async () => {
    const fresh = await bearerFor(randomUUID());
    expect(CatalogSyncStatus.parse((await get(fresh, '/v1/catalog/sync')).body)).toMatchObject({ status: 'never', last_synced_at: null });
    const { token } = await seededStore([product('z1')]);
    const synced = CatalogSyncStatus.parse((await get(token, '/v1/catalog/sync')).body);
    expect(synced.status).toBe('succeeded');
    expect(synced.last_synced_at).not.toBeNull();
  });
});

// Story 2.3: manual sync over HTTP (single-flight, rate limit, CSRF), the requested event -> full-sync job, outcomes.
describe('manual sync', () => {
  let nest: INestApplication;
  let base: string;
  const sessionConfig: SessionConfig = { secret: randomBytes(32), secureCookies: true, embeddedTtlMs: 15 * 60_000, directMaxAgeMs: 3_600_000, idleMs: 3_600_000 };

  beforeAll(async () => {
    const httpPool = new pg.Pool({ connectionString: APP_URL, max: 4 });
    nest = await createHttpApp({ CORS_ORIGINS: 'http://localhost:3000', LOG_LEVEL: 'silent' }, { pool: httpPool, events: boss, telemetry, session: sessionConfig });
    await nest.listen(0);
    base = await nest.getUrl();
  });
  afterAll(async () => {
    await nest?.close();
  });

  const installedStore = async (): Promise<{ storeId: string; token: string }> => {
    const storeId = randomUUID();
    await admin.query(`insert into stores (id, store_id, platform, platform_store_id, name) values ($1, $1, 'salla', $2, 'Sync Store') on conflict do nothing`, [storeId, `sync-${storeId}`]);
    return { storeId, token: (await nest.get(SessionService).create(storeId, 'embedded')).token };
  };
  const requestSync = async (token: string) => {
    const res = await fetch(`${base}/v1/catalog/sync`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    return { res, body: (await res.json()) as Record<string, unknown> };
  };
  const statusOf = async (token: string) => CatalogSyncStatus.parse(await (await fetch(`${base}/v1/catalog/sync`, { headers: { authorization: `Bearer ${token}` } })).json());
  const requestedEvents = async (storeId: string) =>
    (
      await admin.query<{ id: string; data: EventEnvelope }>(
        `select id::text, data from ${SCHEMA}.job where name = $1 and data->>'store_id' = $2 and data->>'name' = 'catalog.sync.requested' order by created_on`,
        [EVENT_QUEUE, storeId],
      )
    ).rows;
  /** Move the stored request time (and the row's last touch) into the past. */
  const age = (storeId: string, ms: { requested?: number; touched?: number }) =>
    admin.query(
      `update catalog_sync_state set requested_at = coalesce(requested_at, now()) - make_interval(secs => $2::float8 / 1000), updated_at = updated_at - make_interval(secs => $3::float8 / 1000) where store_id = $1`,
      [storeId, ms.requested ?? 0, ms.touched ?? 0],
    );

  /** The worker side: dispatch the outbox events, capture the full-sync jobs they send, then run those jobs. */
  async function work(storeId: string, platform: FakePlatform, attempt = { retryCount: 0, retryLimit: 4 }) {
    const sent: Array<{ data: FullSyncJob; options?: Record<string, unknown> }> = [];
    const registry = new EventHandlerRegistry();
    registerCatalogEventHandlers(registry, { send: async (_q: string, data: object, options?: Record<string, unknown>) => (sent.push({ data: data as FullSyncJob, options }), 'job') }, telemetry);
    const dispatch = eventDispatcher(app, registry);
    for (const { data } of await requestedEvents(storeId)) await dispatch(data, { id: data.event_id, data });
    const handler = catalogJobHandlers(syncFor(platform).sync)[CATALOG_FULL_SYNC_QUEUE]!;
    for (const job of sent) await handler(job.data, { id: 'j', data: job.data, ...attempt });
    return sent;
  }

  it('first manual sync (never): 202 queued + event in the same transaction; the worker imports; then succeeded with last_synced_at and products listed', async () => {
    const { storeId, token } = await installedStore();
    expect((await statusOf(token)).status).toBe('never');
    const { res, body } = await requestSync(token);
    expect(res.status).toBe(202);
    const queued = CatalogSyncStatus.parse(body);
    expect(queued).toMatchObject({ status: 'queued', reason: null, last_synced_at: null });
    expect(queued.run_id).toBeTruthy();
    expect(await stateOf(storeId)).toMatchObject({ status: 'queued', run_id: queued.run_id, requested_at: expect.any(Date) });
    // The event id is the run id; the HTTP role enqueued no full-sync job itself.
    const events = await requestedEvents(storeId);
    expect(events).toHaveLength(1);
    expect(events[0]!.id).toBe(queued.run_id);
    expect(events[0]!.data.payload).toEqual({ v: 1, store_id: storeId, run_id: queued.run_id });
    expect((await admin.query(`select 1 from ${SCHEMA}.job where name = $1 and data->>'store_id' = $2`, [CATALOG_FULL_SYNC_QUEUE, storeId])).rowCount).toBe(0);

    const sent = await work(storeId, new FakePlatform([[product('m1'), product('m2')]]));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ data: { store_id: storeId, run_id: queued.run_id }, options: { singletonKey: storeId, singletonSeconds: FULL_SYNC_SINGLETON_SECONDS, singletonNextSlot: true } });
    const done = await statusOf(token);
    expect(done).toMatchObject({ status: 'succeeded', run_id: queued.run_id, reason: null });
    expect(done.last_synced_at).not.toBeNull();
    const page = ProductListResponse.parse(await (await fetch(`${base}/v1/products`, { headers: { authorization: `Bearer ${token}` } })).json());
    expect(page.items.map((i) => i.external_id)).toEqual(['m1', 'm2']);
  });

  it('while queued or running (fresh): 202 with that run and nothing new is enqueued', async () => {
    const { storeId, token } = await installedStore();
    const first = CatalogSyncStatus.parse((await requestSync(token)).body);
    const again = await requestSync(token);
    expect(again.res.status).toBe(202);
    expect(CatalogSyncStatus.parse(again.body)).toMatchObject({ status: 'queued', run_id: first.run_id });
    await admin.query(`update catalog_sync_state set status = 'running' where store_id = $1`, [storeId]);
    await age(storeId, { requested: 120_000 }); // past the rate limit: single-flight still wins
    expect(CatalogSyncStatus.parse((await requestSync(token)).body)).toMatchObject({ status: 'running', run_id: first.run_id });
    expect(await requestedEvents(storeId)).toHaveLength(1);
  });

  it('a stale running run (untouched > 15 min) is treated as idle: a new run is queued', async () => {
    const { storeId, token } = await installedStore();
    const first = CatalogSyncStatus.parse((await requestSync(token)).body);
    await admin.query(`update catalog_sync_state set status = 'running' where store_id = $1`, [storeId]);
    await age(storeId, { requested: STALE_RUN_MS + 60_000, touched: STALE_RUN_MS + 60_000 });
    const { res, body } = await requestSync(token);
    expect(res.status).toBe(202);
    const second = CatalogSyncStatus.parse(body);
    expect(second.status).toBe('queued');
    expect(second.run_id).not.toBe(first.run_id);
    expect(await requestedEvents(storeId)).toHaveLength(2);
  });

  it('too soon (< 60 s after the previous request, idle): 429 sync-rate-limited problem+json with Retry-After; nothing enqueued', async () => {
    const { storeId, token } = await installedStore();
    await requestSync(token);
    await work(storeId, new FakePlatform([[product('t1')]]));
    expect((await statusOf(token)).status).toBe('succeeded');
    const { res, body } = await requestSync(token);
    expect(res.status).toBe(429);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    expect(body).toMatchObject({ type: 'sync-rate-limited', status: 429, code: 'sync_rate_limited' });
    const retryAfter = Number(res.headers.get('retry-after'));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(await requestedEvents(storeId)).toHaveLength(1);
  });

  it('after a success more than 60 s ago: 202 queued with a new run id, keeping the last sync time', async () => {
    const { storeId, token } = await installedStore();
    const first = CatalogSyncStatus.parse((await requestSync(token)).body);
    await work(storeId, new FakePlatform([[product('a1')]]));
    const synced = (await statusOf(token)).last_synced_at;
    await age(storeId, { requested: 61_000 });
    const { res, body } = await requestSync(token);
    expect(res.status).toBe(202);
    const next = CatalogSyncStatus.parse(body);
    expect(next).toMatchObject({ status: 'queued', last_synced_at: synced });
    expect(next.run_id).not.toBe(first.run_id);
  });

  it('a final failure (auth_rejected) is failed at once without a retry; the previous catalog and sync time stay', async () => {
    const { storeId, token } = await installedStore();
    await requestSync(token);
    await work(storeId, new FakePlatform([[product('k1')]]));
    const synced = (await statusOf(token)).last_synced_at;
    await age(storeId, { requested: 61_000 });
    await requestSync(token);
    const platform = new FakePlatform([[product('k2')]]);
    platform.fail.set(1, new PlatformAuthRejectedError());
    await work(storeId, platform); // resolves: no retry
    expect(await statusOf(token)).toMatchObject({ status: 'failed', reason: 'auth_rejected', last_synced_at: synced });
    expect((await productsOf(storeId)).map((r) => r.external_id)).toEqual(['k1']);
  });

  it('a transient failure before the last attempt reads running; a request meanwhile joins it; the last attempt reports failed', async () => {
    const { storeId, token } = await installedStore();
    await requestSync(token);
    const platform = new FakePlatform([[product('x1')]]);
    platform.fail.set(1, new PlatformUnavailableError('503'));
    await expect(work(storeId, platform, { retryCount: 1, retryLimit: 4 })).rejects.toBeInstanceOf(PlatformUnavailableError);
    expect(await statusOf(token)).toMatchObject({ status: 'running', reason: null });
    await age(storeId, { requested: 61_000 });
    expect((await requestSync(token)).body).toMatchObject({ status: 'running' });
    expect(await requestedEvents(storeId)).toHaveLength(1);
    const job: FullSyncJob = { v: 1, trace_id: 't', store_id: storeId, run_id: (await statusOf(token)).run_id! };
    platform.fail.set(1, new PlatformUnavailableError('503'));
    await expect(catalogJobHandlers(syncFor(platform).sync)[CATALOG_FULL_SYNC_QUEUE]!(job, { id: 'j', data: job, retryCount: 4, retryLimit: 4 })).rejects.toBeInstanceOf(PlatformUnavailableError);
    expect(await statusOf(token)).toMatchObject({ status: 'failed', reason: 'platform_unavailable' });
  });

  it('a redelivered requested event queues no second job', async () => {
    const { storeId, token } = await installedStore();
    await requestSync(token);
    const sent: unknown[] = [];
    const registry = new EventHandlerRegistry();
    registerCatalogEventHandlers(registry, { send: async (_q: string, data: object) => (sent.push(data), 'job') }, telemetry);
    const dispatch = eventDispatcher(app, registry);
    const [first] = await requestedEvents(storeId);
    await dispatch(first!.data, { id: 'a', data: first!.data });
    await dispatch(first!.data, { id: 'a', data: first!.data });
    expect(sent).toHaveLength(1);
  });

  it('cookie sessions need the CSRF token: 403 csrf_invalid without it, 202 with it', async () => {
    const { storeId } = await installedStore();
    const sessions = nest.get(SessionService);
    const { token, session } = await sessions.create(storeId, 'direct');
    const cookie = `slips_session=${token}`;
    const without = await fetch(`${base}/v1/catalog/sync`, { method: 'POST', headers: { cookie } });
    expect(without.status).toBe(403);
    expect(await without.json()).toMatchObject({ code: 'csrf_invalid' });
    expect(await requestedEvents(storeId)).toHaveLength(0);
    const ok = await fetch(`${base}/v1/catalog/sync`, { method: 'POST', headers: { cookie, 'x-csrf-token': sessions.csrfToken(session.id) } });
    expect(ok.status).toBe(202);
  });

  it('a stranded queued or running run (untouched > 15 min) reads failed/internal, keeping the last sync time', async () => {
    const { storeId, token } = await installedStore();
    await requestSync(token);
    await work(storeId, new FakePlatform([[product('s1')]]));
    const synced = (await statusOf(token)).last_synced_at;
    await age(storeId, { requested: 61_000 });
    const queued = CatalogSyncStatus.parse((await requestSync(token)).body);
    await age(storeId, { touched: STALE_RUN_MS + 1000 });
    expect(await statusOf(token)).toMatchObject({ status: 'failed', reason: 'internal', run_id: queued.run_id, last_synced_at: synced });
    await admin.query(`update catalog_sync_state set status = 'running' where store_id = $1`, [storeId]);
    expect(await statusOf(token)).toMatchObject({ status: 'failed', reason: 'internal' });
  });

  it('two concurrent first requests on a fresh store yield one run and exactly one requested event', async () => {
    const { storeId, token } = await installedStore();
    const [a, b] = await Promise.all([requestSync(token), requestSync(token)]);
    expect([a.res.status, b.res.status]).toEqual([202, 202]);
    expect(CatalogSyncStatus.parse(a.body).run_id).toBe(CatalogSyncStatus.parse(b.body).run_id);
    expect(await requestedEvents(storeId)).toHaveLength(1);
  });

  it('a requested event whose job could not be queued fails the delivery so it is retried', async () => {
    const { storeId, token } = await installedStore();
    await requestSync(token);
    const registry = new EventHandlerRegistry();
    registerCatalogEventHandlers(registry, { send: async () => null }, telemetry);
    const [first] = await requestedEvents(storeId);
    await expect(eventDispatcher(app, registry)(first!.data, { id: 'a', data: first!.data })).rejects.toThrow(/not queued/);
  });

  it('needs a merchant session', async () => {
    expect((await fetch(`${base}/v1/catalog/sync`, { method: 'POST' })).status).toBe(401);
  });
});
