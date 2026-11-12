import { MANIFEST_DELIVERY_QUEUE } from '../modules/publishing/manifest-delivery.js';
// Story 4.4 pilot slice composition tests: live Postgres (non-owner RLS role for every compile read and write), real
// pg-boss outbox and compile queue. Covers the I/O matrix: publish, ineligible items, cap, withdraw, burst, race,
// lifecycle, off-domain CTA, size and lag metrics, and that preview and store compiles share `compileManifest`.
import 'reflect-metadata';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EVENT_QUEUE, StoreManifest, type EventEnvelope, type EventName, type EventPayload } from '@slips/contracts';
import { ensureTestAppRole, runMigrations, withStoreContext } from '@slips/db';
import { EnvelopeTokenCipher } from '../adapters/crypto/envelope-cipher.js';
import { MemoryObjectStorage } from '../adapters/storage/memory-storage.js';
import { PinoTelemetry } from '../adapters/telemetry/pino-telemetry.js';
import { EventHandlerRegistry, eventDispatcher } from '../events/dispatcher.js';
import { publishEvent } from '../events/outbox.js';
import { grantEventPublishing } from '../events/queue-grants.js';
import { CatalogService } from '../modules/catalog/catalog.service.js';
import { ContentLifecycle } from '../modules/content/content-lifecycle.js';
import { ContentService } from '../modules/content/content.service.js';
import { IntegrationService } from '../modules/integration/integration.service.js';
import { MediaService } from '../modules/media/media.service.js';
import { MANIFEST_COMPILE_QUEUE, MANIFEST_GZIP_WARN_BYTES, MANIFEST_INPUTS } from '../modules/publishing/manifest-inputs.js';
import { publishingStoreData } from '../modules/publishing/publishing.lifecycle.js';
import { PublishingService } from '../modules/publishing/publishing.service.js';
import { StoreManifestCompiler } from '../modules/publishing/store-manifest.js';
import type { CommercePlatform } from '../ports/commerce-platform.js';
import { Metric } from '../ports/telemetry.js';
import { registerContentEventHandlers } from '../worker/content-jobs.js';
import { enqueueManifestCompile, publishingJobHandlers, registerPublishingEventHandlers } from '../worker/publishing-jobs.js';

const ADMIN_URL = process.env.MANIFEST_TEST_ADMIN_URL ?? `postgres://slips:slips@127.0.0.1:${process.env.TEST_DATABASE_PORT ?? '5433'}/slips`;
const appUrl = new URL(ADMIN_URL);
appUrl.username = 'slips_it_manifest_comp';
appUrl.password = 'it_manifest_comp_pw';
const SCHEMA = 'pgboss_manifest_test';
const MEDIA_BASE = 'https://media.example.test/slips-media';
const SHOP = 'shop.example.com';

const telemetry = new PinoTelemetry({ role: 'worker', level: 'silent' });
const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 6 });
let app: pg.Pool;
let boss: PgBoss;
let content: ContentService;
let catalog: CatalogService;
let media: MediaService;
let integration: IntegrationService;
let compiler: StoreManifestCompiler;
let lifecycle: ContentLifecycle;
let dispatch: ReturnType<typeof eventDispatcher>;

beforeAll(async () => {
  await runMigrations(admin);
  await ensureTestAppRole(admin, appUrl.username, appUrl.password);
  app = new pg.Pool({ connectionString: appUrl.href, max: 8 });
  await admin.query(`drop schema if exists ${SCHEMA} cascade`);
  boss = new PgBoss({ connectionString: ADMIN_URL, schema: SCHEMA });
  await boss.start();
  await boss.createQueue(EVENT_QUEUE);
  await boss.createQueue(MANIFEST_COMPILE_QUEUE);
  await boss.createQueue(MANIFEST_DELIVERY_QUEUE);
  await grantEventPublishing(admin, telemetry, [EVENT_QUEUE, MANIFEST_DELIVERY_QUEUE], SCHEMA, 'slips_app');
  content = new ContentService(app);
  catalog = new CatalogService(app, boss, telemetry);
  media = new MediaService(app, new MemoryObjectStorage(), boss, telemetry, { uploadRateLimit: 60, publicBaseUrl: `${MEDIA_BASE}/` });
  const cipher = new EnvelopeTokenCipher({ k1: randomBytes(32).toString('base64') }, 'k1');
  integration = new IntegrationService(app, {} as CommercePlatform, cipher, telemetry, boss, { dashboardUrl: 'https://dash.example.com', stateSecret: randomBytes(32), secureCookies: false });
  compiler = new StoreManifestCompiler(app, content, catalog, media, integration, telemetry, boss);
  lifecycle = new ContentLifecycle(boss, telemetry, media);
  const registry = new EventHandlerRegistry();
  registerPublishingEventHandlers(registry, boss, telemetry, content);
  registerContentEventHandlers(registry, telemetry, lifecycle);
  // The worker delivers events on its own (pg-boss owner) pool; compiles run as the RLS-bound app role.
  dispatch = eventDispatcher(admin, registry);
});

