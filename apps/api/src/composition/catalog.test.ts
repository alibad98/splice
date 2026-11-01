// Story 2.1 composition tests: live Postgres (non-owner RLS role, real pg-boss outbox), a fake CommercePlatform and
// a fake token source standing in for integration.getAccessToken.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EVENT_QUEUE, type EventEnvelope } from '@slips/contracts';
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

const ADMIN_URL = 'postgres://slips:slips@127.0.0.1:5433/slips';
const APP_URL = 'postgres://slips_it_catalog_sync:it_catalog_sync_pw@127.0.0.1:5433/slips';
const SCHEMA = 'pgboss_catalog_test';
const lines: string[] = [];
const telemetry = new PinoTelemetry({ role: 'worker', level: 'debug', stream: { write: (l: string) => void lines.push(l) } });

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 4 });
/** Run ids are event ids: time-ordered UUIDv7, strictly increasing here. */
let runClock = Date.now();
const nextRun = (): string => uuidv7(++runClock);
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
    expect(await new CatalogService(app).getSyncState(storeId)).toMatchObject({ status: 'succeeded', reason: null, created: 4, updated: 0 });
    expect((await new CatalogService(app).getSyncState(randomUUID())).status).toBe('never');
  });

  it('is idempotent: the same run again is skipped; a new run (reinstall) updates rows without duplicating them', async () => {
    const storeId = randomUUID();
    const runId = nextRun();
    const platform = new FakePlatform([[product('a'), product('b')]]);
    const { sync } = syncFor(platform);
    expect(await sync.run(storeId, runId)).toBe('succeeded');
    expect(await sync.run(storeId, runId)).toBe('already_succeeded');
    expect(platform.calls).toEqual([1]);

    platform.pages = [[product('a', { price: '15.00' }), product('b'), product('c')]];
    const rerun = nextRun();
    expect(await sync.run(storeId, rerun)).toBe('succeeded');
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
    expect(await sync.run(storeId, nextRun())).toBe('succeeded');
    expect((await productsOf(storeId)).map((r) => r.name)).toEqual(['new']);
  });

  it('a transient platform error fails the attempt for retry (state failed, platform_unavailable); the retry resumes from the next page', async () => {
    const storeId = randomUUID();
    const runId = nextRun();
    const platform = new FakePlatform([[product('r1')], [product('r2')], [product('r3')]]);
    platform.fail.set(2, new PlatformUnavailableError('rate limited', 30));
    const { sync } = syncFor(platform);
    await expect(sync.run(storeId, runId)).rejects.toBeInstanceOf(PlatformUnavailableError);
    expect(await stateOf(storeId)).toMatchObject({ status: 'failed', reason: 'platform_unavailable', next_page: 2, created_count: 1 });
    expect(await new CatalogService(app).getSyncState(storeId)).toMatchObject({ status: 'failed', reason: 'platform_unavailable' });
    expect(await completedEvents(storeId)).toHaveLength(0);

    expect(await sync.run(storeId, runId)).toBe('succeeded');
    expect(platform.calls).toEqual([1, 2, 2, 3]);
    expect(await stateOf(storeId)).toMatchObject({ status: 'succeeded', reason: null, created_count: 3 });
    expect(await completedEvents(storeId)).toHaveLength(1);
  });

  it('an unexpected error is retried too, recorded as internal', async () => {
    const storeId = randomUUID();
    const platform = new FakePlatform([[product('x')]]);
    platform.fail.set(1, new Error('boom'));
    const { sync } = syncFor(platform);
    await expect(sync.run(storeId, nextRun())).rejects.toThrow('boom');
    expect(await stateOf(storeId)).toMatchObject({ status: 'failed', reason: 'internal' });
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
    expect(await sync.run(storeId, nextRun())).toEqual({ failed: reason });
    expect(await stateOf(storeId)).toMatchObject({ status: 'failed', reason });
    expect(await completedEvents(storeId)).toHaveLength(0);
  });

  it('a store uninstalled mid-sync stops at the next page as store_inactive and keeps what it imported', async () => {
    const storeId = randomUUID();
    const tokens = new FakeTokens();
    tokens.failOn.set(2, new StoreDisconnectedError());
    const platform = new FakePlatform([[product('u1')], [product('u2')]]);
    const { sync } = syncFor(platform, tokens);
    expect(await sync.run(storeId, nextRun())).toEqual({ failed: 'store_inactive' });
    expect(platform.calls).toEqual([1]);
    expect((await productsOf(storeId)).map((r) => r.external_id)).toEqual(['u1']);
  });

  it('an unknown store currency (every product on the page) fails the run as unknown_currency without a retry and stores nothing', async () => {
    const storeId = randomUUID();
    const { sync } = syncFor(new FakePlatform([[product('m1', { currency: 'XYZ' }), product('m2', { currency: 'XYZ' })]]));
    expect(await sync.run(storeId, nextRun())).toEqual({ failed: 'unknown_currency' });
    expect(await productsOf(storeId)).toEqual([]);
  });

  it('a few unreadable products (unknown currency, bad or negative amount) are skipped and counted; the rest import', async () => {
    const storeId = randomUUID();
    const runId = nextRun();
    const { sync } = syncFor(
      new FakePlatform([[product('k1'), product('k2', { currency: 'XYZ' }), product('k3', { price: '1,5' }), product('k4', { price: '-2.00' }), product('k5', { price: '10.00', salePrice: '9.999' })]]),
    );
    expect(await sync.run(storeId, runId)).toBe('succeeded');
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
    expect(await sync.run(storeId, runId)).toBe('superseded');
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
    await expect(sync.run(storeId, older)).rejects.toBeInstanceOf(PlatformUnavailableError);
    expect(await sync.run(storeId, newer)).toBe('succeeded');
    expect(await sync.run(storeId, older)).toBe('superseded');
    expect(await stateOf(storeId)).toMatchObject({ run_id: newer, status: 'succeeded' });
    // A failed newer run is not taken over either; markFailed of the older run leaves it alone.
    await admin.query(`update catalog_sync_state set status = 'failed', reason = 'platform_unavailable' where store_id = $1`, [storeId]);
    expect(await sync.run(storeId, older)).toBe('superseded');
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
    await expect(sync.run(storeId, runId)).rejects.toBeInstanceOf(RunBusyError);
    expect(await stateOf(storeId)).toMatchObject({ status: 'running', next_page: 2 }); // not marked failed
    clock += RUN_HEARTBEAT_MS + 1;
    expect(await sync.run(storeId, runId)).toBe('succeeded');
    expect(platform.calls).toEqual([2]);
    expect(await stateOf(storeId)).toMatchObject({ status: 'succeeded', created_count: 2 });
  });

  it('a second run while another is fresh and running is superseded; a stale running run is replaced', async () => {
    const storeId = randomUUID();
    let clock = Date.now();
    await withStoreContext(app, storeId, (ctx) => ctx.query(`insert into catalog_sync_state (store_id, run_id, status, updated_at) values ($1, $2, 'running', $3)`, [storeId, nextRun(), new Date(clock)]));
    const platform = new FakePlatform([[product('s1')]]);
    const { sync } = syncFor(platform, new FakeTokens(), () => clock);
    expect(await sync.run(storeId, nextRun())).toBe('superseded');
    expect(platform.calls).toEqual([]);
    clock += STALE_RUN_MS + 1;
    expect(await sync.run(storeId, nextRun())).toBe('succeeded');
  });

  it('does not limit product count by plan and reads no billing data (AD-14)', async () => {
    const storeId = randomUUID();
    const many = Array.from({ length: 120 }, (_, i) => product(`n${String(i).padStart(3, '0')}`));
    const { sync } = syncFor(new FakePlatform([many.slice(0, 60), many.slice(60)]));
    expect(await sync.run(storeId, nextRun())).toBe('succeeded');
    expect(await productsOf(storeId)).toHaveLength(120);
    const dir = fileURLToPath(new URL('../modules/catalog/', import.meta.url));
    for (const file of readdirSync(dir)) expect(readFileSync(`${dir}${file}`, 'utf8')).not.toMatch(/billing|entitlement|subscriptions/i);
  });
});

describe('catalog purge', () => {
  it('removes products in batches, then categories and sync state', async () => {
    const storeId = randomUUID();
    const { sync } = syncFor(new FakePlatform([[product('g1'), product('g2'), product('g3')]]));
    await sync.run(storeId, nextRun());
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
