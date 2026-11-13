// Story 4.6 pilot slice composition test: product freshness on the storefront. Live Postgres (non-owner RLS role for
// every app read and write), real pg-boss outbox and compile eligibility (10 s debounce slots), the real Nest app taking
// signed Salla webhooks inline (CatalogModule's product consumer) and serving the manifest origin, a second integration
// service standing in for the worker sweep, and a caching HTTP fixture in front of the origin purged by delivery.
// Every product change starts at the webhook POST (or the sweep for a fetched 404) and ends at the shopper read
// through the cache; each row's measured milliseconds are printed. Salla HTTP is mocked.
import 'reflect-metadata';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EVENT_QUEUE, type EventEnvelope, type StoreManifest } from '@slips/contracts';
import { ensureTestAppRole, runMigrations, withStoreContext } from '@slips/db';
import { HttpCdnPurger } from '../adapters/cdn/http-cdn-purger.js';
import { EnvelopeTokenCipher } from '../adapters/crypto/envelope-cipher.js';
import { SallaCommercePlatform } from '../adapters/salla/index.js';
import { MemoryObjectStorage } from '../adapters/storage/memory-storage.js';
import { PinoTelemetry } from '../adapters/telemetry/pino-telemetry.js';
import { EventHandlerRegistry, eventDispatcher } from '../events/dispatcher.js';
import { grantEventPublishing } from '../events/queue-grants.js';
import { createHttpApp } from '../http.js';
import { CatalogService } from '../modules/catalog/catalog.service.js';
import { CATALOG_FULL_SYNC_QUEUE } from '../modules/catalog/catalog-sync.js';
import { registerProductWebhooks } from '../modules/catalog/product-webhooks.js';
import { ContentLifecycle } from '../modules/content/content-lifecycle.js';
import { ContentService } from '../modules/content/content.service.js';
import { IntegrationService } from '../modules/integration/integration.service.js';
import { MediaService } from '../modules/media/media.service.js';
import { MANIFEST_DELIVERY_QUEUE, ManifestDelivery, manifestPath, type ManifestDeliveryJob } from '../modules/publishing/manifest-delivery.js';
import { MANIFEST_COMPILE_QUEUE } from '../modules/publishing/manifest-inputs.js';
import { StoreManifestCompiler } from '../modules/publishing/store-manifest.js';
import { registerCatalogEventHandlers } from '../worker/catalog-jobs.js';
import { registerContentEventHandlers } from '../worker/content-jobs.js';
import { registerIntegrationEventHandlers } from '../worker/integration-jobs.js';
import { publishingJobHandlers, registerPublishingEventHandlers } from '../worker/publishing-jobs.js';

const ADMIN_URL = `postgres://slips:slips@127.0.0.1:${process.env.TEST_DATABASE_PORT ?? '5433'}/slips`;
const appUrl = new URL(ADMIN_URL);
appUrl.username = 'slips_it_freshness';
appUrl.password = 'it_freshness_pw';
const SCHEMA = 'pgboss_freshness_test';
const SECRET = 'whsec-freshness-test';
const PURGE_SECRET = 'freshness-purge-secret';
/** Pipeline budget: webhook processed to shopper read. The other minute of the 2-minute P95 is Salla's delivery. */
const BUDGET_MS = 60_000;

const telemetry = new PinoTelemetry({ role: 'worker', level: 'silent' });
const cipher = new EnvelopeTokenCipher({ k1: randomBytes(32).toString('base64') }, 'k1');
const config = { dashboardUrl: 'https://dash.example.com', stateSecret: randomBytes(32), secureCookies: false };
const storage = new MemoryObjectStorage();
const cache = new Map<string, { body: string; until: number }>();
const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 6 });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let userInfoFor = 'none';
const NOT_FOUND = Symbol('404');
let productAnswer: unknown = NOT_FOUND;
const fetchMock = vi.fn(async (url: string | URL) => {
  if (String(url).includes('/products/')) return productAnswer === NOT_FOUND ? json({ status: 404, success: false }, 404) : json(productAnswer);
  return json({ data: { id: 1, name: 'Owner', email: 'owner@example.com', merchant: { id: userInfoFor, name: 'Shop', domain: 'https://shop.example.com/' } } });
});
const platform = new SallaCommercePlatform(
  { clientId: 'cid', clientSecret: 'csecret-xyz', redirectUri: 'https://api.example.com/cb', appId: 'app-1', webhookSecret: SECRET },
  telemetry,
  { fetch: fetchMock as unknown as typeof fetch, sleep: async () => undefined },
);
const tokens = { getAccessToken: async () => 'AT-freshness' };