afterAll(async () => {
  await boss?.stop({ graceful: false });
  await admin.query(`drop schema if exists ${SCHEMA} cascade`);
  await app?.end();
  await admin.end();
});

const sha = () => createHash('sha256').update(randomBytes(16)).digest('hex');

async function store(state: 'active' | 'disconnected' | 'uninstalled' | 'purged' = 'active', domains: string[] = [SHOP]) {
  const storeId = randomUUID();
  await admin.query(
    `insert into stores (id, store_id, platform, platform_store_id, name, synced_domains, lifecycle_state) values ($1, $1, 'salla', $2, 'Manifest Store', $3, $4)`,
    [storeId, `manifest-${storeId}`, domains, state],
  );
  return storeId;
}

async function processedAsset(storeId: string, kind: 'image' | 'video' = 'video', status = 'processed', profiles: readonly string[] = kind === 'image' ? ['web'] : ['480p', '720p', '1080p', 'poster']) {
  const id = randomUUID();
  await admin.query(
    `insert into media_assets (id, store_id, kind, status, content_type, size_bytes, upload_key, storage_key, source_url, failure_reason, sha256)
     values ($1, $2, $3, $4, $5, 100, $6, $7, 'https://external.example/unsafe', case when $4 = 'failed' then 'malware' end, repeat('a', 64))`,
    [id, storeId, kind, status, kind === 'image' ? 'image/png' : 'video/mp4', `stores/${storeId}/uploads/${id}`, ['scanned', 'processed', 'failed'].includes(status) ? `stores/${storeId}/assets/${id}/inspected` : null],
  );
  for (const profile of profiles) {
    const hash = sha();
    const type = ['poster', 'web'].includes(profile) ? 'image/webp' : 'video/mp4';
    await admin.query(
      `insert into renditions (store_id, asset_id, profile, content_type, width, height, size_bytes, sha256, storage_key) values ($1, $2, $3, $4, 720, 1280, 10, $5, $6)`,
      [storeId, id, profile, type, hash, `stores/${storeId}/assets/${id}/${hash}/renditions/${profile}.${type === 'video/mp4' ? 'mp4' : 'webp'}`],
    );
  }
  return id;
}

async function product(storeId: string, deleted = false) {
  const id = randomUUID();
  await admin.query(
    `insert into products (id, store_id, platform, external_id, name, price_minor, sale_price_minor, currency, tax_inclusive, availability, has_required_options, visible, source_updated_at, deleted_at)
     values ($1, $2, 'salla', $3, 'Linked product', 1299, 999, 'SAR', true, 'available', false, true, now(), case when $4 then now() end)`,
    [id, storeId, `ext-${id}`, deleted],
  );
  return id;
}

/** Product links have one writer (ContentLifecycle); fixtures link through it too. */
const link = (storeId: string, contentId: string, productId: string) =>
  withStoreContext(app, storeId, (tx) => lifecycle.edit(tx, storeId, contentId, { product_id: productId }));

interface ItemOptions {
  status?: string;
  format?: 'story' | 'reel';
  home?: boolean;
  slides?: number;
  assetStatus?: string;
  publishedAt?: Date;
  deleted?: boolean;
  productId?: string;
  ctaUrl?: string;
  /** More slides after the regular ones, with assets in these statuses. */
  extraAssets?: string[];
  /** Slide asset kind (default video) and, optionally, the renditions its assets have. */
  kind?: 'image' | 'video';
  profiles?: string[];
}

/** Slides have one writer (ContentLifecycle); fixtures save them through it, with the asset kinds and statuses. */
async function saveSlides(storeId: string, contentId: string, assets: ReadonlyArray<{ id: string; status: string }>, kind: 'image' | 'video' = 'video') {
  await withStoreContext(app, storeId, (tx) => lifecycle.edit(tx, storeId, contentId, {
    slides: assets.map((a) => ({ media_asset_id: a.id, alt_text: kind === 'image' ? 'Fixture image' : null })),
  }, new Date(), new Map(assets.map((a) => [a.id, { kind, status: a.status as 'processed' }]))));
}

/**
 * A content item fixture: created as a draft, its placement, slides and product link saved, then its status and
 * timestamps set directly (status writes are fixture seeding here, not an application path).
 */
