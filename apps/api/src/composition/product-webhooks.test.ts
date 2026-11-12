// Story 2.4/2.5 composition tests: live Postgres (non-owner RLS role, real pg-boss outbox), signed POSTs to /v1/webhooks/salla
// through the real Nest app (inline processing, catalog's consumer registered by CatalogModule), and a second integration
// service standing in for the worker sweep. Salla HTTP is mocked.
import 'reflect-metadata';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EVENT_QUEUE, type EventEnvelope } from '@slips/contracts';
import { ensureTestAppRole, runMigrations, withStoreContext } from '@slips/db';
import { EnvelopeTokenCipher } from '../adapters/crypto/envelope-cipher.js';
import { SallaCommercePlatform } from '../adapters/salla/index.js';
import { PinoTelemetry } from '../adapters/telemetry/pino-telemetry.js';
import { grantEventPublishing } from '../events/queue-grants.js';
import { createHttpApp } from '../http.js';
import { CatalogReadRepository, CatalogRepository, type ProductWrite } from '../modules/catalog/catalog.repository.js';
import { CATALOG_FULL_SYNC_QUEUE, CatalogSync } from '../modules/catalog/catalog-sync.js';
import { deleteProducts } from '../modules/catalog/product-deletions.js';
import { registerProductWebhooks } from '../modules/catalog/product-webhooks.js';
import { IntegrationService } from '../modules/integration/integration.service.js';
import { MAX_ATTEMPTS } from '../modules/integration/webhook-inbox.js';
import { PlatformUnavailableError, type CanonicalProduct, type CommercePlatform } from '../ports/commerce-platform.js';
import { Metric } from '../ports/telemetry.js';

const ADMIN_URL = `postgres://slips:slips@127.0.0.1:${process.env.TEST_DATABASE_PORT ?? '5433'}/slips`;
const APP_URL = `postgres://slips_it_prodhook:it_prodhook_pw@127.0.0.1:${process.env.TEST_DATABASE_PORT ?? '5433'}/slips`;
const SCHEMA = 'pgboss_prodhook_test';
const SECRET = 'whsec-prodhook-test';
const lines: string[] = [];
const telemetry = new PinoTelemetry({ role: 'http', level: 'debug', stream: { write: (l: string) => void lines.push(l) } });
// Recorded by hand: the shared vitest preset restores spies before each test.
const counter = { mock: { calls: [] as Array<[string, Record<string, string>?, number?]> } };
const realCounter = telemetry.counter.bind(telemetry);
telemetry.counter = (name, labels, value) => {
  counter.mock.calls.push([name, labels as Record<string, string> | undefined, value]);
  realCounter(name, labels, value);
};
const cipher = new EnvelopeTokenCipher({ k1: randomBytes(32).toString('base64') }, 'k1');
const config = { dashboardUrl: 'https://dash.example.com', stateSecret: randomBytes(32), secureCookies: false };

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 4 });
let app: pg.Pool;
let boss: PgBoss;
let nest: INestApplication;
let base = '';
let worker: IntegrationService;
const T = (iso: string) => new Date(iso);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let userInfoFor = 'none';
/** `productAnswer` value that makes GET /products/<id> answer 404 (the product does not exist in Salla). */
const NOT_FOUND = Symbol('404');
/** What GET /products/<id> answers; an Error is thrown as a network failure. */
let productAnswer: unknown;
const fetchMock = vi.fn(async (url: string | URL) => {
  if (String(url).includes('/products/')) {
    if (productAnswer instanceof Error) throw productAnswer;
    if (productAnswer === NOT_FOUND) return json({ status: 404, success: false }, 404);
    return json(productAnswer);
  }
  return json({ data: { id: 1, name: 'Owner', email: 'owner@example.com', merchant: { id: userInfoFor, name: 'Shop', domain: 'https://shop.example.com/' } } });
});
const platform = new SallaCommercePlatform(
  { clientId: 'cid', clientSecret: 'csecret-xyz', redirectUri: 'https://api.example.com/cb', appId: 'app-1', webhookSecret: SECRET },
  telemetry,
  { fetch: fetchMock as unknown as typeof fetch, sleep: async () => undefined },
);

class FakeTokens {
  calls = 0;
  async getAccessToken(): Promise<string> {
    return `AT-${++this.calls}`;
  }
}
const tokens = new FakeTokens();

