// Story 3.5 and 3.7 composition tests: live Postgres (non-owner RLS role, real pg-boss outbox), in-memory object storage, the
// merchant media API over HTTP, the worker inspection with real file-type/sharp fixtures, and the media purge.
import 'reflect-metadata';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { crc32 as zlibCrc32, deflateSync } from 'node:zlib';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EVENT_QUEUE,
  MEDIA_IMPORT_QUEUE,
  MEDIA_INSPECT_QUEUE,
  MEDIA_PROCESS_QUEUE,
  MEDIA_TOO_LARGE,
  MEDIA_TYPE_NOT_ALLOWED,
  MEDIA_UPLOAD_COMPLETE_GRACE_SECONDS,
  MEDIA_UPLOAD_EXPIRED,
  MEDIA_UPLOAD_MISSING,
  MEDIA_UPLOAD_RATE_LIMITED,
  MEDIA_URL_NOT_ALLOWED,
  MediaAsset,
  MediaUploadGrant,
  type EventEnvelope,
  type MediaKind,
} from '@slips/contracts';
import { ensureTestAppRole, runMigrations, withStoreContext } from '@slips/db';
import { DevMediaProcessor, buildMp4Buffer } from '../adapters/media/dev-media-processor.js';
import { EicarMalwareScanner, EICAR_TEST_STRING } from '../adapters/scanner/eicar-scanner.js';
import { MemoryObjectStorage } from '../adapters/storage/memory-storage.js';
import { PinoTelemetry } from '../adapters/telemetry/pino-telemetry.js';
import { EventHandlerRegistry, eventDispatcher } from '../events/dispatcher.js';
import { uuidv7 } from '../events/outbox.js';
import { grantEventPublishing } from '../events/queue-grants.js';
import { createHttpApp } from '../http.js';
import type { SessionConfig } from '../infra.module.js';
import { MediaImporter } from '../modules/media/media-import.js';
import { MediaInspector } from '../modules/media/media-inspect.js';
import { MediaProcessorRunner } from '../modules/media/media-process.js';
import { mediaStoreData } from '../modules/media/media.lifecycle.js';
import { MediaService } from '../modules/media/media.service.js';
import { SessionService } from '../modules/session/session.service.js';
import { ExternalFetchTransientError, type ExternalFetchResult, type ExternalFetcher } from '../ports/external-fetcher.js';
import type { MediaProcessor } from '../ports/media-processor.js';
import { Metric } from '../ports/telemetry.js';
import { mediaJobHandlers, registerMediaEventHandlers } from '../worker/media-jobs.js';

const ADMIN_URL = 'postgres://slips:slips@127.0.0.1:5433/slips';
const APP_URL = 'postgres://slips_it_media_comp:it_media_comp_pw@127.0.0.1:5433/slips';
const SCHEMA = 'pgboss_media_test';
const MB = 1024 * 1024;

const lines: string[] = [];
const telemetry = new PinoTelemetry({ role: 'http', level: 'debug', stream: { write: (l: string) => void lines.push(l) } });
const storage = new MemoryObjectStorage();
const scanner = new EicarMalwareScanner();

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 4 });
let app: pg.Pool;
let boss: PgBoss;
let nest: INestApplication;
let base: string;
let inspector: MediaInspector;
let importer: MediaImporter;
let processorRunner: MediaProcessorRunner;

/** A fake fetcher (the real one is tested on its own): each link answers what the test registered; others are refused. */
class FakeFetcher implements ExternalFetcher {
  readonly links = new Map<string, () => ExternalFetchResult>();
  readonly calls: Array<{ url: string; maxBytes: number }> = [];
  async fetch(url: string, opts: { maxBytes: number }): Promise<ExternalFetchResult> {
    this.calls.push({ url, maxBytes: opts.maxBytes });
    const answer = this.links.get(url);
    if (!answer) throw new ExternalFetchTransientError('connect ECONNREFUSED');
    return answer();
  }
}
const fetcher = new FakeFetcher();

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const sessionConfig: SessionConfig = { secret: randomBytes(32), secureCookies: true, embeddedTtlMs: 15 * 60_000, directMaxAgeMs: 3_600_000, idleMs: 3_600_000 };

const mediaEvents = async (storeId: string, assetId: string): Promise<EventEnvelope[]> =>
  (
    await admin.query<{ data: EventEnvelope }>(
      `select data from ${SCHEMA}.job where name = $1 and data->>'store_id' = $2 and data->'payload'->>'asset_id' = $3 order by created_on, id`,
      [EVENT_QUEUE, storeId, assetId],
    )
  ).rows.map((r) => r.data);

const assetRow = async (id: string) =>
  (await admin.query<{ status: string; failure_reason: string | null; storage_key: string | null; upload_key: string; size_bytes: string }>('select * from media_assets where id = $1', [id])).rows[0]!;

beforeAll(async () => {
  await runMigrations(admin);
  await ensureTestAppRole(admin, 'slips_it_media_comp', 'it_media_comp_pw');
  app = new pg.Pool({ connectionString: APP_URL, max: 6 });
  await admin.query(`drop schema if exists ${SCHEMA} cascade`);
  boss = new PgBoss({ connectionString: ADMIN_URL, schema: SCHEMA });
  await boss.start();
  await boss.createQueue(EVENT_QUEUE);
  await boss.createQueue(MEDIA_INSPECT_QUEUE);
  await grantEventPublishing(admin, telemetry, EVENT_QUEUE, SCHEMA, 'slips_app');
  await boss.createQueue(MEDIA_IMPORT_QUEUE);
  await boss.createQueue(MEDIA_PROCESS_QUEUE);
  inspector = new MediaInspector(storage, scanner, boss, telemetry);
  importer = new MediaImporter(fetcher, storage, boss, telemetry);
  processorRunner = new MediaProcessorRunner(storage, new DevMediaProcessor(), boss, telemetry, app);
  nest = await createHttpApp(
    { CORS_ORIGINS: 'http://localhost:3000', LOG_LEVEL: 'silent' },
    { pool: new pg.Pool({ connectionString: APP_URL, max: 4 }), events: boss, telemetry, session: sessionConfig, storage, scanner, media: { uploadRateLimit: 60 } },
  );
  await nest.listen(0);
  base = await nest.getUrl();
});

afterAll(async () => {
  await nest?.close();
  await boss?.stop({ graceful: false });
  await admin.query(`drop schema if exists ${SCHEMA} cascade`);
  await app?.end();
  await admin.end();
});

const installedStore = async (): Promise<{ storeId: string; token: string }> => {
  const storeId = randomUUID();
  await admin.query(
    `insert into stores (id, store_id, platform, platform_store_id, name, synced_domains) values ($1, $1, 'salla', $2, 'Media Store', '{shop.example.com}') on conflict do nothing`,
    [storeId, `media-${storeId}`],
  );
  return { storeId, token: (await nest.get(SessionService).create(storeId, 'embedded')).token };
};

const request = async (token: string, method: string, path: string, body?: unknown) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { res, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
};