async function item(storeId: string, o: ItemOptions = {}) {
  const id = randomUUID();
  const status = o.status ?? 'published';
  await admin.query(
    `insert into content_items (id, store_id, title, format, cta_label, cta_action, cta_url, cta_style, status)
     values ($1, $2, $3, $4, 'Shop', $5, $6, 'light', 'draft')`,
    [id, storeId, `Item ${id.slice(0, 8)}`, o.format ?? 'story', o.ctaUrl ? 'open_link' : 'open_product', o.ctaUrl ?? null],
  );
  if (o.home ?? true) await admin.query(`insert into placements (store_id, content_id, type) values ($1, $2, 'home')`, [storeId, id]);
  const wanted = [...Array.from({ length: o.slides ?? 1 }, () => o.assetStatus ?? 'processed'), ...(o.extraAssets ?? [])];
  const assets: Array<{ id: string; status: string }> = [];
  // A failed asset can not be attached: attach it while scanned, then let it fail.
  for (const status of wanted) assets.push({ id: await processedAsset(storeId, o.kind ?? 'video', status === 'failed' ? 'scanned' : status, o.profiles), status: status === 'failed' ? 'scanned' : status });
  if (assets.length > 0) await saveSlides(storeId, id, assets, o.kind);
  for (const [i, status] of wanted.entries()) {
    if (status === 'failed') await admin.query(`update media_assets set status = 'failed', failure_reason = 'processing_failed' where id = $1`, [assets[i]!.id]);
  }
  if (o.productId) await link(storeId, id, o.productId);
  await admin.query(
    `update content_items set status = $2, archived_from = case when $2 = 'archived' then 'published' end, reactivate_to = case when $2 = 'deactivated' then 'published' end,
       first_published_at = $3, deleted_at = case when $4 then now() end where id = $1`,
    [id, status, o.publishedAt ?? (status === 'published' ? new Date() : null), o.deleted ?? false],
  );
  return id;
}

const row = async (storeId: string) =>
  (await admin.query<{ revision: string; manifest: StoreManifest | null; size_gzip_bytes: number | null; compiled_at: Date | null }>('select revision::text as revision, manifest, size_gzip_bytes, compiled_at from store_manifests where store_id = $1', [storeId])).rows[0];

const compileJobs = async (storeId: string) =>
  (await admin.query<{ id: string; data: Record<string, unknown> }>(`select id, data from ${SCHEMA}.job where name = $1 and singleton_key = $2 order by created_on, id`, [MANIFEST_COMPILE_QUEUE, storeId])).rows;

/** Deliver every queued domain event of the store (as the worker's `events.dispatch` job would). */
async function deliverEvents(storeId: string, only?: EventName) {
  const { rows } = await admin.query<{ id: string; data: EventEnvelope }>(
    `select id, data from ${SCHEMA}.job where name = $1 and data->>'store_id' = $2 and ($3::text is null or data->>'name' = $3) order by created_on, id`,
    [EVENT_QUEUE, storeId, only ?? null],
  );
  for (const r of rows) await dispatch(r.data, { id: r.id, data: r.data });
  return rows.length;
}

const PRODUCT_INPUTS: ReadonlySet<EventName> = new Set(['catalog.product.updated', 'catalog.product.deleted']);

/** Drop the store's queued events and compile jobs (fixture writes emit their own). */
async function clearQueued(storeId: string) {
  await admin.query(`delete from ${SCHEMA}.job where name = $1 and singleton_key = $2`, [MANIFEST_COMPILE_QUEUE, storeId]);
  await admin.query(`delete from ${SCHEMA}.job where name = $1 and data->>'store_id' = $2`, [EVENT_QUEUE, storeId]);
}

/** A product linked to one non-deleted (draft) content item, with the fixture's own events and jobs cleared. */
async function linkedProduct(storeId: string) {
  const productId = await product(storeId);
  await item(storeId, { productId, status: 'draft' });
  await clearQueued(storeId);
  return productId;
}

const runCompileJob = (data: unknown) => publishingJobHandlers(app, compiler)[MANIFEST_COMPILE_QUEUE]!(data, { id: 'job', data });