const sign = (body: string, key = SECRET) => createHmac('sha256', key).update(body).digest('hex');
const post = (body: string, signature = sign(body)) =>
  fetch(`${base}/v1/webhooks/salla`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-salla-signature': signature, 'x-salla-security-strategy': 'signature' }, body });
const hook = (event: string, merchant: string, data: unknown, createdAt = '2026-10-30T10:00:00Z') => JSON.stringify({ event, merchant, created_at: createdAt, data });
const sallaProduct = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Product ${id}`,
  price: { amount: 120, currency: 'SAR' },
  quantity: 10,
  main_image: `https://cdn.example.com/${id}.jpg`,
  updated_at: '2026-10-30T10:00:00Z',
  ...over,
});

const row = (id: string, over: Partial<ProductWrite> = {}): ProductWrite => ({
  platform: 'salla',
  externalId: id,
  name: `Product ${id}`,
  imageUrl: `https://cdn.example.com/${id}.jpg`,
  categoryExternalIds: [],
  priceMinor: 12000,
  salePriceMinor: null,
  currency: 'SAR',
  taxInclusive: true,
  stock: 10,
  availability: 'available',
  hasRequiredOptions: false,
  visible: true,
  sourceUpdatedAt: T('2026-10-30T09:00:00Z'),
  ...over,
});
const repo = new CatalogRepository();
const seed = (storeId: string, ...rows: ProductWrite[]) => withStoreContext(app, storeId, () => repo.upsertProducts(rows));
const productRow = async (storeId: string, externalId: string) => (await admin.query('select * from products where store_id = $1 and external_id = $2', [storeId, externalId])).rows[0] as Record<string, unknown> | undefined;
const inboxOf = async (merchant: string) => (await admin.query('select status, attempts, last_error, payload from webhook_inbox where platform_store_id = $1 order by received_at desc', [merchant])).rows as Array<{ status: string; attempts: number; last_error: string | null; payload: Record<string, unknown> }>;
const updatedEvents = async (storeId: string) =>
  (await admin.query<{ data: EventEnvelope }>(`select data from ${SCHEMA}.job where name = $1 and data->>'store_id' = $2 and data->>'name' = 'catalog.product.updated' order by created_on`, [EVENT_QUEUE, storeId])).rows.map((r) => r.data);
const deletedEvents = async (storeId: string) =>
  (await admin.query<{ data: EventEnvelope }>(`select data from ${SCHEMA}.job where name = $1 and data->>'store_id' = $2 and data->>'name' = 'catalog.product.deleted' order by created_on`, [EVENT_QUEUE, storeId])).rows.map((r) => r.data);
const listed = async (storeId: string) =>
  (await withStoreContext(app, storeId, () => new CatalogReadRepository().listProducts({ sort: 'name', limit: 50, offset: 0 }))).rows.map((r) => r.externalId);
const staleCount = (source: string) => counter.mock.calls.filter((c) => c[0] === Metric.CatalogStaleWrites && (c[1] as Record<string, string>).source === source).reduce((n, c) => n + ((c[2] as number | undefined) ?? 1), 0);

/** Install a store through the Easy Mode path (the sweep finishes it) and return its id. */
async function installStore() {
  const merchant = `prodhook-${randomUUID()}`;
  userInfoFor = merchant;
  const authorize = hook('app.store.authorize', merchant, { access_token: `AT-${merchant}`, refresh_token: `RT-${merchant}`, expires: Math.floor(Date.now() / 1000) + 3600, scope: 'offline_access settings.read' });
  expect((await post(authorize)).status).toBe(200);
  await worker.inbox.processDue();
  const { rows } = await admin.query<{ id: string }>("select id::text as id from store_locator where platform = 'salla' and platform_store_id = $1", [merchant]);
  return { merchant, storeId: rows[0]!.id };
}

beforeAll(async () => {
  await runMigrations(admin);
  await ensureTestAppRole(admin, 'slips_it_prodhook', 'it_prodhook_pw');
  app = new pg.Pool({ connectionString: APP_URL, max: 8 });
  await admin.query(`drop schema if exists ${SCHEMA} cascade`);
  boss = new PgBoss({ connectionString: ADMIN_URL, schema: SCHEMA });
  await boss.start();
  await boss.createQueue(EVENT_QUEUE);
  await boss.createQueue(CATALOG_FULL_SYNC_QUEUE);
  await grantEventPublishing(admin, telemetry, EVENT_QUEUE, SCHEMA, 'slips_app');
  worker = new IntegrationService(app, platform, cipher, telemetry, boss, config);
  registerProductWebhooks(worker.inbox, tokens, app, platform, telemetry, boss);
  nest = await createHttpApp(
    { CORS_ORIGINS: 'http://localhost:3000', LOG_LEVEL: 'silent' },
    { pool: app, events: boss, cipher, platform, integration: config, telemetry, session: { secret: randomBytes(32), secureCookies: false, embeddedTtlMs: 60_000, directMaxAgeMs: 60_000, idleMs: 60_000 } },
  );
  await nest.listen(0);
  base = (await nest.getUrl()).replace('[::1]', 'localhost');
});
afterAll(async () => {
  await nest?.close();
  await boss?.stop({ graceful: false });
  await admin.query(`drop schema if exists ${SCHEMA} cascade`);
  await app?.end();
  await admin.end();
});