const issue = async (token: string, kind: MediaKind, contentType: string, bytes: Buffer) => {
  const out = await request(token, 'POST', '/v1/media/uploads', { kind, content_type: contentType, size_bytes: bytes.length, sha256: sha(bytes) });
  expect(out.res.status).toBe(201);
  return MediaUploadGrant.parse(out.body);
};

/** Issue, PUT (as the browser would) and complete; returns the `uploaded` asset. */
const uploadAndComplete = async (token: string, kind: MediaKind, contentType: string, bytes: Buffer) => {
  const grant = await issue(token, kind, contentType, bytes);
  storage.upload(grant.url, bytes, grant.headers['content-type']!);
  const done = await request(token, 'POST', `/v1/media/uploads/${grant.upload_id}/complete`);
  expect(done.res.status).toBe(200);
  return MediaAsset.parse(done.body);
};

/** Inspect, then (as the committed media.asset.scanned/failed handler does) release the upload object. */
const inspect = async (storeId: string, assetId: string, finalAttempt = false) => {
  await withStoreContext(app, storeId, () => inspector.inspect(storeId, assetId, { finalAttempt }));
  await withStoreContext(app, storeId, () => inspector.releaseUpload(assetId));
};

// ---- fixtures, generated in-test ----
const jpegWithGps = () =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: '#c33' } })
    .jpeg()
    .withExif({ IFD0: { Copyright: 'Slips', Make: 'TestCam' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '24/1 42/1 0/1' } })
    .toBuffer();
const png = () => sharp({ create: { width: 8, height: 8, channels: 4, background: '#0f0' } }).png().toBuffer();
const fakeMp4 = (tail: Buffer = Buffer.alloc(64, 1)) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.from([0, 0, 2, 0]), Buffer.from('isommp42'), tail]);
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe('POST /v1/media/uploads', () => {
  it('Issue: image/jpeg 2 MB answers 201 with a PUT URL for stores/{sid}/uploads/{sha}, signed headers and a 15 minute expiry', async () => {
    const { storeId, token } = await installedStore();
    const hash = sha(Buffer.from('two megabytes'));
    const before = Date.now();
    const out = await request(token, 'POST', '/v1/media/uploads', { kind: 'image', content_type: 'image/jpeg', size_bytes: 2 * MB, sha256: hash });
    expect(out.res.status).toBe(201);
    const grant = MediaUploadGrant.parse(out.body);
    expect(grant.method).toBe('PUT');
    expect(grant.url).toContain(`stores/${storeId}/uploads/${hash}`);
    expect(grant.headers).toEqual({ 'content-type': 'image/jpeg', 'x-amz-checksum-sha256': Buffer.from(hash, 'hex').toString('base64') });
    const expires = Date.parse(grant.expires_at);
    expect(expires - before).toBeGreaterThanOrEqual(15 * 60_000 - 1000);
    expect(expires - Date.now()).toBeLessThanOrEqual(15 * 60_000 + 1000);
    const row = (await admin.query('select store_id::text, storage_key, size_bytes::int, completed_asset_id from media_upload_grants where id = $1', [grant.upload_id])).rows[0];
    expect(row).toEqual({ store_id: storeId, storage_key: `stores/${storeId}/uploads/${hash}`, size_bytes: 2 * MB, completed_asset_id: null });
  });

  it('Too big: video 201 MB and image 11 MB answer 422 media-too-large; at the limit is fine', async () => {
    const { token } = await installedStore();
    const hash = 'c'.repeat(64);
    for (const body of [
      { kind: 'video', content_type: 'video/mp4', size_bytes: 201 * MB, sha256: hash },
      { kind: 'image', content_type: 'image/png', size_bytes: 11 * MB, sha256: hash },
    ]) {
      const out = await request(token, 'POST', '/v1/media/uploads', body);
      expect(out.res.status).toBe(422);
      expect(out.body).toMatchObject({ type: MEDIA_TOO_LARGE, code: 'media_too_large' });
    }
    expect((await request(token, 'POST', '/v1/media/uploads', { kind: 'video', content_type: 'video/webm', size_bytes: 200 * MB, sha256: hash })).res.status).toBe(201);
  });

  it('SVG declared (or a type of the other kind) answers 422 media-type-not-allowed; a malformed body 400; no session 401', async () => {
    const { token } = await installedStore();
    const hash = 'd'.repeat(64);
    for (const [kind, type] of [
      ['image', 'image/svg+xml'],
      ['image', 'video/mp4'],
      ['video', 'image/gif'],
    ] as const) {
      const out = await request(token, 'POST', '/v1/media/uploads', { kind, content_type: type, size_bytes: 10, sha256: hash });
      expect(out.res.status).toBe(422);
      expect(out.body).toMatchObject({ type: MEDIA_TYPE_NOT_ALLOWED, code: 'media_type_not_allowed' });
    }
    expect((await request(token, 'POST', '/v1/media/uploads', { kind: 'image', content_type: 'image/png', size_bytes: 10, sha256: 'xyz' })).body).toMatchObject({ code: 'invalid_body' });
    expect((await fetch(`${base}/v1/media/uploads`, { method: 'POST' })).status).toBe(401);
  });

  it('Throttled: the 61st grant in 10 minutes answers 429 with Retry-After, counts the metric and warns with store_id; older grants do not count', async () => {
    const { storeId, token } = await installedStore();
    const hash = 'e'.repeat(64);
    // 11 minutes old: outside the window.
    await admin.query(
      `insert into media_upload_grants (store_id, kind, content_type, size_bytes, sha256, storage_key, expires_at, created_at)
       select $1, 'image', 'image/png', 10, $2, 'k', now(), now() - interval '11 minutes' from generate_series(1, 30)`,
      [storeId, hash],
    );
    // 59 in the window, the oldest 9 minutes ago.
    await admin.query(
      `insert into media_upload_grants (store_id, kind, content_type, size_bytes, sha256, storage_key, expires_at, created_at)
       select $1, 'image', 'image/png', 10, $2, 'k', now(), now() - interval '9 minutes' + (g * interval '1 second') from generate_series(0, 58) g`,
      [storeId, hash],
    );
    const body = { kind: 'image', content_type: 'image/png', size_bytes: 10, sha256: hash };
    expect((await request(token, 'POST', '/v1/media/uploads', body)).res.status).toBe(201);
    const throttledBefore = telemetry.registry.render().match(/slips_media_upload_throttled_total(?:\{\})? (\d+)/)?.[1];
    const limited = await request(token, 'POST', '/v1/media/uploads', body);
    expect(limited.res.status).toBe(429);
    expect(limited.body).toMatchObject({ type: MEDIA_UPLOAD_RATE_LIMITED, code: 'media_upload_rate_limited' });
    const retryAfter = Number(limited.res.headers.get('retry-after'));
    // The 60th most recent grant is the oldest in-window one (9 minutes old): it leaves the window in about 60 s.
    expect(retryAfter).toBeGreaterThanOrEqual(55);
    expect(retryAfter).toBeLessThanOrEqual(61);
    const throttledAfter = telemetry.registry.render().match(/slips_media_upload_throttled_total(?:\{\})? (\d+)/)?.[1];
    expect(Number(throttledAfter)).toBe(Number(throttledBefore ?? 0) + 1);
    expect(Metric.MediaUploadThrottled).toBe('slips_media_upload_throttled_total');
    expect(lines.some((l) => l.includes('media upload throttled') && l.includes(storeId) && l.includes('"level":40'))).toBe(true);
    expect((await admin.query('select 1 from media_upload_grants where store_id = $1', [storeId])).rowCount).toBe(30 + 59 + 1);
  });

  it('Throttle counting is serialized per store: concurrent requests never exceed the limit', async () => {
    const { storeId, token } = await installedStore();
    const hash = 'f'.repeat(64);
    await admin.query(
      `insert into media_upload_grants (store_id, kind, content_type, size_bytes, sha256, storage_key, expires_at)
       select $1, 'image', 'image/png', 10, $2, 'k', now() from generate_series(1, 55)`,
      [storeId, hash],
    );
    const body = { kind: 'image', content_type: 'image/png', size_bytes: 10, sha256: hash };
    const results = await Promise.all(Array.from({ length: 12 }, () => request(token, 'POST', '/v1/media/uploads', body)));
    expect(results.filter((r) => r.res.status === 201)).toHaveLength(5);
    expect(results.filter((r) => r.res.status === 429)).toHaveLength(7);
    expect((await admin.query('select 1 from media_upload_grants where store_id = $1', [storeId])).rowCount).toBe(60);
  });
});