function payloadFor(name: EventName, storeId: string, productId?: string): EventPayload<EventName> {
  const id = productId ?? randomUUID();
  const transition = { v: 1, store_id: storeId, content_id: id, from: 'draft', to: 'published' } as const;
  const lifecycleEvent = { v: 1, store_id: storeId, install_epoch: 1 } as const;
  const payloads: Partial<Record<EventName, EventPayload<EventName>>> = {
    'content.item.deleted': { v: 1, store_id: storeId, content_id: id, from: 'published' },
    'content.item.edited': { v: 1, store_id: storeId, content_id: id, status: 'published', changed: ['title'] },
    'media.asset.processed': { v: 1, store_id: storeId, asset_id: id, kind: 'video' },
    'media.asset.failed': { v: 1, store_id: storeId, asset_id: id, reason: 'processing_failed' },
    'catalog.product.updated': { v: 1, store_id: storeId, product_id: id, external_id: 'ext', changed: ['name'], name: 'P', image_url: null, price_minor: 1, sale_price_minor: null, currency: 'SAR', availability: 'available', has_required_options: false, visible: true },
    'catalog.product.deleted': { v: 1, store_id: storeId, product_id: id, external_id: 'ext' },
    'catalog.sync.completed': { v: 1, store_id: storeId, run_id: id, created: 0, updated: 0, finished_at: new Date().toISOString() },
    'integration.store.disconnected': { ...lifecycleEvent, reason: 'refresh_rejected' },
    'integration.store.uninstalled': { ...lifecycleEvent, grace_ends_at: new Date().toISOString() },
  };
  if (payloads[name]) return payloads[name];
  return name.startsWith('content.') ? transition : lifecycleEvent;
}

describe('MANIFEST_INPUTS triggers through the transactional outbox', () => {
  it.each(MANIFEST_INPUTS)('%s: a committed trigger leaves exactly one compile job for its store; a rolled-back one leaves none', async (name) => {
    // Product events compile only for a product linked to live content (Story 4.6): link one first.
    const gated = PRODUCT_INPUTS.has(name);
    const committed = gated ? await store() : randomUUID();
    const productId = gated ? await linkedProduct(committed) : undefined;
    await withStoreContext(app, committed, (tx) => publishEvent(tx, boss, telemetry, name, payloadFor(name, committed, productId) as never));
    expect(await deliverEvents(committed, name)).toBe(1);
    const jobs = await compileJobs(committed);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.data).toMatchObject({ v: 1, store_id: committed });
    // Redelivering the same event never queues a second compile (delivery ledger).
    await deliverEvents(committed, name);
    expect(await compileJobs(committed)).toHaveLength(1);

    const rolledBack = gated ? await store() : randomUUID();
    const rolledBackProduct = gated ? await linkedProduct(rolledBack) : undefined;
    await expect(withStoreContext(app, rolledBack, async (tx) => {
      await publishEvent(tx, boss, telemetry, name, payloadFor(name, rolledBack, rolledBackProduct) as never);
      throw new Error('roll back the trigger');
    })).rejects.toThrow('roll back the trigger');
    expect(await deliverEvents(rolledBack, name)).toBe(0);
    expect(await compileJobs(rolledBack)).toHaveLength(0);
  });

  it.each([...PRODUCT_INPUTS])('%s: enqueues only for a product linked to non-deleted content (unlinked and deleted-only links skip)', async (name) => {
    const storeId = await store();
    const linked = await linkedProduct(storeId);
    const unlinked = await product(storeId);
    const deletedOnly = await product(storeId);
    await item(storeId, { productId: deletedOnly, deleted: true });
    await clearQueued(storeId);
    for (const productId of [unlinked, deletedOnly]) {
      await withStoreContext(app, storeId, (tx) => publishEvent(tx, boss, telemetry, name, payloadFor(name, storeId, productId) as never));
    }
    expect(await deliverEvents(storeId, name)).toBe(2);
    expect(await compileJobs(storeId)).toHaveLength(0);
    await withStoreContext(app, storeId, (tx) => publishEvent(tx, boss, telemetry, name, payloadFor(name, storeId, linked) as never));
    await deliverEvents(storeId, name);
    expect(await compileJobs(storeId)).toHaveLength(1);
  });

  it('enqueues on the delivery transaction: a rolled-back delivery leaves no compile job', async () => {
    const storeId = randomUUID();
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      expect(await enqueueManifestCompile(boss, client, telemetry, storeId, new Date().toISOString())).toBeTruthy();
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    expect(await compileJobs(storeId)).toHaveLength(0);
  });

  it('publish: a published Home Story enqueues a compile whose manifest lists it with public rendition URLs and the product snapshot', async () => {
    const storeId = await store();
    const productId = await product(storeId);
    const asset = await processedAsset(storeId);
    const created = await withStoreContext(app, storeId, (tx) => lifecycle.create(tx, storeId, {
      title: 'Ring story', format: 'story', cta_label: 'Buy', cta_action: 'add_to_cart', placements: [{ type: 'home' }],
      slides: [{ media_asset_id: asset, alt_text: null }],
    }, new Date(), new Map([[asset, { kind: 'video', status: 'processed' }]])));
    await link(storeId, created.id, productId);
    await deliverEvents(storeId);
    await admin.query(`delete from ${SCHEMA}.job where name = $1 and singleton_key = $2`, [MANIFEST_COMPILE_QUEUE, storeId]);
    await admin.query(`delete from ${SCHEMA}.job where name = $1 and data->>'store_id' = $2`, [EVENT_QUEUE, storeId]);
    await withStoreContext(app, storeId, (tx) => lifecycle.apply(tx, storeId, created.id, 'publish'));
    expect(await deliverEvents(storeId)).toBe(1);
    const [job] = await compileJobs(storeId);
    expect(job).toBeDefined();
    await runCompileJob(job!.data);
    const saved = await row(storeId);
    expect(saved?.revision).toBe('1');
    const manifest = StoreManifest.parse(saved!.manifest);
    expect(manifest.placements).toEqual([{ type: 'home', layout: 'ring', item_ids: [created.id] }]);
    expect(manifest.items).toHaveLength(1);
    const listed = manifest.items[0]!;
    expect(listed).toMatchObject({ id: created.id, title: 'Ring story', format: 'story', cta_label: 'Buy', cta_action: 'add_to_cart', product: { id: productId, name: 'Linked product', price_minor: 1299, sale_price_minor: 999, deleted: false } });
    const slide = listed.slides[0]!;
    expect(slide.status).toBe('processed');
    expect(slide.renditions.map((r) => r.profile)).toEqual(['480p', '720p', '1080p']);
    const urls = [slide.source_url, slide.poster_url, ...slide.renditions.map((r) => r.url)];
    for (const url of urls) expect(url).toMatch(new RegExp(`^${MEDIA_BASE}/stores/${storeId}/assets/${asset}/[0-9a-f]{64}/renditions/(480p|720p|1080p)\\.mp4$|^${MEDIA_BASE}/stores/${storeId}/assets/${asset}/[0-9a-f]{64}/renditions/poster\\.webp$`));
    expect(JSON.stringify(manifest)).not.toMatch(/\/v1\/media|uploads\/|inspected|external\.example/);
    expect(saved!.size_gzip_bytes).toBeGreaterThan(0);
    expect(saved!.compiled_at).toBeInstanceOf(Date);
  });
});

