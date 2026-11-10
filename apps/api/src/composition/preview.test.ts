import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { CONTENT_STATUSES, StoreManifest, type MediaAssetStatus, type MediaKind, type RenditionProfile } from '@slips/contracts';
import { ensureTestAppRole, runMigrations, withStoreContext } from '@slips/db';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MemoryObjectStorage } from '../adapters/storage/memory-storage.js';
import { PinoTelemetry } from '../adapters/telemetry/pino-telemetry.js';
import { createHttpApp } from '../http.js';
import { ContentLifecycle } from '../modules/content/content-lifecycle.js';
import { SessionService } from '../modules/session/session.service.js';

const adminUrl = process.env.PREVIEW_TEST_DATABASE_URL ?? 'postgres://slips:slips@127.0.0.1:5433/slips';
const appUrl = new URL(adminUrl);
appUrl.username = 'slips_it_preview_comp';
appUrl.password = 'it_preview_comp_pw';
const admin = new pg.Pool({ connectionString: adminUrl });
const storage = new MemoryObjectStorage();
const send = vi.fn(async () => { throw new Error('Preview must not emit events'); });
const telemetry = new PinoTelemetry({ role: 'http', level: 'silent' });
// Fixture writes use the owner lifecycle and a separate sender; application reads retain the throwing spy.
const fixtureLifecycle = new ContentLifecycle({ send: async () => null }, telemetry);
let fixturePool: pg.Pool;
let nest: INestApplication;
let base: string;

beforeAll(async () => {
  await runMigrations(admin);
  await ensureTestAppRole(admin, appUrl.username, appUrl.password);
  fixturePool = new pg.Pool({ connectionString: appUrl.href });
  nest = await createHttpApp({ LOG_LEVEL: 'silent', CORS_ORIGINS: 'http://localhost:3000' }, {
    pool: new pg.Pool({ connectionString: appUrl.href }), storage, events: { send },
    telemetry,
    session: { secret: randomBytes(32), secureCookies: true, embeddedTtlMs: 900_000, directMaxAgeMs: 3_600_000, idleMs: 3_600_000 },
  });
  await nest.listen(0);
  base = await nest.getUrl();
});

afterAll(async () => { await nest?.close(); await fixturePool?.end(); await admin.end(); });

async function merchant() {
  const storeId = randomUUID();
  await admin.query(`insert into stores (id, store_id, platform, platform_store_id, name, synced_domains) values ($1, $1, 'salla', $2, 'Preview Store', '{shop.example.com}')`, [storeId, `preview-${storeId}`]);
  return { storeId, token: (await nest.get(SessionService).create(storeId, 'embedded')).token };
}

async function item(storeId: string, status = 'draft') {
  const id = randomUUID();
  await admin.query(`insert into content_items (id, store_id, title, format, cta_label, cta_action, cta_style, status) values ($1, $2, 'Saved preview', 'story', 'Shop', 'open_product', 'light', $3)`, [id, storeId, status]);
  return id;
}

async function asset(storeId: string, status: MediaAssetStatus, kind: MediaKind = 'video') {
  const id = randomUUID();
  const raw = `stores/${storeId}/uploads/${id}`;
  const clean = `stores/${storeId}/assets/${id}/inspected`;
  const bytes = Buffer.from(`sanitized-${id}`);
  await storage.put(raw, Buffer.from('UNINSPECTED'), 'video/mp4');
  await storage.put(clean, bytes, kind === 'image' ? 'image/png' : 'video/mp4');
  await admin.query(`insert into media_assets (id, store_id, kind, status, content_type, size_bytes, upload_key, storage_key, source_url, failure_reason, sha256)
    values ($1, $2, $3, $4, $5, $6, $7, $8, 'https://external.example/unsafe', case when $4 = 'failed' then 'malware' end, repeat('a', 64))`,
  [id, storeId, kind, status, kind === 'image' ? 'image/png' : 'video/mp4', bytes.length, raw, ['scanned', 'processed', 'failed'].includes(status) ? clean : null]);
  return { id, raw, clean, bytes, kind, status };
}