describe('POST /v1/media/uploads/:id/complete and GET /v1/media/:id', () => {
  it('Complete: object present and size matching records the asset uploaded and emits media.asset.uploaded once; a repeat returns the same asset', async () => {
    const { storeId, token } = await installedStore();
    const bytes = await png();
    const grant = await issue(token, 'image', 'image/png', bytes);
    storage.upload(grant.url, bytes, 'image/png');
    const first = await request(token, 'POST', `/v1/media/uploads/${grant.upload_id}/complete`);
    expect(first.res.status).toBe(200);
    const asset = MediaAsset.parse(first.body);
    expect(asset).toMatchObject({ v: 1, kind: 'image', content_type: 'image/png', size_bytes: bytes.length, status: 'uploaded', failure_reason: null });
    const events = await mediaEvents(storeId, asset.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ name: 'media.asset.uploaded', store_id: storeId, payload: { v: 1, store_id: storeId, asset_id: asset.id, kind: 'image', content_type: 'image/png', size_bytes: bytes.length } });

    const again = await request(token, 'POST', `/v1/media/uploads/${grant.upload_id}/complete`);
    expect(again.res.status).toBe(200);
    expect(MediaAsset.parse(again.body)).toEqual(asset);
    expect(await mediaEvents(storeId, asset.id)).toHaveLength(1);
    expect((await admin.query('select 1 from media_assets where store_id = $1', [storeId])).rowCount).toBe(1);
    expect((await admin.query('select upload_key from media_assets where id = $1', [asset.id])).rows[0]).toEqual({ upload_key: `stores/${storeId}/uploads/${sha(bytes)}` });

    const got = await request(token, 'GET', `/v1/media/${asset.id}`);
    expect(got.res.status).toBe(200);
    expect(MediaAsset.parse(got.body)).toEqual(asset);
  });

  it('Missing object answers 409 media-upload-missing; expired with no object 410 media-upload-expired; a different stored size 422 media-too-large and the object is deleted', async () => {
    const { token } = await installedStore();
    const bytes = Buffer.from('a small file');
    const missing = await issue(token, 'image', 'image/png', bytes);
    const res409 = await request(token, 'POST', `/v1/media/uploads/${missing.upload_id}/complete`);
    expect(res409.res.status).toBe(409);
    expect(res409.body).toMatchObject({ type: MEDIA_UPLOAD_MISSING, code: 'media_upload_missing' });

    await admin.query(`update media_upload_grants set expires_at = now() - interval '1 minute' where id = $1`, [missing.upload_id]);
    const res410 = await request(token, 'POST', `/v1/media/uploads/${missing.upload_id}/complete`);
    expect(res410.res.status).toBe(410);
    expect(res410.body).toMatchObject({ type: MEDIA_UPLOAD_EXPIRED, code: 'media_upload_expired' });

    const other = Buffer.from('another small file');
    const grant = await issue(token, 'image', 'image/png', other);
    const key = (await admin.query<{ storage_key: string }>('select storage_key from media_upload_grants where id = $1', [grant.upload_id])).rows[0]!.storage_key;
    await storage.put(key, Buffer.concat([other, Buffer.from('extra')]), 'image/png');
    const res422 = await request(token, 'POST', `/v1/media/uploads/${grant.upload_id}/complete`);
    expect(res422.res.status).toBe(422);
    expect(res422.body).toMatchObject({ type: MEDIA_TOO_LARGE });
    expect(await storage.head(key)).toBeNull();

    // Past expiry plus the grace, complete answers 410 even when an object of the same bytes sits at the shared key.
    const late = Buffer.from('a late file');
    const lateGrant = await issue(token, 'image', 'image/png', late);
    storage.upload(lateGrant.url, late, 'image/png');
    await admin.query(`update media_upload_grants set expires_at = now() - make_interval(secs => $2) where id = $1`, [lateGrant.upload_id, MEDIA_UPLOAD_COMPLETE_GRACE_SECONDS + 60]);
    const late410 = await request(token, 'POST', `/v1/media/uploads/${lateGrant.upload_id}/complete`);
    expect(late410.res.status).toBe(410);
    expect(late410.body).toMatchObject({ type: MEDIA_UPLOAD_EXPIRED });
    // Within the grace (PUT started before expiry, finished after) it is still accepted.
    await admin.query(`update media_upload_grants set expires_at = now() - interval '1 minute' where id = $1`, [lateGrant.upload_id]);
    expect((await request(token, 'POST', `/v1/media/uploads/${lateGrant.upload_id}/complete`)).res.status).toBe(200);
  });

  it("Other store's id: complete and GET answer 404, as do unknown and malformed ids", async () => {
    const a = await installedStore();
    const b = await installedStore();
    const bytes = Buffer.from('store a file');
    const grant = await issue(a.token, 'image', 'image/png', bytes);
    storage.upload(grant.url, bytes, 'image/png');
    expect((await request(b.token, 'POST', `/v1/media/uploads/${grant.upload_id}/complete`)).res.status).toBe(404);
    const asset = MediaAsset.parse((await request(a.token, 'POST', `/v1/media/uploads/${grant.upload_id}/complete`)).body);
    const cross = await request(b.token, 'GET', `/v1/media/${asset.id}`);
    expect(cross.res.status).toBe(404);
    expect(cross.body).toMatchObject({ code: 'media_not_found' });
    expect((await request(a.token, 'GET', `/v1/media/${randomUUID()}`)).res.status).toBe(404);
    expect((await request(a.token, 'GET', '/v1/media/not-a-uuid')).res.status).toBe(404);
    expect((await request(a.token, 'POST', `/v1/media/uploads/${randomUUID()}/complete`)).body).toMatchObject({ code: 'media_upload_not_found' });
  });
});