describe('store manifest selection', () => {
  it('omits every ineligible item and lists only live Home Stories with processed media and a live product', async () => {
    const storeId = await store();
    const listed = await item(storeId);
    const liveProduct = await item(storeId, { productId: await product(storeId) });
    const ineligible = [
      ...(await Promise.all(['draft', 'processing', 'failed', 'scheduled', 'ended', 'archived', 'deactivated'].map((status) => item(storeId, { status })))),
      await item(storeId, { deleted: true }),
      await item(storeId, { format: 'reel' }),
      await item(storeId, { home: false }),
      await item(storeId, { slides: 0 }),
      await item(storeId, { assetStatus: 'scanned' }),
      await item(storeId, { assetStatus: 'failed' }),
      await item(storeId, { productId: await product(storeId, true) }),
      // Processed, but nothing playable to show: a video with only a poster, an image without its web rendition.
      await item(storeId, { profiles: ['poster'] }),
      await item(storeId, { kind: 'image', profiles: [] }),
    ];
    // A linked product the catalog no longer has at all (not even a tombstone) withholds the item too.
    const vanished = await product(storeId);
    ineligible.push(await item(storeId, { productId: vanished }));
    await admin.query('delete from products where id = $1', [vanished]);
    // One pending slide among processed ones still withholds the item.
    ineligible.push(await item(storeId, { slides: 2, extraAssets: ['uploaded'] }));
    await compiler.compile(storeId);
    const manifest = StoreManifest.parse((await row(storeId))!.manifest);
    expect(new Set(manifest.items.map((i) => i.id))).toEqual(new Set([listed, liveProduct]));
    expect(manifest.placements[0]!.item_ids.sort()).toEqual([listed, liveProduct].sort());
    for (const id of ineligible) expect(JSON.stringify(manifest)).not.toContain(id);
  });

  it('withholds an item whose linked product is hidden in the platform and restores it when unhidden (Story 4.6)', async () => {
    const storeId = await store();
    const productId = await product(storeId);
    const id = await item(storeId, { productId });
    await admin.query('update products set visible = false where id = $1', [productId]);
    await compiler.compile(storeId);
    expect(StoreManifest.parse((await row(storeId))!.manifest).items).toEqual([]);
    await admin.query('update products set visible = true where id = $1', [productId]);
    await compiler.compile(storeId);
    expect(StoreManifest.parse((await row(storeId))!.manifest).items.map((i) => i.id)).toEqual([id]);
  });

  it('caps at the 10 newest by first_published_at (then id) and withdraws an archived or deleted item on the next compile', async () => {
    const storeId = await store();
    const base = Date.parse('2026-01-01T00:00:00Z');
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) ids.push(await item(storeId, { publishedAt: new Date(base + i * 60_000) }));
    const first = await compiler.compile(storeId);
    expect(first).toMatchObject({ outcome: 'compiled', revision: 1, items: 10 });
    let manifest = StoreManifest.parse((await row(storeId))!.manifest);
    const newest = [...ids].reverse().slice(0, 10);
    expect(manifest.placements).toEqual([{ type: 'home', layout: 'ring', item_ids: newest }]);
    expect(manifest.items.map((i) => i.id)).toEqual(newest);
    await admin.query(`update content_items set status = 'archived', archived_from = 'published' where id = $1`, [ids[11]]);
    await admin.query(`update content_items set deleted_at = now() where id = $1`, [ids[10]]);
    expect(await compiler.compile(storeId)).toMatchObject({ revision: 2, items: 10 });
    manifest = StoreManifest.parse((await row(storeId))!.manifest);
    expect(manifest.placements[0]!.item_ids).toEqual([...ids].reverse().slice(2, 12));
  });

  it('orders items with the same first publication by id, newest id first', async () => {
    const storeId = await store();
    const at = new Date('2026-02-01T00:00:00Z');
    const ids = [await item(storeId, { publishedAt: at }), await item(storeId, { publishedAt: at }), await item(storeId, { publishedAt: at })];
    await compiler.compile(storeId);
    expect(StoreManifest.parse((await row(storeId))!.manifest).placements[0]!.item_ids).toEqual([...ids].sort().reverse());
  });
});