let app: pg.Pool;
let boss: PgBoss;
let nest: INestApplication;
let fixture: Server;
let base = '';
let cdn = '';
let worker: IntegrationService;
let compiler: StoreManifestCompiler;
let delivery: ManifestDelivery;
let lifecycle: ContentLifecycle;
let dispatch: ReturnType<typeof eventDispatcher>;

beforeAll(async () => {
  await runMigrations(admin);
  await ensureTestAppRole(admin, appUrl.username, appUrl.password);
  app = new pg.Pool({ connectionString: appUrl.href, max: 10 });
  await admin.query(`drop schema if exists ${SCHEMA} cascade`);
  boss = new PgBoss({ connectionString: ADMIN_URL, schema: SCHEMA });
  await boss.start();
  for (const queue of [EVENT_QUEUE, MANIFEST_COMPILE_QUEUE, MANIFEST_DELIVERY_QUEUE, CATALOG_FULL_SYNC_QUEUE]) {
    await boss.createQueue(`${queue}.dead_letter`);
    await boss.createQueue(queue, { retryLimit: 4, retryDelay: 0, deadLetter: `${queue}.dead_letter` });
  }
  await grantEventPublishing(admin, telemetry, [EVENT_QUEUE, MANIFEST_DELIVERY_QUEUE], SCHEMA);
  worker = new IntegrationService(app, platform, cipher, telemetry, boss, config);
  registerProductWebhooks(worker.inbox, tokens, app, platform, telemetry, boss);
  const media = new MediaService(app, storage, boss, telemetry, { uploadRateLimit: 60, publicBaseUrl: 'https://media.test' });
  const content = new ContentService(app);
  compiler = new StoreManifestCompiler(app, content, new CatalogService(app, boss, telemetry), media, worker, telemetry, boss);
  lifecycle = new ContentLifecycle(boss, telemetry, media, worker);
  // The worker's event registrations (worker.ts), so every queued event has its handlers.
  const registry = new EventHandlerRegistry();
  registerIntegrationEventHandlers(registry, telemetry);
  registerCatalogEventHandlers(registry, boss, telemetry);
  registerContentEventHandlers(registry, telemetry, lifecycle, media);
  registerPublishingEventHandlers(registry, boss, telemetry, content);
  dispatch = eventDispatcher(admin, registry);
  nest = await createHttpApp(
    { CORS_ORIGINS: 'https://dashboard.test', NODE_ENV: 'test', LOG_LEVEL: 'silent' },
    {
      pool: app, events: boss, cipher, platform, integration: config, telemetry, storage,
      probe: { isReachable: async () => true, close: async () => {} },
      session: { secret: randomBytes(32), secureCookies: false, embeddedTtlMs: 60_000, directMaxAgeMs: 60_000, idleMs: 60_000 },
    },
  );
  await nest.listen(0, '127.0.0.1');
  base = await nest.getUrl();
  // The CDN: serves cached bodies for 60 s (the manifest's edge TTL) unless delivery purges the path.
  fixture = createServer((req, res) => {
    void (async () => {
      if (req.method === 'POST' && req.url === '/purge') {
        if (req.headers.authorization !== `Bearer ${PURGE_SECRET}`) { res.writeHead(401).end(); return; }
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(Buffer.from(c as Buffer));
        for (const path of (JSON.parse(Buffer.concat(chunks).toString()) as { paths: string[] }).paths) cache.delete(path);
        res.writeHead(204).end();
        return;
      }
      const path = req.url!;
      const hit = cache.get(path);
      if (hit && hit.until > Date.now()) { res.writeHead(200, { 'content-type': 'application/json' }).end(hit.body); return; }
      const response = await fetch(`${base}${path}`, { headers: { origin: 'https://shopper.test' } });
      const body = await response.text();
      if (response.ok) cache.set(path, { body, until: Date.now() + 60_000 });
      res.writeHead(response.status, { 'content-type': 'application/json' }).end(body);
    })().catch(() => res.writeHead(500).end());
  });
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  cdn = `http://127.0.0.1:${(fixture.address() as { port: number }).port}`;
  delivery = new ManifestDelivery(app, worker, storage, new HttpCdnPurger(`${cdn}/purge`, PURGE_SECRET), boss, telemetry);
});