async function rendition(storeId: string, assetId: string, profile: RenditionProfile) {
  const bytes = Buffer.from(`${profile}-${assetId}`);
  const key = `stores/${storeId}/assets/${assetId}/${profile}`;
  const type = ['poster', 'web'].includes(profile) ? 'image/webp' : 'video/mp4';
  await storage.put(key, bytes, type);
  await admin.query(`insert into renditions (store_id, asset_id, profile, content_type, width, height, size_bytes, sha256, storage_key) values ($1, $2, $3, $4, 720, 1280, $5, $6, $7)`, [storeId, assetId, profile, type, bytes.length, 'a'.repeat(64), key]);
  return { bytes, key, type };
}

async function saveSlides(storeId: string, contentId: string, assets: readonly { id: string; kind: MediaKind; status: MediaAssetStatus }[]) {
  return withStoreContext(fixturePool, storeId, async (tx) => {
    await fixtureLifecycle.edit(tx, storeId, contentId, {
      slides: assets.map((a) => ({ media_asset_id: a.id, alt_text: 'Saved alt text' })),
    }, new Date(), new Map(assets.map((a) => [a.id, { kind: a.kind, status: a.status }])));
    return (await tx.query<{ id: string }>('select id from slides where store_id = $1 and content_id = $2 and deleted_at is null order by position', [storeId, contentId])).rows.map((s) => s.id);
  });
}