describe('store manifest media', () => {
  it('links a processed image slide to its public web rendition only', async () => {
    const storeId = await store();
    const id = await item(storeId, { kind: 'image' });
    await compiler.compile(storeId);
    const manifest = StoreManifest.parse((await row(storeId))!.manifest);
    const slide = manifest.items.find((i) => i.id === id)!.slides[0]!;
    const { rows } = await admin.query<{ storage_key: string }>(`select storage_key from renditions where asset_id = $1 and profile = 'web'`, [slide.media_asset_id]);
    const url = `${MEDIA_BASE}/${rows[0]!.storage_key}`;
    expect(slide).toMatchObject({ kind: 'image', status: 'processed', source_url: url, poster_url: url });
    expect(slide.renditions).toEqual([{ profile: 'web', url, content_type: 'image/webp', width: 720, height: 1280 }]);
  });
});

describe('store manifest revisions', () => {
  it('burst: five triggers within one window queue at most two compiles; their revisions strictly increase', async () => {
    // Start early in a 10 s slot so the burst cannot straddle two slot boundaries.
    const into = Date.now() % 10_000;
    if (into > 5_000) await new Promise((r) => setTimeout(r, 10_000 - into + 50));
    const storeId = await store();
    await item(storeId);
    await admin.query(`delete from ${SCHEMA}.job where name = $1 and data->>'store_id' = $2`, [EVENT_QUEUE, storeId]);
    for (let i = 0; i < 5; i++) {
      await withStoreContext(app, storeId, (tx) => publishEvent(tx, boss, telemetry, 'content.item.edited', { v: 1, store_id: storeId, content_id: randomUUID(), status: 'published', changed: ['title'] }));
    }
    expect(await deliverEvents(storeId)).toBe(5);
    const jobs = await compileJobs(storeId);
    expect(jobs.length).toBeGreaterThanOrEqual(1);
    expect(jobs.length).toBeLessThanOrEqual(2);
    const revisions: number[] = [];
    for (const job of jobs) {
      await runCompileJob(job.data);
      revisions.push(Number((await row(storeId))!.revision));
    }
    expect(revisions).toEqual(revisions.map((_, i) => i + 1));
    // The slot alignment above can wait up to 5 s, the default test timeout.
  }, 20_000);

  it('race: concurrent compiles serialize on the row lock; each commits previous + 1 and the newest inputs hold the highest revision', async () => {
    const storeId = await store();
    const listed = await item(storeId);
    await compiler.compile(storeId);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const slow = new StoreManifestCompiler(app, {
      getStoreManifestCandidates: async (id: string) => {
        const candidates = await content.getStoreManifestCandidates(id);
        if (calls++ === 0) await gate;
        return candidates;
      },
    }, catalog, media, integration, telemetry, boss);
    const older = slow.compile(storeId);
    await vi.waitFor(() => expect(calls).toBe(1));
    // The item is withdrawn while the first compile holds the lock with its (now stale) inputs.
    await admin.query(`update content_items set status = 'archived', archived_from = 'published' where id = $1`, [listed]);
    const newer = slow.compile(storeId);
    await new Promise((r) => setTimeout(r, 150));
    expect(calls).toBe(1); // the second compile waits on the row lock before reading anything
    release();
    const [a, b] = await Promise.all([older, newer]);
    expect(a).toMatchObject({ revision: 2, items: 1 });
    expect(b).toMatchObject({ revision: 3, items: 0 });
    const saved = await row(storeId);
    expect(saved?.revision).toBe('3');
    expect(StoreManifest.parse(saved!.manifest).items).toEqual([]);
  });
});