afterAll(async () => {
  fixture?.closeAllConnections();
  await new Promise<void>((resolve) => (fixture ? fixture.close(() => resolve()) : resolve()));
  await nest?.close();
  await boss?.stop({ graceful: false });
  await admin.query(`drop schema if exists ${SCHEMA} cascade`);
  await app?.end();
  await admin.end();
});

const sign = (body: string) => createHmac('sha256', SECRET).update(body).digest('hex');
const post = async (body: string) => {
  const res = await fetch(`${base}/v1/webhooks/salla`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-salla-signature': sign(body), 'x-salla-security-strategy': 'signature' }, body });
  expect(res.status).toBe(200);
};
const hook = (event: string, merchant: string, data: unknown, createdAt: string) => JSON.stringify({ event, merchant, created_at: createdAt, data });
/** Strictly increasing source times, never behind the wall clock (a fetched 404 tombstones at "now"). */
let clock = Date.now();
const at = () => new Date((clock = Math.max(clock + 1000, Date.now() + 1000))).toISOString();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const read = async (merchant: string): Promise<StoreManifest> => (await fetch(`${cdn}${manifestPath(merchant)}`)).json() as Promise<StoreManifest>;
const revision = async (storeId: string) => (await admin.query<{ revision: string }>('select revision::text as revision from store_manifests where store_id = $1', [storeId])).rows[0]?.revision;
const compileJobCount = async (storeId: string) => Number((await admin.query<{ n: string }>(`select count(*)::text as n from ${SCHEMA}.job where name = $1 and singleton_key = $2`, [MANIFEST_COMPILE_QUEUE, storeId])).rows[0]!.n);
const pendingCompiles = async (storeId: string) => Number((await admin.query<{ n: string }>(`select count(*)::text as n from ${SCHEMA}.job where name = $1 and singleton_key = $2 and state in ('created', 'retry', 'active')`, [MANIFEST_COMPILE_QUEUE, storeId])).rows[0]!.n);
const pendingEvents = async () => Number((await admin.query<{ n: string }>(`select count(*)::text as n from ${SCHEMA}.job where name = $1 and state in ('created', 'retry', 'active')`, [EVENT_QUEUE])).rows[0]!.n);
const productId = async (storeId: string, externalId: string) => (await admin.query<{ id: string }>('select id::text as id from products where store_id = $1 and external_id = $2', [storeId, externalId])).rows[0]!.id;

/** Deliver every queued domain event (as `events.dispatch` jobs would), including those handlers emit; returns their names. */
async function dispatchAll(): Promise<string[]> {
  const names: string[] = [];
  for (let round = 0; round < 10; round++) {
    const jobs = await boss.fetch<EventEnvelope>(EVENT_QUEUE, { batchSize: 100 });
    if (jobs.length === 0) return names;
    for (const job of jobs) {
      await dispatch(job.data, { id: job.id, data: job.data });
      await boss.complete(EVENT_QUEUE, job.id);
      names.push(job.data.name);
    }
  }
  throw new Error('event queue did not drain');
}

/** Run the compile jobs pg-boss makes eligible, then deliver (upload and purge) what they queued. */
async function compileAndDeliver(): Promise<number> {
  let compiled = 0;
  const compile = publishingJobHandlers(app, compiler)[MANIFEST_COMPILE_QUEUE]!;
  for (const job of await boss.fetch(MANIFEST_COMPILE_QUEUE, { batchSize: 100 })) {
    await compile(job.data, { id: job.id, data: job.data });
    await boss.complete(MANIFEST_COMPILE_QUEUE, job.id);
    compiled++;
  }
  for (let n = 0; n < 30; n++) {
    const jobs = await boss.fetch<ManifestDeliveryJob>(MANIFEST_DELIVERY_QUEUE, { batchSize: 100 });
    if (jobs.length === 0) return compiled;
    for (const job of jobs) {
      await delivery.deliver(job.data);
      await boss.complete(MANIFEST_DELIVERY_QUEUE, job.id);
    }
  }
  throw new Error('delivery queue did not drain');
}

/**
 * The worker loop until the shopper read through the cache satisfies `fresh`: dispatch events, run eligible compiles,
 * deliver. Returns the elapsed milliseconds from `started` and the events dispatched.
 */
async function untilFresh(merchant: string, started: number, fresh: (m: StoreManifest) => boolean): Promise<{ ms: number; events: string[] }> {
  const events: string[] = [];
  while (Date.now() - started < BUDGET_MS) {
    events.push(...(await dispatchAll()));
    await compileAndDeliver();
    if (fresh(await read(merchant))) return { ms: Date.now() - started, events };
    await sleep(100);
  }
  throw new Error(`shopper read not fresh within ${BUDGET_MS} ms`);
}

/** Run every queued compile, waiting for debounced slots, until none is pending for the store. */
async function settle(storeId: string) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    await dispatchAll();
    await compileAndDeliver();
    if ((await pendingCompiles(storeId)) === 0 && (await pendingEvents()) === 0) return;
    if (Date.now() > deadline) throw new Error('compiles did not settle');
    await sleep(200);
  }
}