const get = (path: string, token?: string) => fetch(`${base}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
async function preview(id: string, token: string) {
  const res = await get(`/v1/preview/content/${id}`, token);
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('private, no-store');
  return StoreManifest.parse(await res.json());
}

describe('saved content preview over HTTP with forced RLS', () => {
  it('preserves a saved open-link destination and normalizes a legacy CTA style to null', async () => {
    const m = await merchant();
    const destination = 'https://shop.example.com/collections/summer?ref=preview';
    const saved = await withStoreContext(fixturePool, m.storeId, (tx) => fixtureLifecycle.create(tx, m.storeId, {
      title: 'Saved open link', format: 'story', cta_label: 'Explore', cta_action: 'open_link', cta_url: destination,
    }));
    await admin.query(`update content_items set cta_style = 'brand-blue' where id = $1`, [saved.id]);
    expect((await preview(saved.id, m.token)).items[0]).toMatchObject({
      id: saved.id, cta_action: 'open_link', cta_url: destination, cta_style: null,
    });
  });

  it('authenticates direct-session cookies on manifest and byte routes and rejects expired direct sessions', async () => {
    const m = await merchant();
    const id = await item(m.storeId);
    const media = await asset(m.storeId, 'processed');
    const video = await rendition(m.storeId, media.id, '720p');
    const paths = [`/v1/preview/content/${id}`, `/v1/media/${media.id}/source`, `/v1/media/${media.id}/renditions/720p`];
    const sessions = nest.get(SessionService);
    const direct = await sessions.create(m.storeId, 'direct');
    const cookie = sessions.cookieFor(direct.token).split(';')[0]!;
    for (const [index, path] of paths.entries()) {
      const res = await fetch(`${base}${path}`, { headers: { cookie } });
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('private, no-store');
      if (index === 0) expect(StoreManifest.parse(await res.json()).items[0]!.id).toBe(id);
      else expect(Buffer.from(await res.arrayBuffer())).toEqual(index === 1 ? media.bytes : video.bytes);
    }
    // Separate credentials let each route exercise the expired-session outcome before its row is removed.
    const expiring = await Promise.all(paths.map(() => sessions.create(m.storeId, 'direct')));
    const clock = sessions.now;
    try {
      sessions.now = () => Math.max(...expiring.map((s) => s.session.expiresAt.getTime())) + 1;
      for (const [index, path] of paths.entries()) {
        const expiredCookie = sessions.cookieFor(expiring[index]!.token).split(';')[0]!;
        const res = await fetch(`${base}${path}`, { headers: { cookie: expiredCookie } });
        expect(res.status).toBe(401);
        expect(await res.json()).toMatchObject({ code: 'session_expired' });
        expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/);
      }
    } finally {
      sessions.now = clock;
    }
  });

  it('serves exactly one ordered item, current product snapshot, rendition descriptors and authenticated bytes', async () => {
    const m = await merchant();
    const id = await item(m.storeId);
    await item(m.storeId);
    const image = await asset(m.storeId, 'processed', 'image');
    const video = await asset(m.storeId, 'processed');
    const img = await rendition(m.storeId, image.id, 'web');
    const videos = new Map<RenditionProfile, Awaited<ReturnType<typeof rendition>>>();
    for (const profile of ['1080p', 'poster', '480p', '720p'] as const) videos.set(profile, await rendition(m.storeId, video.id, profile));
    await saveSlides(m.storeId, id, [await asset(m.storeId, 'processed'), video, image]);
    const [videoSlide, imageSlide] = await saveSlides(m.storeId, id, [video, image]);
    const productId = randomUUID();
    await admin.query(`insert into products (id, store_id, platform, external_id, name, price_minor, sale_price_minor, currency, tax_inclusive, availability, has_required_options, visible, source_updated_at)
      values ($1, $2, 'salla', 'preview-product', 'Hidden product', 1299, 1099, 'SAR', true, 'low', true, false, now())`, [productId, m.storeId]);
    await withStoreContext(fixturePool, m.storeId, (tx) => fixtureLifecycle.edit(tx, m.storeId, id, { product_id: productId }));
    const manifest = await preview(id, m.token);
    expect(manifest.store_id).toBe(m.storeId);
    expect(manifest.items).toHaveLength(1);
    const compiled = manifest.items[0]!;
    expect(compiled).toMatchObject({ id, title: 'Saved preview', format: 'story', cta_label: 'Shop', cta_action: 'open_product', cta_url: null, cta_style: 'light', product: { id: productId, name: 'Hidden product', price_minor: 1299, sale_price_minor: 1099, currency: 'SAR', availability: 'low', has_required_options: true, deleted: false } });
    expect(compiled.slides.map((s) => s.id)).toEqual([videoSlide, imageSlide]);
    expect(compiled.slides[0]!.renditions.map((r) => r.profile)).toEqual(['480p', '720p', '1080p']);
    expect(compiled.slides[0]!.renditions[0]).toMatchObject({ content_type: 'video/mp4', width: 720, height: 1280 });
    expect(compiled.slides[1]!.renditions.map((r) => r.profile)).toEqual(['web']);
    for (const s of compiled.slides) {
      const expected = s.kind === 'image' ? img : videos.get('480p')!;
      const res = await get(s.source_url!, m.token);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('private, no-store');
      expect(res.headers.get('content-type')).toContain(expected.type);
      expect(Number(res.headers.get('content-length'))).toBe(expected.bytes.length);
      expect(Buffer.from(await res.arrayBuffer())).toEqual(expected.bytes);
      for (const r of s.renditions) {
        const response = await get(r.url, m.token);
        expect(Buffer.from(await response.arrayBuffer())).toEqual(s.kind === 'image' ? img.bytes : videos.get(r.profile)!.bytes);
      }
      const poster = await get(s.poster_url!, m.token);
      expect(Buffer.from(await poster.arrayBuffer())).toEqual(s.kind === 'image' ? img.bytes : videos.get('poster')!.bytes);
    }
    expect(JSON.stringify(manifest)).not.toMatch(/stores\/|external\.example|upload_key|storage_key/);
    await admin.query(`update products set price_minor = 2499, sale_price_minor = null, availability = 'out_of_stock', deleted_at = now() where id = $1`, [productId]);
    // Saved order changes are visible on the next read, including catalog tombstones.
    await saveSlides(m.storeId, id, [image, video]);
    const next = (await preview(id, m.token)).items[0]!;
    expect(next.product).toMatchObject({ price_minor: 2499, sale_price_minor: null, availability: 'out_of_stock', deleted: true });
    expect(next.slides.map((s) => s.id)).toEqual([imageSlide, videoSlide]);
  });

  it('keeps empty drafts valid and unsafe states as placeholders even with rendition rows', async () => {
    const m = await merchant();
    const id = await item(m.storeId);
    expect((await preview(id, m.token)).items[0]).toMatchObject({ product: null, slides: [] });
    const assets: Awaited<ReturnType<typeof asset>>[] = [];
    for (const status of ['importing', 'uploaded', 'failed'] as const) {
      const a = await asset(m.storeId, status);
      assets.push(a);
      await rendition(m.storeId, a.id, 'poster');
      await saveSlides(m.storeId, id, assets);
      for (const path of [`/v1/media/${a.id}/source`, `/v1/media/${a.id}/renditions/poster`]) expect((await get(path, m.token)).status).toBe(404);
    }
    const slides = (await preview(id, m.token)).items[0]!.slides;
    expect(slides.map((s) => s.status)).toEqual(['importing', 'uploaded', 'failed']);
    for (const s of slides) expect(s).toMatchObject({ source_url: null, poster_url: null, renditions: [] });
  });

  it('prefers an available processing poster, otherwise streams only the sanitized inspected source', async () => {
    const m = await merchant();
    const id = await item(m.storeId);
    const source = await asset(m.storeId, 'scanned');
    const posterAsset = await asset(m.storeId, 'scanned');
    const image = await asset(m.storeId, 'scanned', 'image');
    const poster = await rendition(m.storeId, posterAsset.id, 'poster');
    await rendition(m.storeId, posterAsset.id, '720p');
    await saveSlides(m.storeId, id, [source, posterAsset, image]);
    const slides = (await preview(id, m.token)).items[0]!.slides;
    expect(slides[0]).toMatchObject({ source_url: `/v1/media/${source.id}/source`, poster_url: null, renditions: [] });
    expect(slides[1]).toMatchObject({ source_url: `/v1/media/${posterAsset.id}/renditions/poster`, poster_url: `/v1/media/${posterAsset.id}/renditions/poster`, renditions: [] });
    expect(slides[2]!.source_url).toBe(`/v1/media/${image.id}/source`);
    for (const [i, bytes] of [source.bytes, poster.bytes, image.bytes].entries()) {
      const res = await get(slides[i]!.source_url!, m.token);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('private, no-store');
      expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
    }
    expect((await get(`/v1/media/${posterAsset.id}/renditions/720p`, m.token)).status).toBe(404);
    await storage.delete(source.clean);
    expect((await get(`/v1/media/${source.id}/source`, m.token)).status).toBe(404);
    await storage.delete(poster.key);
    expect((await get(`/v1/media/${posterAsset.id}/renditions/poster`, m.token)).status).toBe(404);
    await admin.query(`update media_assets set storage_key = upload_key where id = $1`, [image.id]);
    expect((await get(`/v1/media/${image.id}/source`, m.token)).status).toBe(404);
    expect((await preview(id, m.token)).items[0]!.slides[2]!.source_url).toBeNull();
  });

  it('denies other stores, malformed/missing/deleted IDs, unknown profiles and unauthenticated requests', async () => {
    const a = await merchant();
    const b = await merchant();
    const id = await item(a.storeId);
    const media = await asset(a.storeId, 'processed');
    await rendition(a.storeId, media.id, '720p');
    const paths = [`/v1/preview/content/${id}`, `/v1/media/${media.id}/source`, `/v1/media/${media.id}/renditions/720p`];
    for (const path of paths) {
      expect((await get(path, b.token)).status).toBe(404);
      expect((await get(path)).status).toBe(401);
    }
    for (const bad of ['not-a-uuid', randomUUID()]) {
      for (const path of [`/v1/preview/content/${bad}`, `/v1/media/${bad}/source`, `/v1/media/${bad}/renditions/720p`]) expect((await get(path, a.token)).status).toBe(404);
    }
    for (const profile of ['4k', 'source', 'web', 'upload_key']) expect((await get(`/v1/media/${media.id}/renditions/${profile}`, a.token)).status).toBe(404);
    await admin.query(`update content_items set deleted_at = now() where id = $1`, [id]);
    expect((await get(`/v1/preview/content/${id}`, a.token)).status).toBe(404);
  });

  it('previews every live lifecycle status without changing saved rows or emitting events', async () => {
    const m = await merchant();
    for (const status of CONTENT_STATUSES) {
      const id = await item(m.storeId, status);
      const before = (await admin.query('select * from content_items where id = $1', [id])).rows;
      expect((await preview(id, m.token)).items[0]!.id).toBe(id);
      expect((await admin.query('select * from content_items where id = $1', [id])).rows).toEqual(before);
    }
    expect(send).not.toHaveBeenCalled();
  });
});