describe('store lifecycle', () => {
  it('disconnected: no write, the last manifest is kept', async () => {
    const fresh = await store('disconnected');
    await item(fresh);
    expect(await compiler.compile(fresh)).toEqual({ outcome: 'skipped_disconnected' });
    expect(await row(fresh)).toBeUndefined();
    const storeId = await store();
    await item(storeId);
    await compiler.compile(storeId);
    const before = await row(storeId);
    await admin.query(`update stores set lifecycle_state = 'disconnected' where id = $1`, [storeId]);
    await item(storeId);
    expect(await compiler.compile(storeId)).toEqual({ outcome: 'skipped_disconnected' });
    expect(await row(storeId)).toEqual(before);
  });

  it('uninstalled: an empty manifest (no placements, no items) at the next revision', async () => {
    const storeId = await store();
    await item(storeId);
    await compiler.compile(storeId);
    await admin.query(`update stores set lifecycle_state = 'uninstalled' where id = $1`, [storeId]);
    expect(await compiler.compile(storeId)).toMatchObject({ outcome: 'emptied', revision: 2, items: 0 });
    expect(StoreManifest.parse((await row(storeId))!.manifest)).toEqual({ v: 1, store_id: storeId, placements: [], items: [] });
  });

  it('purged: the compile after the purge deletes the row and never recreates it', async () => {
    const storeId = await store();
    await item(storeId);
    await compiler.compile(storeId);
    await admin.query(`update stores set lifecycle_state = 'purged' where id = $1`, [storeId]);
    expect(await compiler.compile(storeId)).toEqual({ outcome: 'removed' });
    expect(await row(storeId)).toBeUndefined();
    expect(await compiler.compile(storeId)).toEqual({ outcome: 'removed' });
    expect(await row(storeId)).toBeUndefined();
  });

  it('unknown store: no row is written', async () => {
    const storeId = randomUUID();
    expect(await compiler.compile(storeId)).toEqual({ outcome: 'removed' });
    expect(await row(storeId)).toBeUndefined();
  });

  it('the store purge deletes the row and the export skips derived manifests', async () => {
    const storeId = await store();
    await item(storeId);
    await compiler.compile(storeId);
    expect(await withStoreContext(app, storeId, (tx) => publishingStoreData.export!({ storeId, installEpoch: 1, tx }))).toBeUndefined();
    expect(await withStoreContext(app, storeId, (tx) => publishingStoreData.purge({ storeId, installEpoch: 1, tx, batchLimit: 10 }))).toEqual({ done: true });
    expect(await row(storeId)).toBeUndefined();
  });

  it('isolation: the app role reads and writes only its own store manifest row', async () => {
    const a = await store();
    const b = await store();
    await item(b);
    await compiler.compile(b);
    await compiler.compile(a);
    const seen = await withStoreContext(app, a, async (tx) => (await tx.query<{ store_id: string }>('select store_id::text as store_id from store_manifests')).rows);
    expect(seen).toEqual([{ store_id: a }]);
    const updated = await withStoreContext(app, a, async (tx) => (await tx.query('update store_manifests set revision = 99 where store_id = $1', [b])).rowCount);
    expect(updated).toBe(0);
    expect((await row(b))!.revision).toBe('1');
  });
});