describe('media.asset.inspect', () => {
  it('Clean JPEG with GPS: the stored copy has no EXIF, the asset is scanned, the upload object is gone, media.asset.scanned is emitted', async () => {
    const { storeId, token } = await installedStore();
    const original = await jpegWithGps();
    expect((await sharp(original).metadata()).exif).toBeDefined();
    const asset = await uploadAndComplete(token, 'image', 'image/jpeg', original);
    const upload = (await assetRow(asset.id)).upload_key;
    const storedBefore = Number(telemetry.registry.render().match(/slips_media_stored_bytes_total(?:\{\})? (\d+)/)?.[1] ?? 0);

    await inspect(storeId, asset.id);

    const row = await assetRow(asset.id);
    expect(row).toMatchObject({ status: 'scanned', failure_reason: null });
    expect(row.storage_key).toMatch(new RegExp(`^stores/${storeId}/assets/${asset.id}/[0-9a-f]{64}/original\\.jpg$`));
    const clean = storage.objects.get(row.storage_key!)!;
    expect(clean.contentType).toBe('image/jpeg');
    expect(row.storage_key).toContain(sha(clean.body));
    const meta = await sharp(clean.body).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.exif).toBeUndefined();
    expect(clean.body.includes(Buffer.from('TestCam'))).toBe(false);
    expect(Number(row.size_bytes)).toBe(clean.body.length);
    expect(await storage.head(upload)).toBeNull();
    expect((await mediaEvents(storeId, asset.id)).map((e) => e.name)).toEqual(['media.asset.uploaded', 'media.asset.scanned']);
    const storedAfter = Number(telemetry.registry.render().match(/slips_media_stored_bytes_total(?:\{\})? (\d+)/)?.[1] ?? 0);
    expect(storedAfter - storedBefore).toBe(clean.body.length);

    // A redelivered job does nothing.
    await inspect(storeId, asset.id);
    expect(await mediaEvents(storeId, asset.id)).toHaveLength(2);
  });

  it('Same bytes uploaded twice in one store: inspecting the first keeps the shared upload object until the second is inspected', async () => {
    const { storeId, token } = await installedStore();
    const bytes = await png();
    const first = await uploadAndComplete(token, 'image', 'image/png', bytes);
    const second = await uploadAndComplete(token, 'image', 'image/png', bytes);
    const upload = (await assetRow(first.id)).upload_key;
    expect((await assetRow(second.id)).upload_key).toBe(upload);

    await inspect(storeId, first.id);
    expect(await storage.head(upload)).not.toBeNull();
    await inspect(storeId, second.id);

    expect((await assetRow(first.id)).status).toBe('scanned');
    expect((await assetRow(second.id)).status).toBe('scanned');
    expect(await storage.head(upload)).toBeNull();
  });

  it('A verdict whose transaction rolls back keeps the upload object, so the retry still inspects the file', async () => {
    const { storeId, token } = await installedStore();
    const asset = await uploadAndComplete(token, 'image', 'image/png', await png());
    const upload = (await assetRow(asset.id)).upload_key;
    await expect(
      withStoreContext(app, storeId, async () => {
        await inspector.inspect(storeId, asset.id, { finalAttempt: false });
        throw new Error('commit failed');
      }),
    ).rejects.toThrow('commit failed');
    expect((await assetRow(asset.id)).status).toBe('uploaded');
    expect(await storage.head(upload)).not.toBeNull();

    await inspect(storeId, asset.id);
    expect((await assetRow(asset.id)).status).toBe('scanned');
    expect(await storage.head(upload)).toBeNull();
  });

  it('An image whose header declares more than MAX_IMAGE_PIXELS fails image_too_large without being decoded', async () => {
    const { storeId, token } = await installedStore();
    const chunk = (type: string, data: Buffer) => {
      const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(zlibCrc32(body));
      return Buffer.concat([len, body, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(16_000, 0);
    ihdr.writeUInt32BE(16_000, 4);
    ihdr.writeUInt8(8, 8);
    ihdr.writeUInt8(2, 9);
    const bomb = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc(1024))), chunk('IEND', Buffer.alloc(0))]);
    const asset = await uploadAndComplete(token, 'image', 'image/png', bomb);
    await inspect(storeId, asset.id);
    expect(await assetRow(asset.id)).toMatchObject({ status: 'failed', failure_reason: 'image_too_large' });
  });

  it('A clean video is stored as uploaded under its content address and scanned', async () => {
    const { storeId, token } = await installedStore();
    const video = fakeMp4();
    const asset = await uploadAndComplete(token, 'video', 'video/mp4', video);
    await inspect(storeId, asset.id);
    const row = await assetRow(asset.id);
    expect(row.status).toBe('scanned');
    expect(row.storage_key).toBe(`stores/${storeId}/assets/${asset.id}/${sha(video)}/original.mp4`);
    expect(storage.objects.get(row.storage_key!)!.body.equals(video)).toBe(true);
  });

  const failures: Array<[string, () => Promise<{ kind: MediaKind; type: string; bytes: Buffer }>, string]> = [
    ['PNG bytes declared as JPEG', async () => ({ kind: 'image', type: 'image/jpeg', bytes: await png() }), 'type_mismatch'],
    ['SVG bytes declared PNG', async () => ({ kind: 'image', type: 'image/png', bytes: svg }), 'type_not_allowed'],
    ['EICAR in file', async () => ({ kind: 'video', type: 'video/mp4', bytes: fakeMp4(Buffer.from(EICAR_TEST_STRING, 'latin1')) }), 'malware'],
    ['EICAR inside an image', async () => ({ kind: 'image', type: 'image/png', bytes: Buffer.concat([await png(), Buffer.from(EICAR_TEST_STRING, 'latin1')]) }), 'malware'],
    ['an undecodable image', async () => ({ kind: 'image', type: 'image/png', bytes: Buffer.concat([(await png()).subarray(0, 40), Buffer.alloc(100, 7)]) }), 'corrupt'],
  ];

  it.each(failures)('%s: failed with the reason, objects deleted, media.asset.failed emitted', async (_name, make, reason) => {
    const { storeId, token } = await installedStore();
    const { kind, type, bytes } = await make();
    const asset = await uploadAndComplete(token, kind, type, bytes);
    const upload = (await assetRow(asset.id)).upload_key;
    await inspect(storeId, asset.id);
    const row = await assetRow(asset.id);
    expect(row).toMatchObject({ status: 'failed', failure_reason: reason, storage_key: null });
    expect(await storage.head(upload)).toBeNull();
    expect([...storage.objects.keys()].some((k) => k.startsWith(`stores/${storeId}/assets/${asset.id}/`))).toBe(false);
    expect((await mediaEvents(storeId, asset.id)).at(-1)).toMatchObject({ name: 'media.asset.failed', payload: { asset_id: asset.id, reason } });
    expect(MediaAsset.parse((await request(token, 'GET', `/v1/media/${asset.id}`)).body)).toMatchObject({ status: 'failed', failure_reason: reason });
  });

  it('Hash differs: bytes at the key that are not the declared file fail checksum_mismatch', async () => {
    const { storeId, token } = await installedStore();
    const declared = Buffer.from('the declared file bytes');
    const grant = await issue(token, 'image', 'image/png', declared);
    const key = (await admin.query<{ storage_key: string }>('select storage_key from media_upload_grants where id = $1', [grant.upload_id])).rows[0]!.storage_key;
    // Same length, different bytes (as if storage had not enforced the signed checksum).
    await storage.put(key, Buffer.from('the declared file bytez'), 'image/png');
    const asset = MediaAsset.parse((await request(token, 'POST', `/v1/media/uploads/${grant.upload_id}/complete`)).body);
    await inspect(storeId, asset.id);
    expect(await assetRow(asset.id)).toMatchObject({ status: 'failed', failure_reason: 'checksum_mismatch' });
    expect(await storage.head(key)).toBeNull();
  });

  it('Storage down: the job throws so it retries; the final attempt (through the job handler) records inspection_failed', async () => {
    const { storeId, token } = await installedStore();
    const asset = await uploadAndComplete(token, 'image', 'image/png', await png());
    storage.failing = true;
    try {
      await expect(inspect(storeId, asset.id)).rejects.toThrow('storage unavailable');
      expect((await assetRow(asset.id)).status).toBe('uploaded');
      const handler = mediaJobHandlers(app, inspector, importer)[MEDIA_INSPECT_QUEUE]!;
      const data = { v: 1, trace_id: 't', store_id: storeId, asset_id: asset.id };
      await expect(handler(data, { id: 'j1', data, retryCount: 1, retryLimit: 2 })).rejects.toThrow();
      expect((await assetRow(asset.id)).status).toBe('uploaded');
      await handler(data, { id: 'j1', data, retryCount: 2, retryLimit: 2 });
    } finally {
      storage.failing = false;
    }
    expect(await assetRow(asset.id)).toMatchObject({ status: 'failed', failure_reason: 'inspection_failed' });
    expect((await mediaEvents(storeId, asset.id)).at(-1)).toMatchObject({ name: 'media.asset.failed', payload: { reason: 'inspection_failed' } });
  });

  it('media.asset.uploaded queues exactly one inspect job per asset, even when the event is delivered again', async () => {
    const { storeId } = await installedStore();
    const registry = new EventHandlerRegistry();
    registerMediaEventHandlers(registry, boss, telemetry, inspector);
    const dispatch = eventDispatcher(app, registry);
    const assetId = uuidv7();
    const envelope = (eventId: string) => ({
      v: 1,
      trace_id: 'trace-media',
      store_id: storeId,
      event_id: eventId,
      name: 'media.asset.uploaded',
      occurred_at: new Date().toISOString(),
      payload: { v: 1, store_id: storeId, asset_id: assetId, kind: 'image', content_type: 'image/png', size_bytes: 10 },
    });
    const first = envelope(uuidv7());
    await dispatch(first, { id: first.event_id, data: first });
    await dispatch(first, { id: first.event_id, data: first });
    // A second, distinct event for the same asset still never queues a second job (job id = asset id).
    const second = envelope(uuidv7());
    await dispatch(second, { id: second.event_id, data: second });
    const jobs = (await admin.query<{ id: string; data: { asset_id: string; store_id: string } }>(`select id::text, data from ${SCHEMA}.job where name = $1 and data->>'asset_id' = $2`, [MEDIA_INSPECT_QUEUE, assetId])).rows;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ id: assetId, data: { store_id: storeId, asset_id: assetId } });
  });
});