describe('product webhooks', () => {
  it('applies a signed product.updated before answering 200, and emits catalog.product.updated with the changed field', async () => {
    const { merchant, storeId } = await installStore();
    await seed(storeId, row('p1'));
    const res = await post(hook('product.updated', merchant, sallaProduct('p1', { price: { amount: 99.5, currency: 'SAR' }, updated_at: '2026-10-30T10:00:00Z' })));
    expect(res.status).toBe(200);
    // Inline: no sweep ran between the 200 and this read.
    expect(await productRow(storeId, 'p1')).toMatchObject({ price_minor: '9950', name: 'Product p1' });
    expect((await inboxOf(merchant))[0]).toMatchObject({ status: 'processed' });
    const events = await updatedEvents(storeId);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ v: 1, store_id: storeId, external_id: 'p1', changed: ['price_minor'], price_minor: 9950, sale_price_minor: null, currency: 'SAR', availability: 'available', visible: true });
    expect((events[0]!.payload as { product_id: string }).product_id).toBe((await productRow(storeId, 'p1'))!.id);
  });

  it('inserts a product.created for a new id without an event', async () => {
    const { merchant, storeId } = await installStore();
    expect((await post(hook('product.created', merchant, sallaProduct('new1')))).status).toBe(200);
    expect(await productRow(storeId, 'new1')).toMatchObject({ price_minor: '12000', stock: 10, availability: 'available' });
    expect((await inboxOf(merchant))[0]).toMatchObject({ status: 'processed' });
    expect(await updatedEvents(storeId)).toHaveLength(0);
  });

  it('skips an older update, counts it, and still marks the inbox row processed', async () => {
    const { merchant, storeId } = await installStore();
    await seed(storeId, row('p1', { priceMinor: 5000, sourceUpdatedAt: T('2026-10-30T12:00:00Z') }));
    const before = staleCount('webhook');
    await post(hook('product.updated', merchant, sallaProduct('p1', { price: { amount: 1, currency: 'SAR' }, updated_at: '2026-10-30T11:00:00Z' })));
    expect(await productRow(storeId, 'p1')).toMatchObject({ price_minor: '5000' });
    expect(staleCount('webhook')).toBe(before + 1);
    expect((await inboxOf(merchant))[0]).toMatchObject({ status: 'processed' });
    expect(await updatedEvents(storeId)).toHaveLength(0);
    // The same source time applies (at or after).
    await post(hook('product.updated', merchant, sallaProduct('p1', { price: { amount: 2, currency: 'SAR' }, updated_at: '2026-10-30T12:00:00Z' }), '2026-10-30T12:00:01Z'));
    expect(await productRow(storeId, 'p1')).toMatchObject({ price_minor: '200' });
  });

  it('treats a second delivery of the same body as a duplicate that is never processed again', async () => {
    const { merchant, storeId } = await installStore();
    await seed(storeId, row('p1'));
    const body = hook('product.updated', merchant, sallaProduct('p1', { price: { amount: 80, currency: 'SAR' } }));
    expect((await post(body)).status).toBe(200);
    expect((await post(body)).status).toBe(200);
    expect((await inboxOf(merchant)).filter((r) => r.payload.kind === 'product')).toHaveLength(1);
    expect(await updatedEvents(storeId)).toHaveLength(1);
  });

  it('updates the row but emits nothing when only the description or a stock count within the same bucket changed', async () => {
    const { merchant, storeId } = await installStore();
    await seed(storeId, row('p1'));
    await post(hook('product.updated', merchant, sallaProduct('p1', { quantity: 9, description: 'new long copy', updated_at: '2026-10-30T10:30:00Z' })));
    expect(await productRow(storeId, 'p1')).toMatchObject({ stock: 9, availability: 'available' });
    expect(await updatedEvents(storeId)).toHaveLength(0);
  });

  it('handles stock, availability, price and status events like product.updated', async () => {
    const { merchant, storeId } = await installStore();
    await seed(storeId, row('p1'));
    await post(hook('product.quantity.low', merchant, sallaProduct('p1', { quantity: 3, updated_at: '2026-10-30T10:01:00Z' })));
    await post(hook('product.status.updated', merchant, sallaProduct('p1', { quantity: 3, status: 'hidden', updated_at: '2026-10-30T10:02:00Z' })));
    await post(hook('product.price.updated', merchant, sallaProduct('p1', { quantity: 3, status: 'hidden', price: { amount: 150, currency: 'SAR' }, sale_price: { amount: 100, currency: 'SAR' }, updated_at: '2026-10-30T10:03:00Z' })));
    await post(hook('product.available', merchant, sallaProduct('p1', { quantity: 20, status: 'sale', price: { amount: 150, currency: 'SAR' }, sale_price: { amount: 100, currency: 'SAR' }, updated_at: '2026-10-30T10:04:00Z' })));
    expect((await updatedEvents(storeId)).map((e) => (e.payload as { changed: string[] }).changed)).toEqual([['availability'], ['visible'], ['price_minor', 'sale_price_minor'], ['availability', 'visible']]);
    expect(await productRow(storeId, 'p1')).toMatchObject({ price_minor: '15000', sale_price_minor: '10000', availability: 'available', visible: true, stock: 20 });
  });

  it('emits catalog.product.updated for a change of the name, the main image or the required-options flag alone', async () => {
    const { merchant, storeId } = await installStore();
    await seed(storeId, row('p1'));
    await post(hook('product.updated', merchant, sallaProduct('p1', { name: 'Renamed', updated_at: '2026-10-30T10:01:00Z' })));
    await post(hook('product.updated', merchant, sallaProduct('p1', { name: 'Renamed', main_image: 'https://cdn.example.com/new.jpg', updated_at: '2026-10-30T10:02:00Z' })));
    await post(hook('product.updated', merchant, sallaProduct('p1', { name: 'Renamed', main_image: 'https://cdn.example.com/new.jpg', options: [{ required: true }], updated_at: '2026-10-30T10:03:00Z' })));
    expect((await updatedEvents(storeId)).map((e) => (e.payload as { changed: string[] }).changed)).toEqual([['name'], ['image_url'], ['has_required_options']]);
    expect(await productRow(storeId, 'p1')).toMatchObject({ name: 'Renamed', image_url: 'https://cdn.example.com/new.jpg', has_required_options: true });
  });

  it('keeps only the id when the data is unreadable: the request answers 200, the sweep fetches the product, and a fetch failure retries', async () => {
    const { merchant, storeId } = await installStore();
    await seed(storeId, row('p9'));
    const body = hook('product.updated', merchant, { id: 'p9', name: '' }, '2026-10-30T10:10:00Z');
    productAnswer = new PlatformUnavailableError('down');
    const calls = fetchMock.mock.calls.length;
    expect((await post(body)).status).toBe(200);
    // No outbound call inline: the row waits for the sweep.
    expect(fetchMock.mock.calls.length).toBe(calls);
    expect((await inboxOf(merchant))[0]).toMatchObject({ status: 'pending', attempts: 0, payload: { product_id: 'p9' } });
    await worker.inbox.processDue();
    expect((await inboxOf(merchant))[0]).toMatchObject({ status: 'pending', attempts: 1, last_error: 'platform_unavailable' });
    // The retry is not due yet; make it due and let the platform answer.
    productAnswer = { data: sallaProduct('p9', { price: { amount: 70, currency: 'SAR' }, updated_at: '2026-10-30T10:11:00Z' }) };
    await admin.query("update webhook_inbox set next_attempt_at = now() - interval '1 hour' where platform_store_id = $1 and type = 'product.updated'", [merchant]);
    await worker.inbox.processDue();
    expect((await inboxOf(merchant))[0]).toMatchObject({ status: 'processed' });
    expect(await productRow(storeId, 'p9')).toMatchObject({ price_minor: '7000' });
    expect(tokens.calls).toBeGreaterThan(0);
  });

  it('dead-letters at once with invalid_payload when a product event has no readable id', async () => {
    const { merchant } = await installStore();
    const before = counter.mock.calls.filter((c) => c[0] === Metric.WebhookFailures && (c[1] as Record<string, string>).reason === 'dead_lettered_invalid_payload').length;
    expect((await post(hook('product.updated', merchant, { name: 'no id' }))).status).toBe(200);
    expect((await inboxOf(merchant))[0]).toMatchObject({ status: 'dead_lettered', last_error: 'invalid_payload', payload: { invalid: true } });
    expect(counter.mock.calls.filter((c) => c[0] === Metric.WebhookFailures && (c[1] as Record<string, string>).reason === 'dead_lettered_invalid_payload')).toHaveLength(before + 1);
  });

  it('dead-letters after the retry budget when the fetch keeps failing', async () => {
    const { merchant } = await installStore();
    productAnswer = new PlatformUnavailableError('down');
    await post(hook('product.updated', merchant, { id: 'p8', name: '' }, '2026-10-30T10:20:00Z'));
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await admin.query("update webhook_inbox set next_attempt_at = now() - interval '1 hour' where platform_store_id = $1 and type = 'product.updated'", [merchant]);
      await worker.inbox.processDue();
    }
    expect((await inboxOf(merchant))[0]).toMatchObject({ status: 'dead_lettered', last_error: 'platform_unavailable' });
  });

  it('dead-letters at once when the product has an unsupported currency, leaving the stored row untouched', async () => {
    const { merchant, storeId } = await installStore();
    await seed(storeId, row('p1'));
    await post(hook('product.updated', merchant, sallaProduct('p1', { price: { amount: 5, currency: 'XYZ' }, updated_at: '2026-10-30T11:00:00Z' })));
    expect((await inboxOf(merchant))[0]).toMatchObject({ status: 'dead_lettered', last_error: 'invalid_payload' });
    expect(await productRow(storeId, 'p1')).toMatchObject({ price_minor: '12000', currency: 'SAR' });
  });

  it('creates the product categories, and an older-dated write does not overwrite a newer category name', async () => {
    const { merchant, storeId } = await installStore();
    const categoryName = async () => (await admin.query('select name from categories where store_id = $1 and external_id = $2', [storeId, 'cat1'])).rows[0]?.name;
    await post(hook('product.created', merchant, sallaProduct('c1', { categories: [{ id: 'cat1', name: 'Newer' }] }), '2026-10-30T12:00:00Z'));
    expect(await categoryName()).toBe('Newer');
    await post(hook('product.created', merchant, sallaProduct('c2', { categories: [{ id: 'cat1', name: 'Older' }] }), '2026-10-30T08:00:00Z'));
    expect(await productRow(storeId, 'c2')).toBeDefined();
    expect(await categoryName()).toBe('Newer');
  });

  it('parks a product event for a merchant that is not installed', async () => {
    const merchant = `unknown-${randomUUID()}`;
    expect((await post(hook('product.updated', merchant, sallaProduct('p1')))).status).toBe(200);
    expect((await inboxOf(merchant))[0]).toMatchObject({ status: 'pending', last_error: 'unknown_store' });
  });

  it('a full sync no longer overwrites a newer webhook write, and counts the skip with source sync', async () => {
    const { merchant, storeId } = await installStore();
    await seed(storeId, row('p1'));
    await post(hook('product.updated', merchant, sallaProduct('p1', { price: { amount: 42, currency: 'SAR' }, updated_at: '2026-10-30T15:00:00Z' })));
    const older: CanonicalProduct = {
      externalId: 'p1', name: 'Old name', imageUrl: null, categories: [], price: '99', salePrice: null, currency: 'SAR', taxInclusive: true, stock: 1,
      hasRequiredOptions: false, visible: true, sourceUpdatedAt: T('2026-10-30T14:00:00Z'),
    };
    const fresh: CanonicalProduct = { ...older, externalId: 'p2', name: 'Fresh', sourceUpdatedAt: T('2026-10-30T14:00:00Z') };
    const listing = { platform: 'salla', products: { list: async () => ({ items: [older, fresh], hasMore: false }) }, auth: {} } as unknown as CommercePlatform;
    const before = staleCount('sync');
    const runId = (await import('../events/outbox.js')).uuidv7();
    await new CatalogSync(app, listing, tokens, telemetry, boss).run(storeId, runId, { finalAttempt: false });
    expect(await productRow(storeId, 'p1')).toMatchObject({ name: 'Product p1', price_minor: '4200' });
    expect(await productRow(storeId, 'p2')).toMatchObject({ name: 'Fresh' });
    expect(staleCount('sync')).toBe(before + 1);
  });

  it('keeps the row pending (retried by the sweep) when no consumer is registered', async () => {
    const bare = new IntegrationService(app, platform, cipher, telemetry, boss, config);
    const { merchant } = await installStore();
    const body = hook('product.updated', merchant, sallaProduct('p1'), '2026-10-30T10:40:00Z');
    // Take the row away from the live app by receiving it on the bare service only.
    const received = await bare.inbox.receive({ headers: { 'x-salla-signature': sign(body), 'x-salla-security-strategy': 'signature' }, rawBody: Buffer.from(body) });
    expect(received).toMatchObject({ status: 200, duplicate: false });
    expect(await bare.inbox.processOne((received as { id: string }).id)).toBe('retry');
    expect((await inboxOf(merchant))[0]).toMatchObject({ status: 'pending', attempts: 1, last_error: 'internal' });
  });
});