describe('store manifest CTA and metrics', () => {
  it('drops an open-link CTA no longer on a synced domain (fields null, warning metric with the content id) and keeps the item', async () => {
    const storeId = await store('active', [SHOP]);
    const kept = await item(storeId, { ctaUrl: `https://www.${SHOP}/sale` });
    const dropped = await item(storeId, { ctaUrl: 'https://old-domain.example.net/sale' });
    const counter = vi.spyOn(telemetry, 'counter');
    const warn = vi.spyOn(telemetry.log, 'warn');
    await compiler.compile(storeId);
    const manifest = StoreManifest.parse((await row(storeId))!.manifest);
    expect(manifest.items.find((i) => i.id === kept)).toMatchObject({ cta_label: 'Shop', cta_action: 'open_link', cta_url: `https://www.${SHOP}/sale`, cta_style: 'light' });
    expect(manifest.items.find((i) => i.id === dropped)).toMatchObject({ cta_label: null, cta_action: null, cta_url: null, cta_style: 'light' });
    expect(counter.mock.calls.filter(([name]) => name === Metric.ManifestCtaDropped)).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('cta dropped'), expect.objectContaining({ store_id: storeId, content_id: dropped }));
  });

  it('records the gzip size and the lag from the triggering event, and warns above the 15 KB budget', async () => {
    const storeId = await store();
    for (let i = 0; i < 10; i++) await item(storeId, { slides: 10 });
    const observe = vi.spyOn(telemetry, 'observe');
    const counter = vi.spyOn(telemetry, 'counter');
    const warn = vi.spyOn(telemetry.log, 'warn');
    const result = await compiler.compile(storeId, { occurredAt: new Date(Date.now() - 5_000) });
    expect(result.outcome).toBe('compiled');
    const saved = await row(storeId);
    expect(saved!.size_gzip_bytes).toBeGreaterThan(MANIFEST_GZIP_WARN_BYTES);
    expect(observe).toHaveBeenCalledWith(Metric.ManifestSizeGzipKilobytes, saved!.size_gzip_bytes! / 1024);
    const lag = observe.mock.calls.find(([name]) => name === Metric.ManifestCompileLag);
    expect(lag?.[1]).toBeGreaterThanOrEqual(5);
    expect(counter).toHaveBeenCalledWith(Metric.ManifestOversize);
    expect(warn).toHaveBeenCalledWith('store manifest above gzip budget', expect.objectContaining({ store_id: storeId, size_gzip_bytes: saved!.size_gzip_bytes }));

    const small = await store();
    await item(small);
    observe.mockClear();
    counter.mockClear();
    await compiler.compile(small);
    expect(observe.mock.calls.some(([name]) => name === Metric.ManifestSizeGzipKilobytes)).toBe(true);
    expect(counter.mock.calls.some(([name]) => name === Metric.ManifestOversize)).toBe(false);
  });
});

describe('compile lag from the triggering event', () => {
  it('carries the envelope occurred_at from dispatch through the job to the lag metric', async () => {
    const storeId = await store();
    await item(storeId);
    await admin.query(`delete from ${SCHEMA}.job where name in ($1, $2) and (singleton_key = $3 or data->>'store_id' = $3)`, [EVENT_QUEUE, MANIFEST_COMPILE_QUEUE, storeId]);
    const occurredAt = new Date(Date.now() - 7_000).toISOString();
    const envelope: EventEnvelope = {
      v: 1, trace_id: 'lag-test', store_id: storeId, event_id: randomUUID(), name: 'content.item.edited', occurred_at: occurredAt,
      payload: { v: 1, store_id: storeId, content_id: randomUUID(), status: 'published', changed: ['title'] },
    };
    await dispatch(envelope, { id: envelope.event_id, data: envelope });
    const [job] = await compileJobs(storeId);
    expect(job?.data.occurred_at).toBe(occurredAt);
    const observe = vi.spyOn(telemetry, 'observe');
    await runCompileJob(job!.data);
    const lag = observe.mock.calls.find(([name]) => name === Metric.ManifestCompileLag);
    expect(lag?.[1]).toBeGreaterThanOrEqual(7);
    observe.mockRestore();
  });

  it('records no lag for a compile that wrote nothing', async () => {
    const storeId = await store('disconnected');
    const observe = vi.spyOn(telemetry, 'observe');
    expect(await compiler.compile(storeId, { occurredAt: new Date(Date.now() - 3_000) })).toEqual({ outcome: 'skipped_disconnected' });
    expect(observe.mock.calls.some(([name]) => name === Metric.ManifestCompileLag)).toBe(false);
    expect(await row(storeId)).toBeUndefined();
    observe.mockRestore();
  });
});

describe('one compiler for preview and store manifests', () => {
  it('the same item previewed and compiled for the store both validate as StoreManifest v1 with the same shape', async () => {
    const storeId = await store();
    const id = await item(storeId, { productId: await product(storeId) });
    const preview = StoreManifest.parse(await new PublishingService(content, catalog, media).previewContent(storeId, id));
    await compiler.compile(storeId);
    const compiled = StoreManifest.parse((await row(storeId))!.manifest);
    expect(preview.placements).toEqual(compiled.placements);
    const strip = (m: StoreManifest) => m.items.map((i) => ({ ...i, slides: i.slides.map((s) => ({ id: s.id, media_asset_id: s.media_asset_id, kind: s.kind, status: s.status, profiles: s.renditions.map((r) => r.profile) })) }));
    expect(strip(preview)).toEqual(strip(compiled));
    // Only the URL resolution differs: authenticated preview routes versus public immutable rendition URLs.
    expect(preview.items[0]!.slides[0]!.source_url).toMatch(/^\/v1\/media\//);
    expect(compiled.items[0]!.slides[0]!.source_url).toMatch(new RegExp(`^${MEDIA_BASE}/`));
  });
});