describe('product freshness on the storefront (webhook → catalog → event → compile → delivery → CDN)', () => {
  it('meets the 60 s pipeline budget for every matrix row; non-visible and unlinked changes compile nothing', async () => {
    // Install through the Easy Mode path (the sweep finishes it).
    const merchant = `freshness-${randomBytes(6).toString('hex')}`;
    userInfoFor = merchant;
    await post(hook('app.store.authorize', merchant, { access_token: `AT-${merchant}`, refresh_token: `RT-${merchant}`, expires: Math.floor(Date.now() / 1000) + 3600, scope: 'offline_access settings.read' }, at()));
    await worker.inbox.processDue();
    const storeId = (await admin.query<{ id: string }>("select id::text as id from store_locator where platform = 'salla' and platform_store_id = $1", [merchant])).rows[0]!.id;

    // The linked product and two unlinked ones arrive by webhook (a create emits no event).
    const linked: Record<string, unknown> = { id: 'fresh-1', name: 'Linked product', price: { amount: 120, currency: 'SAR' }, quantity: 10, main_image: 'https://cdn.example.com/fresh-1.jpg', status: 'sale' };
    const send = async (event: string, over: Record<string, unknown> = {}) => {
      Object.assign(linked, over);
      await post(hook(event, merchant, { ...linked, updated_at: at() }, at()));
    };
    await send('product.created');
    for (const id of ['other-1', 'other-2']) await post(hook('product.created', merchant, { id, name: `Other ${id}`, price: { amount: 50, currency: 'SAR' }, quantity: 10, updated_at: at() }, at()));
    const product = await productId(storeId, 'fresh-1');

    // A live Home Story linked to the product, published and compiled; the shopper read primes the cache.
    const asset = randomUUID();
    await admin.query(
      `insert into media_assets (id, store_id, kind, status, content_type, size_bytes, upload_key, storage_key, sha256) values ($1, $2, 'image', 'processed', 'image/png', 10, $3, $4, repeat('a', 64))`,
      [asset, storeId, `stores/${storeId}/uploads/${asset}`, `stores/${storeId}/assets/${asset}/inspected`],
    );
    await admin.query(`insert into renditions (store_id, asset_id, profile, content_type, width, height, size_bytes, sha256, storage_key) values ($1, $2, 'web', 'image/webp', 720, 1280, 10, repeat('b', 64), $3)`, [storeId, asset, `stores/${storeId}/assets/${asset}/renditions/web.webp`]);
    const created = await withStoreContext(app, storeId, (tx) => lifecycle.create(tx, storeId, {
      title: 'Linked Home story', format: 'story', cta_label: 'Buy', cta_action: 'add_to_cart', placements: [{ type: 'home' }],
      slides: [{ media_asset_id: asset, alt_text: 'Picture' }],
    }, new Date(), new Map([[asset, { kind: 'image', status: 'processed' }]])));
    const contentId = created.id;
    await withStoreContext(app, storeId, (tx) => lifecycle.edit(tx, storeId, contentId, { product_id: product }));
    await withStoreContext(app, storeId, (tx) => lifecycle.apply(tx, storeId, contentId, 'publish'));
    await settle(storeId);
    const item = (m: StoreManifest) => m.items.find((i) => i.id === contentId);
    expect(item(await read(merchant))?.product).toMatchObject({ id: product, price_minor: 12000, sale_price_minor: null, availability: 'available', has_required_options: false });

    const timings: Record<string, number> = {};

    // Non-visible change: stock within the same bucket, description and tax flag. No event, no compile job.
    {
      const jobs = await compileJobCount(storeId);
      const rev = await revision(storeId);
      await send('product.updated', { quantity: 9, description: 'New long copy', with_tax: false });
      expect(await dispatchAll()).toEqual([]);
      await compileAndDeliver();
      expect(await compileJobCount(storeId)).toBe(jobs);
      expect(await revision(storeId)).toBe(rev);
    }

    // Visible change, unlinked: a burst of price changes emits events but enqueues no compile; the revision stays.
    {
      const jobs = await compileJobCount(storeId);
      const rev = await revision(storeId);
      for (const [n, id] of ['other-1', 'other-2', 'other-1', 'other-2', 'other-1'].entries()) {
        await post(hook('product.updated', merchant, { id, name: `Other ${id}`, price: { amount: 60 + n, currency: 'SAR' }, quantity: 10, updated_at: at() }, at()));
      }
      expect(await dispatchAll()).toEqual(Array(5).fill('catalog.product.updated'));
      expect(await compileJobCount(storeId)).toBe(jobs);
      expect(await revision(storeId)).toBe(rev);
    }

    // Visible changes of the linked product: each is in the shopper read within the budget.
    const visible: Array<[string, string, Record<string, unknown>, (m: StoreManifest) => boolean]> = [
      ['price', 'product.price.updated', { price: { amount: 99.5, currency: 'SAR' } }, (m) => item(m)?.product?.price_minor === 9950],
      ['sale_price', 'product.price.updated', { sale_price: { amount: 80, currency: 'SAR' } }, (m) => item(m)?.product?.sale_price_minor === 8000],
      ['stock_bucket_low', 'product.quantity.low', { quantity: 3 }, (m) => item(m)?.product?.availability === 'low'],
      ['stock_bucket_out', 'product.updated', { quantity: 0 }, (m) => item(m)?.product?.availability === 'out_of_stock'],
      ['required_options', 'product.updated', { options: [{ required: true }] }, (m) => item(m)?.product?.has_required_options === true],
      ['hide', 'product.status.updated', { status: 'hidden' }, (m) => item(m) === undefined],
      ['unhide', 'product.status.updated', { status: 'sale' }, (m) => item(m) !== undefined],
    ];
    for (const [row, event, over, fresh] of visible) {
      await read(merchant); // primed
      const started = Date.now();
      await send(event, over);
      const result = await untilFresh(merchant, started, fresh);
      expect(result.events).toContain('catalog.product.updated');
      timings[row] = result.ms;
    }

    // Deletion by webhook: the item leaves the shopper read; content is flagged (content.item.edited) as before.
    {
      await read(merchant);
      const started = Date.now();
      await post(hook('product.deleted', merchant, { id: 'fresh-1' }, at()));
      const result = await untilFresh(merchant, started, (m) => item(m) === undefined);
      expect(result.events).toEqual(expect.arrayContaining(['catalog.product.deleted', 'content.item.edited']));
      timings.delete_webhook = result.ms;
    }
    // Recreate by a newer source: the item returns at the next compile.
    {
      await settle(storeId);
      await read(merchant);
      const started = Date.now();
      await send('product.updated', { price: { amount: 110, currency: 'SAR' } });
      timings.recreate_after_webhook = (await untilFresh(merchant, started, (m) => item(m)?.product?.price_minor === 11000)).ms;
    }
    // Deletion observed as a 404 on the sweep's fetch (unreadable webhook data), then recreated again.
    {
      await settle(storeId);
      await read(merchant);
      productAnswer = NOT_FOUND;
      const started = Date.now();
      await post(hook('product.updated', merchant, { id: 'fresh-1', name: '' }, at()));
      await worker.inbox.processDue();
      const result = await untilFresh(merchant, started, (m) => item(m) === undefined);
      expect(result.events).toContain('catalog.product.deleted');
      timings.delete_404 = result.ms;
      await settle(storeId);
      await read(merchant);
      const again = Date.now();
      await send('product.updated', { price: { amount: 105, currency: 'SAR' } });
      timings.recreate_after_404 = (await untilFresh(merchant, again, (m) => item(m)?.product?.price_minor === 10500)).ms;
    }

    for (const ms of Object.values(timings)) expect(ms).toBeLessThan(BUDGET_MS);
    console.info('Measured product freshness ms (webhook processed → shopper read, real pg-boss eligibility):', timings);
  }, 600_000);
});
