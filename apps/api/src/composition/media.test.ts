// Story 3.5 composition tests: live Postgres (non-owner RLS role, real pg-boss outbox), in-memory object storage, the
// merchant media API over HTTP, the worker inspection with real file-type/sharp fixtures, and the media purge.
import 'reflect-metadata';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EVENT_QUEUE,
  MEDIA_INSPECT_QUEUE,
  MEDIA_TOO_LARGE,
  MEDIA_TYPE_NOT_ALLOWED,
  MEDIA_UPLOAD_EXPIRED,
  MEDIA_UPLOAD_MISSING,
  MEDIA_UPLOAD_RATE_LIMITED,
  MediaAsset,
  MediaUploadGrant,
  type EventEnvelope,
  type MediaKind,
} from '@slips/contracts';
import { ensureTestAppRole, runMigrations, withStoreContext } from '@slips/db';
import { EicarMalwareScanner, EICAR_TEST_STRING } from '../adapters/scanner/eicar-scanner.js';
import { MemoryObjectStorage } from '../adapters/storage/memory-storage.js';
import { PinoTelemetry } from '../adapters/telemetry/pino-telemetry.js';
import { EventHandlerRegistry, eventDispatcher } from '../events/dispatcher.js';
import { uuidv7 } from '../events/outbox.js';
import { grantEventPublishing } from '../events/queue-grants.js';
import { createHttpApp } from '../http.js';
import type { SessionConfig } from '../infra.module.js';
import { MediaInspector } from '../modules/media/media-inspect.js';
import { mediaStoreData } from '../modules/media/media.lifecycle.js';
import { MediaService } from '../modules/media/media.service.js';
import { SessionService } from '../modules/session/session.service.js';
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
  inspector = new MediaInspector(storage, scanner, boss, telemetry);
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

const inspect = (storeId: string, assetId: string, finalAttempt = false) => withStoreContext(app, storeId, () => inspector.inspect(storeId, assetId, { finalAttempt }));

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
      const handler = mediaJobHandlers(app, inspector)[MEDIA_INSPECT_QUEUE]!;
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
    registerMediaEventHandlers(registry, boss, telemetry);
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
    const service = nest.get(MediaService);
    expect(await service.publishableAssetIds(storeId, [uploaded, scanned, failed, processed, foreign, 'nope'])).toEqual([processed]);
    expect(await service.publishableAssetIds(storeId, [])).toEqual([]);
    expect(await service.storedBytes(storeId)).toBe(100 + 200 + 800);
    expect(await service.storedBytes(randomUUID())).toBe(0);
  });

  it("mediaStoreData exports both tables and purges the store's objects, then its rows, in batches", async () => {
    const { storeId, token } = await installedStore();
    for (let i = 0; i < 2; i++) await uploadAndComplete(token, 'image', 'image/png', Buffer.from(`file ${i}`));
    await issue(token, 'image', 'image/png', Buffer.from('never uploaded'));
    await storage.put(`stores/${storeId}/assets/x/y/original.png`, Buffer.from('clean'), 'image/png');
    const otherStore = randomUUID();
    await storage.put(`stores/${otherStore}/uploads/keep`, Buffer.from('keep'), 'image/png');
    const lifecycle = mediaStoreData(storage);

    await withStoreContext(app, storeId, (tx) => lifecycle.restore!({ storeId, installEpoch: 1, tx }));
    const exported = (await withStoreContext(app, storeId, (tx) => lifecycle.export!({ storeId, installEpoch: 1, tx }))) as Record<string, Array<Record<string, unknown>>>;
    expect(exported.media_assets).toHaveLength(2);
    expect(exported.media_upload_grants).toHaveLength(3);
    expect(exported.media_assets![0]).not.toHaveProperty('store_id');

    const purge = () => withStoreContext(app, storeId, (tx) => lifecycle.purge({ storeId, installEpoch: 1, tx, batchLimit: 2 }));
    let calls = 0;
    while (!(await purge()).done) if (++calls > 10) throw new Error('purge did not finish');
    expect(calls).toBeGreaterThan(1);
    expect([...storage.objects.keys()].some((k) => k.startsWith(`stores/${storeId}/`))).toBe(false);
    expect(storage.objects.has(`stores/${otherStore}/uploads/keep`)).toBe(true);
    expect((await admin.query('select 1 from media_assets where store_id = $1', [storeId])).rowCount).toBe(0);
    expect((await admin.query('select 1 from media_upload_grants where store_id = $1', [storeId])).rowCount).toBe(0);
  });
});