describe('disconnected store (Story 2.7)', () => {
  const disconnect = (storeId: string) => admin.query("update stores set lifecycle_state = 'disconnected' where id = $1", [storeId]);

  it('a product webhook that needs a fetch is ignored with reason disconnected: no platform call, no retry, no dead-letter, rows untouched', async () => {
    // A sweep wired to the real token custody, as in the worker.
    const sweep = new IntegrationService(app, platform, cipher, telemetry, boss, config);
    registerProductWebhooks(sweep.inbox, sweep, app, platform, telemetry, boss);
    const { merchant, storeId } = await installStore();
    await seed(storeId, row('p20'));
    const before = await productRow(storeId, 'p20');
    await disconnect(storeId);
    productAnswer = { data: sallaProduct('p20', { price: { amount: 1, currency: 'SAR' }, updated_at: '2026-10-30T12:00:00Z' }) };
    const failures = counter.mock.calls.filter((c) => c[0] === Metric.WebhookFailures).length;
    expect((await post(hook('product.updated', merchant, { id: 'p20', name: '' }, '2026-10-30T12:00:00Z'))).status).toBe(200);
    const calls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/products/')).length;
    lines.length = 0;
    await sweep.inbox.processDue();
    expect((await inboxOf(merchant))[0]).toMatchObject({ status: 'ignored', attempts: 0, last_error: null });
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/products/')).length).toBe(calls);
    expect(counter.mock.calls.filter((c) => c[0] === Metric.WebhookFailures)).toHaveLength(failures);
    expect(await productRow(storeId, 'p20')).toEqual(before);
    const skipped = lines.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.msg === 'product webhook skipped');
    expect(skipped).toMatchObject({ reason: 'disconnected', store_id: storeId });
    // Ignored rows are never picked up again.
    await admin.query("update webhook_inbox set next_attempt_at = now() - interval '1 hour' where platform_store_id = $1", [merchant]);
    await sweep.inbox.processDue();
    expect((await inboxOf(merchant))[0]).toMatchObject({ status: 'ignored', attempts: 0 });
  });

  it('a product webhook with readable data still applies (no token needed)', async () => {
    const { merchant, storeId } = await installStore();
    await seed(storeId, row('p21'));
    await disconnect(storeId);
    expect((await post(hook('product.updated', merchant, sallaProduct('p21', { price: { amount: 55, currency: 'SAR' }, updated_at: '2026-10-30T12:00:00Z' })))).status).toBe(200);
    expect((await inboxOf(merchant))[0]).toMatchObject({ status: 'processed' });
    expect(await productRow(storeId, 'p21')).toMatchObject({ price_minor: '5500' });
  });
});