describe('Story 3.7: import media from an external link', () => {
  const importLink = (token: string, kind: MediaKind, url: string) => request(token, 'POST', '/v1/media/imports', { kind, url });

  /** Runs the import job body (as the worker does, in the store context), then inspection when the asset became uploaded. */
  const runImport = async (storeId: string, assetId: string, finalAttempt = false) => {
    await withStoreContext(app, storeId, () => importer.import(storeId, assetId, { finalAttempt }));
  };

  const fullRow = async (id: string) =>
    (
      await admin.query<{ status: string; failure_reason: string | null; source_url: string | null; sha256: string | null; size_bytes: string | null; content_type: string | null; upload_key: string | null; storage_key: string | null }>(
        'select * from media_assets where id = $1',
        [id],
      )
    ).rows[0]!;

  it('Public JPEG link: 201 importing asset and media.asset.import_requested; the import stores it at the upload key, uploaded; the same inspection strips EXIF and scans', async () => {
    const { storeId, token } = await installedStore();
    const original = await jpegWithGps();
    const url = `https://cdn.example.com/${randomUUID()}/a.jpg`;
    fetcher.links.set(url, () => ({ outcome: 'ok', body: original, contentType: 'image/jpeg' }));

    const out = await importLink(token, 'image', url);
    expect(out.res.status).toBe(201);
    const asset = MediaAsset.parse(out.body);
    expect(asset).toMatchObject({ kind: 'image', status: 'importing', content_type: null, size_bytes: null, failure_reason: null });
    expect(await fullRow(asset.id)).toMatchObject({ status: 'importing', source_url: url, sha256: null, upload_key: null });
    expect((await mediaEvents(storeId, asset.id)).map((e) => [e.name, e.payload])).toEqual([['media.asset.import_requested', { v: 1, store_id: storeId, asset_id: asset.id, kind: 'image' }]]);

    await runImport(storeId, asset.id);
    const fetched = await fullRow(asset.id);
    expect(fetched).toMatchObject({ status: 'uploaded', sha256: sha(original), content_type: 'image/jpeg', upload_key: `stores/${storeId}/uploads/${sha(original)}`, failure_reason: null });
    expect(Number(fetched.size_bytes)).toBe(original.length);
    expect(fetcher.calls.at(-1)).toEqual({ url, maxBytes: 10 * MB });
    expect(storage.objects.get(fetched.upload_key!)!.body.equals(original)).toBe(true);
    expect((await mediaEvents(storeId, asset.id)).at(-1)).toMatchObject({ name: 'media.asset.uploaded', payload: { asset_id: asset.id, kind: 'image', content_type: 'image/jpeg', size_bytes: original.length } });
    expect(MediaAsset.parse((await request(token, 'GET', `/v1/media/${asset.id}`)).body)).toMatchObject({ status: 'uploaded', content_type: 'image/jpeg' });

    await inspect(storeId, asset.id);
    const row = await fullRow(asset.id);
    expect(row.status).toBe('scanned');
    const clean = storage.objects.get(row.storage_key!)!;
    expect((await sharp(clean.body).metadata()).exif).toBeUndefined();
    expect(clean.body.includes(Buffer.from('TestCam'))).toBe(false);
    expect(await storage.head(fetched.upload_key!)).toBeNull();
    // Never hotlinked: nothing stored or recorded points at the source except source_url.
    expect([...storage.objects.keys()].some((k) => k.includes('cdn.example.com'))).toBe(false);
    expect((await mediaEvents(storeId, asset.id)).map((e) => e.name)).toEqual(['media.asset.import_requested', 'media.asset.uploaded', 'media.asset.scanned']);

    // A redelivered import job does nothing once the asset left importing.
    const calls = fetcher.calls.length;
    await runImport(storeId, asset.id);
    expect(fetcher.calls).toHaveLength(calls);
  });

  it.each([
    ['http://127.0.0.1/'],
    ['http://169.254.169.254/latest/meta-data/'],
    ['http://[::1]/a.jpg'],
    ['http://[::ffff:10.0.0.1]/a.jpg'],
    ['ftp://cdn.example.com/a.jpg'],
    ['https://u:p@cdn.example.com/a.jpg'],
    ['http://cdn.example.com:8080/a.jpg'],
    ['not a link'],
  ])('%s answers 422 media-url-not-allowed and records nothing', async (url) => {
    const { storeId, token } = await installedStore();
    const out = await importLink(token, 'image', url);
    expect(out.res.status).toBe(422);
    expect(out.body).toMatchObject({ type: MEDIA_URL_NOT_ALLOWED, code: 'media_url_not_allowed' });
    expect((await admin.query('select 1 from media_assets where store_id = $1', [storeId])).rowCount).toBe(0);
  });

  it('a malformed body answers 400 and no session 401', async () => {
    const { token } = await installedStore();
    expect((await request(token, 'POST', '/v1/media/imports', { kind: 'audio', url: 'https://x/a' })).res.status).toBe(400);
    expect((await request(token, 'POST', '/v1/media/imports', { kind: 'image', url: `https://x/${'a'.repeat(2048)}` })).res.status).toBe(400);
    expect((await fetch(`${base}/v1/media/imports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'image', url: 'https://x/a.jpg' }) })).status).toBe(401);
  });

  const outcomes: Array<[string, MediaKind, () => Promise<ExternalFetchResult>, string]> = [
    ['DNS name resolving to 10.0.0.5', 'image', async () => ({ outcome: 'blocked', detail: 'resolved address' }), 'fetch_blocked'],
    ['Redirect to a private IP', 'image', async () => ({ outcome: 'blocked', detail: 'redirect: blocked_address' }), 'fetch_blocked'],
    ['Oversize', 'video', async () => ({ outcome: 'too_large' }), 'fetch_too_large'],
    ['404', 'image', async () => ({ outcome: 'failed', detail: 'HTTP 404', status: 404 }), 'fetch_failed'],
    ['HTML page link', 'image', async () => ({ outcome: 'ok', body: Buffer.from('<!doctype html><html><body>hi</body></html>'), contentType: 'text/html' }), 'type_not_allowed'],
    ['SVG link', 'image', async () => ({ outcome: 'ok', body: svg, contentType: 'image/svg+xml' }), 'type_not_allowed'],
    ['A video linked as an image', 'image', async () => ({ outcome: 'ok', body: fakeMp4(), contentType: 'video/mp4' }), 'type_mismatch'],
    ['An image linked as a video', 'video', async () => ({ outcome: 'ok', body: await png(), contentType: 'image/png' }), 'type_mismatch'],
  ];

  it.each(outcomes)('%s: failed with the reason, nothing stored, media.asset.failed emitted, no retry', async (_name, kind, answer, reason) => {
    const { storeId, token } = await installedStore();
    const url = `https://cdn.example.com/${randomUUID()}`;
    const result = await answer();
    fetcher.links.set(url, () => result);
    const asset = MediaAsset.parse((await importLink(token, kind, url)).body);
    await runImport(storeId, asset.id);
    expect(await fullRow(asset.id)).toMatchObject({ status: 'failed', failure_reason: reason, sha256: null, upload_key: null, source_url: url });
    expect([...storage.objects.keys()].some((k) => k.startsWith(`stores/${storeId}/`))).toBe(false);
    expect((await mediaEvents(storeId, asset.id)).at(-1)).toMatchObject({ name: 'media.asset.failed', payload: { asset_id: asset.id, reason } });
    expect(MediaAsset.parse((await request(token, 'GET', `/v1/media/${asset.id}`)).body)).toMatchObject({ status: 'failed', failure_reason: reason, content_type: null, size_bytes: null });
    // The failed asset releases nothing (it has no upload object).
    await withStoreContext(app, storeId, () => inspector.releaseUpload(asset.id));
  });

  it('Server down: attempts 1 and 2 throw so the job retries; the final attempt (through the job handler) records fetch_failed', async () => {
    const { storeId, token } = await installedStore();
    const url = `https://down.example.com/${randomUUID()}.mp4`;
    const asset = MediaAsset.parse((await importLink(token, 'video', url)).body);
    const handler = mediaJobHandlers(app, inspector, importer)[MEDIA_IMPORT_QUEUE]!;
    const data = { v: 1, trace_id: 't', store_id: storeId, asset_id: asset.id };
    await expect(handler(data, { id: 'j1', data, retryCount: 0, retryLimit: 2 })).rejects.toThrow('ECONNREFUSED');
    await expect(handler(data, { id: 'j1', data, retryCount: 1, retryLimit: 2 })).rejects.toThrow('ECONNREFUSED');
    expect((await fullRow(asset.id)).status).toBe('importing');
    await handler(data, { id: 'j1', data, retryCount: 2, retryLimit: 2 });
    expect(await fullRow(asset.id)).toMatchObject({ status: 'failed', failure_reason: 'fetch_failed' });
    expect((await mediaEvents(storeId, asset.id)).map((e) => e.name)).toEqual(['media.asset.import_requested', 'media.asset.failed']);
  });

  it('media.asset.import_requested queues exactly one import job per asset; the uploaded import then queues its inspection', async () => {
    const { storeId } = await installedStore();
    const registry = new EventHandlerRegistry();
    registerMediaEventHandlers(registry, boss, telemetry, inspector);
    const dispatch = eventDispatcher(app, registry);
    const assetId = uuidv7();
    const envelope = (eventId: string) => ({
      v: 1,
      trace_id: 'trace-import',
      store_id: storeId,
      event_id: eventId,
      name: 'media.asset.import_requested',
      occurred_at: new Date().toISOString(),
      payload: { v: 1, store_id: storeId, asset_id: assetId, kind: 'image' },
    });
    const first = envelope(uuidv7());
    await dispatch(first, { id: first.event_id, data: first });
    await dispatch(first, { id: first.event_id, data: first });
    const second = envelope(uuidv7());
    await dispatch(second, { id: second.event_id, data: second });
    const jobs = (await admin.query<{ id: string; data: { store_id: string; asset_id: string } }>(`select id::text, data from ${SCHEMA}.job where name = $1 and data->>'asset_id' = $2`, [MEDIA_IMPORT_QUEUE, assetId])).rows;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ id: assetId, data: { store_id: storeId, asset_id: assetId } });
  });

  it('Imports count toward the per-store upload throttle (grants and imports together)', async () => {
    const { storeId, token } = await installedStore();
    const hash = 'd'.repeat(64);
    await admin.query(
      `insert into media_upload_grants (store_id, kind, content_type, size_bytes, sha256, storage_key, expires_at)
       select $1, 'image', 'image/png', 10, $2, 'k', now() from generate_series(1, 30)`,
      [storeId, hash],
    );
    await admin.query(
      `insert into media_assets (store_id, kind, status, source_url) select $1, 'image', 'importing', 'https://cdn.example.com/x.jpg' from generate_series(1, 29)`,
      [storeId],
    );
    expect((await importLink(token, 'image', 'https://cdn.example.com/60.jpg')).res.status).toBe(201);
    const limited = await importLink(token, 'image', 'https://cdn.example.com/61.jpg');
    expect(limited.res.status).toBe(429);
    expect(limited.body).toMatchObject({ type: MEDIA_UPLOAD_RATE_LIMITED });
    expect(Number(limited.res.headers.get('retry-after'))).toBeGreaterThan(0);
    const grant = await request(token, 'POST', '/v1/media/uploads', { kind: 'image', content_type: 'image/png', size_bytes: 10, sha256: hash });
    expect(grant.res.status).toBe(429);
  });

  it("Other store's import: GET answers 404 and the job does nothing in the wrong store", async () => {
    const a = await installedStore();
    const b = await installedStore();
    const url = `https://cdn.example.com/${randomUUID()}.png`;
    fetcher.links.set(url, () => ({ outcome: 'ok', body: Buffer.alloc(0), contentType: null }));
    const asset = MediaAsset.parse((await importLink(a.token, 'image', url)).body);
    expect((await request(b.token, 'GET', `/v1/media/${asset.id}`)).res.status).toBe(404);
    const calls = fetcher.calls.length;
    await runImport(b.storeId, asset.id);
    expect(fetcher.calls).toHaveLength(calls);
    expect((await fullRow(asset.id)).status).toBe('importing');
  });
});

describe('MediaService reads and the media purge', () => {
  it('publishableAssetIds returns only processed assets (never uploaded, scanned or failed); storedBytes sums non-failed assets', async () => {
    const { storeId } = await installedStore();
    const other = randomUUID();
    const insert = async (store: string, status: string, size: number) =>
      (
        await admin.query<{ id: string }>(
          `insert into media_assets (store_id, kind, content_type, size_bytes, sha256, upload_key, status, failure_reason)
           values ($1, 'image', 'image/png', $2, $3, 'k', $4, case when $4 = 'failed' then 'corrupt' end) returning id::text as id`,
          [store, size, 'a'.repeat(64), status],
        )
      ).rows[0]!.id;
    const uploaded = await insert(storeId, 'uploaded', 100);
    const scanned = await insert(storeId, 'scanned', 200);
    const failed = await insert(storeId, 'failed', 400);
    const processed = await insert(storeId, 'processed', 800);
    const foreign = await insert(other, 'processed', 1600);
    await admin.query(
      `insert into renditions (store_id, asset_id, profile, content_type, width, height, size_bytes, sha256, storage_key)
       values ($1, $2, 'web', 'image/webp', 800, 1200, 350, $3, 'k1'),
              ($1, $4, 'web', 'image/webp', 800, 1200, 999, $3, 'k2')`,
      [storeId, processed, 'b'.repeat(64), failed],
    );
    const service = nest.get(MediaService);
    expect(await service.publishableAssetIds(storeId, [uploaded, scanned, failed, processed, foreign, 'nope'])).toEqual([processed]);
    expect(await service.publishableAssetIds(storeId, [])).toEqual([]);
    expect(await service.storedBytes(storeId)).toBe(100 + 200 + 800 + 350);
    expect(await service.storedBytes(randomUUID())).toBe(0);
  });

  it("mediaStoreData exports all three tables and purges the store's objects, then its rows, in batches", async () => {
    const { storeId, token } = await installedStore();
    const first = await uploadAndComplete(token, 'image', 'image/png', Buffer.from('file 0'));
    await uploadAndComplete(token, 'image', 'image/png', Buffer.from('file 1'));
    await issue(token, 'image', 'image/png', Buffer.from('never uploaded'));
    await admin.query(
      `insert into renditions (store_id, asset_id, profile, content_type, width, height, size_bytes, sha256, storage_key)
       values ($1, $2, 'web', 'image/webp', 64, 64, 128, $3, $4)`,
      [storeId, first.id, 'c'.repeat(64), `stores/${storeId}/assets/${first.id}/${'c'.repeat(64)}/renditions/web.webp`],
    );
    await storage.put(`stores/${storeId}/assets/x/y/original.png`, Buffer.from('clean'), 'image/png');
    const otherStore = randomUUID();
    await storage.put(`stores/${otherStore}/uploads/keep`, Buffer.from('keep'), 'image/png');
    const lifecycle = mediaStoreData(storage);

    await withStoreContext(app, storeId, (tx) => lifecycle.restore!({ storeId, installEpoch: 1, tx }));
    const exported = (await withStoreContext(app, storeId, (tx) => lifecycle.export!({ storeId, installEpoch: 1, tx }))) as Record<string, Array<Record<string, unknown>>>;
    expect(exported.media_assets).toHaveLength(2);
    expect(exported.media_upload_grants).toHaveLength(3);
    expect(exported.renditions).toHaveLength(1);
    expect(exported.media_assets![0]).not.toHaveProperty('store_id');
    expect(exported.renditions![0]).not.toHaveProperty('store_id');

    const purge = () => withStoreContext(app, storeId, (tx) => lifecycle.purge({ storeId, installEpoch: 1, tx, batchLimit: 2 }));
    let calls = 0;
    while (!(await purge()).done) if (++calls > 10) throw new Error('purge did not finish');
    expect(calls).toBeGreaterThan(1);
    expect([...storage.objects.keys()].some((k) => k.startsWith(`stores/${storeId}/`))).toBe(false);
    expect(storage.objects.has(`stores/${otherStore}/uploads/keep`)).toBe(true);
    expect((await admin.query('select 1 from renditions where store_id = $1', [storeId])).rowCount).toBe(0);
    expect((await admin.query('select 1 from media_assets where store_id = $1', [storeId])).rowCount).toBe(0);
    expect((await admin.query('select 1 from media_upload_grants where store_id = $1', [storeId])).rowCount).toBe(0);
  });
});

describe('Story 3.8: media.asset.process and GET /v1/media/:id/poster', () => {
  const renditionRows = async (assetId: string) =>
    (
      await admin.query<{
        profile: string;
        content_type: string;
        width: number;
        height: number;
        size_bytes: string;
        sha256: string;
        storage_key: string;
      }>('select profile, content_type, width, height, size_bytes::text, sha256, storage_key from renditions where asset_id = $1 order by profile', [assetId])
    ).rows;

  it('1080p video: produces 480p, 720p, 1080p MP4s + 720x1280 WebP poster at immutable keys, marks processed, emits media.asset.processed, records metrics and serves poster', async () => {
    const { storeId, token } = await installedStore();
    const mp4 = buildMp4Buffer(1080, 1920);
    const asset = await uploadAndComplete(token, 'video', 'video/mp4', mp4);
    expect(asset.poster_url).toBeNull();
    await inspect(storeId, asset.id);
    expect((await request(token, 'GET', `/v1/media/${asset.id}/poster`)).res.status).toBe(404);

    const storedMetricBefore = telemetry.registry.value(Metric.MediaStoredBytes);
    await processorRunner.process(storeId, asset.id);

    const row = await assetRow(asset.id);
    expect(row.status).toBe('processed');
    const rows = await renditionRows(asset.id);
    expect(rows.map((r) => ({ profile: r.profile, content_type: r.content_type, width: r.width, height: r.height }))).toEqual([
      { profile: '1080p', content_type: 'video/mp4', width: 1080, height: 1920 },
      { profile: '480p', content_type: 'video/mp4', width: 480, height: 854 },
      { profile: '720p', content_type: 'video/mp4', width: 720, height: 1280 },
      { profile: 'poster', content_type: 'image/webp', width: 720, height: 1280 },
    ]);
    let renditionsBytes = 0;
    for (const r of rows) {
      const ext = r.content_type === 'video/mp4' ? 'mp4' : 'webp';
      expect(r.storage_key).toBe(`stores/${storeId}/assets/${asset.id}/${r.sha256}/renditions/${r.profile}.${ext}`);
      const storedObj = storage.objects.get(r.storage_key);
      expect(storedObj).toBeDefined();
      expect(sha(storedObj!.body)).toBe(r.sha256);
      renditionsBytes += Number(r.size_bytes);
    }
    expect(telemetry.registry.value(Metric.MediaStoredBytes) - storedMetricBefore).toBe(renditionsBytes);
    expect(telemetry.registry.render()).toContain(`${Metric.MediaProcessingDuration}_count{kind="video"}`);

    const events = await mediaEvents(storeId, asset.id);
    expect(events.map((e) => e.name)).toEqual(['media.asset.uploaded', 'media.asset.scanned', 'media.asset.processed']);
    expect(events.at(-1)?.payload).toEqual({ v: 1, store_id: storeId, asset_id: asset.id, kind: 'video' });

    const fetched = MediaAsset.parse((await request(token, 'GET', `/v1/media/${asset.id}`)).body);
    expect(fetched.status).toBe('processed');
    expect(fetched.poster_url).toBe(`/v1/media/${asset.id}/poster`);

    const posterRes = await fetch(`${base}/v1/media/${asset.id}/poster`, { headers: { authorization: `Bearer ${token}` } });
    expect(posterRes.status).toBe(200);
    expect(posterRes.headers.get('content-type')).toContain('image/webp');
    expect(posterRes.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    const posterBytes = Buffer.from(await posterRes.arrayBuffer());
    const posterMeta = await sharp(posterBytes).metadata();
    expect({ format: posterMeta.format, width: posterMeta.width, height: posterMeta.height }).toEqual({
      format: 'webp',
      width: 720,
      height: 1280,
    });

    // Idempotent when called again on an already-processed asset.
    await processorRunner.process(storeId, asset.id);
    expect(await renditionRows(asset.id)).toHaveLength(4);
  });

  it('720p video: produces only 480p, 720p and poster — never upscales to 1080p', async () => {
    const { storeId, token } = await installedStore();
    const mp4 = buildMp4Buffer(720, 1280);
    const asset = await uploadAndComplete(token, 'video', 'video/mp4', mp4);
    await inspect(storeId, asset.id);
    await processorRunner.process(storeId, asset.id);

    const rows = await renditionRows(asset.id);
    expect(rows.map((r) => r.profile)).toEqual(['480p', '720p', 'poster']);
  });

  it('Image asset: produces web rendition (image/webp, capped at 1920px without upscaling) and streams it at /poster', async () => {
    const { storeId, token } = await installedStore();
    const largeJpeg = await sharp({ create: { width: 2160, height: 3840, channels: 3, background: '#246' } }).jpeg().toBuffer();
    const asset = await uploadAndComplete(token, 'image', 'image/jpeg', largeJpeg);
    await inspect(storeId, asset.id);
    await processorRunner.process(storeId, asset.id);

    const rows = await renditionRows(asset.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ profile: 'web', content_type: 'image/webp', width: 1080, height: 1920 });
    expect(telemetry.registry.render()).toContain(`${Metric.MediaProcessingDuration}_count{kind="image"}`);

    const posterRes = await fetch(`${base}/v1/media/${asset.id}/poster`, { headers: { authorization: `Bearer ${token}` } });
    expect(posterRes.status).toBe(200);
    expect(posterRes.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    const meta = await sharp(Buffer.from(await posterRes.arrayBuffer())).metadata();
    expect({ format: meta.format, width: meta.width, height: meta.height }).toEqual({ format: 'webp', width: 1080, height: 1920 });

    // Other store gets 404 on /poster.
    const other = await installedStore();
    expect((await fetch(`${base}/v1/media/${asset.id}/poster`, { headers: { authorization: `Bearer ${other.token}` } })).status).toBe(404);
    expect((await fetch(`${base}/v1/media/${randomUUID()}/poster`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(404);
  });

  it('media.asset.scanned queues exactly one media.asset.process job per asset; transient processor error retries then records processing_failed on final attempt', async () => {
    const { storeId, token } = await installedStore();
    const registry = new EventHandlerRegistry();
    registerMediaEventHandlers(registry, boss, telemetry, inspector);
    const dispatch = eventDispatcher(app, registry);

    const asset = await uploadAndComplete(token, 'video', 'video/mp4', buildMp4Buffer(1080, 1920));
    await inspect(storeId, asset.id);

    const scannedEvent = (await mediaEvents(storeId, asset.id)).find((e) => e.name === 'media.asset.scanned')!;
    await dispatch(scannedEvent, { id: scannedEvent.event_id, data: scannedEvent });
    await dispatch(scannedEvent, { id: scannedEvent.event_id, data: scannedEvent });
    const jobs = (
      await admin.query<{ id: string; data: { store_id: string; asset_id: string } }>(
        `select id::text, data from ${SCHEMA}.job where name = $1 and data->>'asset_id' = $2`,
        [MEDIA_PROCESS_QUEUE, asset.id],
      )
    ).rows;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ id: asset.id, data: { store_id: storeId, asset_id: asset.id } });

    // Failing processor: attempts 1 and 2 throw; final attempt records processing_failed and emits media.asset.failed.
    const brokenProcessor: MediaProcessor = {
      processVideo: async () => {
        throw new Error('transcoder crashed');
      },
      processImage: async () => {
        throw new Error('transcoder crashed');
      },
    };
    const failingRunner = new MediaProcessorRunner(storage, brokenProcessor, boss, telemetry, app);
    const handler = mediaJobHandlers(app, inspector, importer, failingRunner)[MEDIA_PROCESS_QUEUE]!;
    const data = { v: 1, trace_id: 't', store_id: storeId, asset_id: asset.id };
    await expect(handler(data, { id: asset.id, data, retryCount: 0, retryLimit: 2 })).rejects.toThrow('transcoder crashed');
    await expect(handler(data, { id: asset.id, data, retryCount: 1, retryLimit: 2 })).rejects.toThrow('transcoder crashed');
    expect((await assetRow(asset.id)).status).toBe('scanned');
    await handler(data, { id: asset.id, data, retryCount: 2, retryLimit: 2 });
    expect(await assetRow(asset.id)).toMatchObject({ status: 'failed', failure_reason: 'processing_failed' });
    expect(await renditionRows(asset.id)).toEqual([]);
    expect((await mediaEvents(storeId, asset.id)).at(-1)).toMatchObject({
      name: 'media.asset.failed',
      payload: { store_id: storeId, asset_id: asset.id, reason: 'processing_failed' },
    });
  });
});