describe('product deletions (Story 2.5)', () => {
  const deleteHook = (merchant: string, id: unknown, createdAt = '2026-10-30T10:00:00Z', extra: Record<string, unknown> = {}) => hook('product.deleted', merchant, id === undefined ? { ...extra } : { id, ...extra }, createdAt);

  it('tombstones a live product on a signed product.deleted, inline, and emits catalog.product.deleted', async () => {
    const { merchant, storeId } = await installStore();
    await seed(storeId, row('p1'), row('p2'));
    const calls = fetchMock.mock.calls.length;
    expect((await post(deleteHook(merchant, 'p1'))).status).toBe(200);
    // Inline, and without a platform call.
    expect(fetchMock.mock.calls.length).toBe(calls);
    const p1 = (await productRow(storeId, 'p1'))!;
    expect(p1.deleted_at).toEqual(T('2026-10-30T10:00:00Z'));
    expect(p1.source_updated_at).toEqual(T('2026-10-30T10:00:00Z'));
    expect((await productRow(storeId, 'p2'))!.deleted_at).toBeNull();
    expect((await inboxOf(merchant))[0]).toMatchObject({ status: 'processed', payload: { kind: 'product', product_id: 'p1', deleted: true } });
    const events = await deletedEvents(storeId);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toEqual({ v: 1, store_id: storeId, product_id: p1.id, external_id: 'p1' });
    expect(await updatedEvents(storeId)).toHaveLength(0);
    expect(await listed(storeId)).toEqual(['p2']);
    expect(lines.some((l) => l.includes('"msg":"product deleted"') && l.includes(storeId) && l.includes('"source":"webhook"'))).toBe(true);
  });

  it('a repeated delete (different body) changes nothing and emits nothing', async () => {
    const { merchant, storeId } = await installStore();
    await seed(storeId, row('p1'));
    await post(deleteHook(merchant, 'p1'));
    expect((await post(deleteHook(merchant, 'p1', '2026-10-30T10:05:00Z'))).status).toBe(200);
    const rows = await inboxOf(merchant);
    expect(rows.filter((r) => r.payload.deleted === true).map((r) => r.status)).toEqual(['processed', 'processed']);
    expect((await productRow(storeId, 'p1'))!.deleted_at).toEqual(T('2026-10-30T10:00:00Z'));
    expect(await deletedEvents(storeId)).toHaveLength(1);
  });

  it('a delete of an external id never stored writes nothing and emits nothing', async () => {
    const { merchant, storeId } = await installStore();
    expect((await post(deleteHook(merchant, 'ghost'))).status).toBe(200);
    expect((await inboxOf(merchant))[0]).toMatchObject({ status: 'processed' });
    expect(await productRow(storeId, 'ghost')).toBeUndefined();
    expect(await deletedEvents(storeId)).toHaveLength(0);
  });

  it('skips a delete older than the stored source time and counts it as a stale webhook write', async () => {
    const { merchant, storeId } = await installStore();
    await seed(storeId, row('p1', { sourceUpdatedAt: T('2026-10-30T12:00:00Z') }));
    const before = staleCount('webhook');
    await post(deleteHook(merchant, 'p1', '2026-10-30T11:00:00Z'));
    expect((await productRow(storeId, 'p1'))!.deleted_at).toBeNull();
    expect(staleCount('webhook')).toBe(before + 1);
    expect((await inboxOf(merchant))[0]).toMatchObject({ status: 'processed' });
    expect(await deletedEvents(storeId)).toHaveLength(0);
    // A delete at the same time as the stored write wins the tie.
    await post(deleteHook(merchant, 'p1', '2026-10-30T12:00:00Z'));
    expect((await productRow(storeId, 'p1'))!.deleted_at).toEqual(T('2026-10-30T12:00:00Z'));
    expect(await deletedEvents(storeId)).toHaveLength(1);
  });

  it('an update at or before the deletion time, delivered after it, never resurrects the product', async () => {
    const { merchant, storeId } = await installStore();
    await seed(storeId, row('p1'));
    await post(deleteHook(merchant, 'p1', '2026-10-30T10:00:00Z'));
    const before = staleCount('webhook');
    await post(hook('product.updated', merchant, sallaProduct('p1', { price: { amount: 1, currency: 'SAR' }, updated_at: '2026-10-30T10:00:00Z' })));
    await post(hook('product.updated', merchant, sallaProduct('p1', { price: { amount: 2, currency: 'SAR' }, updated_at: '2026-10-30T09:30:00Z' }), '2026-10-30T09:30:00Z'));
    const p1 = (await productRow(storeId, 'p1'))!;
    expect(p1).toMatchObject({ price_minor: '12000' });
    expect(p1.deleted_at).toEqual(T('2026-10-30T10:00:00Z'));
    expect(staleCount('webhook')).toBe(before + 2);
    expect(await updatedEvents(storeId)).toHaveLength(0);
    expect(await listed(storeId)).toEqual([]);
  });

  it('a strictly newer create/update of a deleted id restores it with every visible field in changed', async () => {
    const { merchant, storeId } = await installStore();
    await seed(storeId, row('p1'));
    await post(deleteHook(merchant, 'p1', '2026-10-30T10:00:00Z'));
    await post(hook('product.created', merchant, sallaProduct('p1', { name: 'Back again', price: { amount: 130, currency: 'SAR' }, updated_at: '2026-10-30T11:00:00Z' }), '2026-10-30T11:00:00Z'));
    const p1 = (await productRow(storeId, 'p1'))!;
    expect(p1).toMatchObject({ deleted_at: null, name: 'Back again', price_minor: '13000' });
    expect(p1.source_updated_at).toEqual(T('2026-10-30T11:00:00Z'));
    const events = await updatedEvents(storeId);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ product_id: p1.id, external_id: 'p1', changed: ['name', 'image_url', 'price_minor', 'sale_price_minor', 'availability', 'has_required_options', 'visible'], name: 'Back again', price_minor: 13000 });
    expect(await listed(storeId)).toEqual(['p1']);
    // Deleting it again is a new live-to-deleted transition.
    await post(deleteHook(merchant, 'p1', '2026-10-30T12:00:00Z'));
    expect(await deletedEvents(storeId)).toHaveLength(2);
  });

  it('treats a 404 on the product fetch as a deletion observed at fetch time, instead of retrying', async () => {
    const { merchant, storeId } = await installStore();
    await seed(storeId, row('p9'));
    productAnswer = NOT_FOUND;
    expect((await post(hook('product.updated', merchant, { id: 'p9', name: '' }, '2026-10-30T10:10:00Z'))).status).toBe(200);
    expect((await inboxOf(merchant))[0]).toMatchObject({ status: 'pending', attempts: 0 });
    const before = Date.now();
    await worker.inbox.processDue();
    expect((await inboxOf(merchant))[0]).toMatchObject({ status: 'processed' });
    const p9 = (await productRow(storeId, 'p9'))!;
    expect((p9.deleted_at as Date).getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(p9.source_updated_at).toEqual(p9.deleted_at);
    expect((await deletedEvents(storeId)).map((e) => e.payload)).toEqual([{ v: 1, store_id: storeId, product_id: p9.id, external_id: 'p9' }]);
  });

  it('dead-letters at once with invalid_payload when product.deleted has no readable id', async () => {
    const { merchant } = await installStore();
    expect((await post(deleteHook(merchant, undefined, '2026-10-30T10:00:00Z', { name: 'no id' }))).status).toBe(200);
    expect((await inboxOf(merchant))[0]).toMatchObject({ status: 'dead_lettered', last_error: 'invalid_payload', payload: { invalid: true } });
  });

  it('a full sync updates a tombstoned product but leaves it deleted and emits nothing', async () => {
    const { merchant, storeId } = await installStore();
    await seed(storeId, row('p1'));
    await post(deleteHook(merchant, 'p1', '2026-10-30T10:00:00Z'));
    const newer: CanonicalProduct = {
      externalId: 'p1', name: 'Synced name', imageUrl: null, categories: [], price: '50', salePrice: null, currency: 'SAR', taxInclusive: true, stock: 1,
      hasRequiredOptions: false, visible: true, sourceUpdatedAt: T('2026-10-30T11:00:00Z'),
    };
    const listing = { platform: 'salla', products: { list: async () => ({ items: [newer], hasMore: false }) }, auth: {} } as unknown as CommercePlatform;
    const runId = (await import('../events/outbox.js')).uuidv7();
    await new CatalogSync(app, listing, tokens, telemetry, boss).run(storeId, runId, { finalAttempt: false });
    const p1 = (await productRow(storeId, 'p1'))!;
    expect(p1).toMatchObject({ name: 'Synced name', price_minor: '5000' });
    expect(p1.deleted_at).toEqual(T('2026-10-30T10:00:00Z'));
    expect(await updatedEvents(storeId)).toHaveLength(0);
    expect(await deletedEvents(storeId)).toHaveLength(1);
    expect(await listed(storeId)).toEqual([]);
  });

  it('deleteProducts batches several ids for reconcile: counts each outcome, one event per newly deleted product', async () => {
    const { storeId } = await installStore();
    const at = T('2026-10-30T10:00:00Z');
    await seed(storeId, row('a'), row('b'), row('c', { sourceUpdatedAt: T('2026-10-30T11:00:00Z') }), row('d'));
    const deps = { events: boss, telemetry };
    const run = (ids: string[]) =>
      withStoreContext(app, storeId, async (ctx) => {
        await repo.lockProductWrites();
        return deleteProducts(ctx, deps, { storeId, platform: 'salla', externalIds: ids, observedAt: at, source: 'reconcile' });
      });
    await run(['d']);
    const before = staleCount('reconcile');
    expect(await run(['a', 'b', 'c', 'd', 'e', 'a'])).toEqual({ deleted: 2, alreadyDeleted: 1, stale: 1, unknown: 1 });
    expect(staleCount('reconcile')).toBe(before + 1);
    const ids = new Map([['a', (await productRow(storeId, 'a'))!.id], ['b', (await productRow(storeId, 'b'))!.id], ['d', (await productRow(storeId, 'd'))!.id]]);
    const payloads = (await deletedEvents(storeId)).map((e) => e.payload as { external_id: string }).sort((x, y) => x.external_id.localeCompare(y.external_id));
    expect(payloads).toEqual(['a', 'b', 'd'].map((id) => ({ v: 1, store_id: storeId, product_id: ids.get(id), external_id: id })));
    expect((await productRow(storeId, 'c'))!.deleted_at).toBeNull();
    expect(await productRow(storeId, 'e')).toBeUndefined();
    expect(lines.some((l) => l.includes('"msg":"product deleted"') && l.includes('"source":"reconcile"'))).toBe(true);
  });

  it('writes neither the tombstone nor the event when the transaction rolls back', async () => {
    const { storeId } = await installStore();
    await seed(storeId, row('p1'));
    await expect(
      withStoreContext(app, storeId, async (ctx) => {
        await repo.lockProductWrites();
        await deleteProducts(ctx, { events: boss, telemetry }, { storeId, platform: 'salla', externalIds: ['p1'], observedAt: T('2026-10-30T10:00:00Z'), source: 'webhook' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect((await productRow(storeId, 'p1'))!.deleted_at).toBeNull();
    expect(await deletedEvents(storeId)).toHaveLength(0);
  });
});
