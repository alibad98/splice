// Composition-root test (may import adapters, unlike modules). Live-Postgres tests: real RLS (non-owner role), real pg-boss queue, real envelope cipher, fake platform.
import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EVENT_QUEUE } from '@slips/contracts';
import { ensureTestAppRole, runMigrations } from '@slips/db';
import { EnvelopeTokenCipher } from '../adapters/crypto/envelope-cipher.js';
import { SendOnlyEventSender } from '../adapters/pgboss/send-only-producer.js';
import { grantEventPublishing } from '../events/queue-grants.js';
import { PinoTelemetry } from '../adapters/telemetry/pino-telemetry.js';
import { SallaCommercePlatform } from '../adapters/salla/index.js';
import { buildInfra, createHttpApp } from '../http.js';
import { IntegrationRepository } from '../modules/integration/integration.repository.js';
import { PlatformAuthRejectedError, PlatformUnavailableError, type CommercePlatform, type MerchantProfile, type TokenSet } from '../ports/commerce-platform.js';
import { StoreDisconnectedError, StoreNotConnectedError } from '../modules/integration/errors.js';
import { createInstallState } from '../modules/integration/install-state.js';
import { IntegrationService } from '../modules/integration/integration.service.js';

const ADMIN_URL = 'postgres://slips:slips@127.0.0.1:5433/slips';
const APP_URL = 'postgres://slips_it_api:it_api_pw@127.0.0.1:5433/slips';
const SCHEMA = 'pgboss_integration_test';
const lines: string[] = [];
const telemetry = new PinoTelemetry({ role: 'http', level: 'debug', stream: { write: (l: string) => void lines.push(l) } });
const cipher = new EnvelopeTokenCipher({ k1: randomBytes(32).toString('base64') }, 'k1');
const config = { dashboardUrl: 'https://dash.example.com', stateSecret: randomBytes(32), secureCookies: false };

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 4 });
let app: pg.Pool;
let boss: PgBoss;

let seq = 0;
const uniqueStore = (): MerchantProfile => ({ platformStoreId: `it-${randomUUID()}`, storeName: `Store ${++seq}`, platformMerchantId: `m-${seq}`, ownerName: 'Owner', domains: ['shop.example.com'] });
const tokenSet = (tag: string, expiresInMs = 3_600_000): TokenSet => ({ accessToken: `AT-${tag}`, refreshToken: `RT-${tag}`, expiresAt: new Date(Date.now() + expiresInMs), scopes: ['offline_access'] });

/** A platform whose refresh tokens are single-use, like Salla's. */
class FakePlatform implements CommercePlatform {
  readonly platform = 'salla' as const;
  refreshCalls = 0;
  refreshDelayMs = 0;
  mode: 'ok' | 'rejected' | 'down' = 'ok';
  private valid = new Set<string>();
  private n = 0;
  issue(tag: string): TokenSet {
    const t = tokenSet(tag);
    this.valid.add(t.refreshToken);
    return t;
  }
  readonly auth = {
    buildAuthorizeUrl: (state: string) => `https://accounts.example/auth?state=${state}`,
    exchangeCode: async (code: string) => {
      if (code === 'bad') throw new PlatformAuthRejectedError();
      return this.issue(`code-${code}`);
    },
    refresh: async (refreshToken: string) => {
      this.refreshCalls++;
      if (this.refreshDelayMs) await new Promise((r) => setTimeout(r, this.refreshDelayMs));
      if (this.mode === 'down') throw new PlatformUnavailableError('down');
      if (this.mode === 'rejected' || !this.valid.delete(refreshToken)) throw new PlatformAuthRejectedError();
      return this.issue(`r${++this.n}`);
    },
    getMerchantProfile: async () => this.profile,
  };
  profile: MerchantProfile = uniqueStore();
  embedded = { introspect: async (): Promise<never> => { throw new PlatformAuthRejectedError(); }, openUrl: () => undefined };
  products = { list: async () => ({ items: [], hasMore: false }) };
  orders = { get: async () => ({ externalId: '1', status: 's', total: 1, currency: 'SAR', lines: [] }) };
  subscriptions = { list: async () => [] };
  webhooks = { verify: () => false, parse: () => null };
}

function service(platform: FakePlatform) {
  return new IntegrationService(app, platform, cipher, telemetry, boss, config);
}
const jobsFor = async (storeId: string, name: string): Promise<number> =>
  Number((await admin.query<{ n: string }>(`select count(*) as n from ${SCHEMA}.job where name = $1 and data->>'store_id' = $2 and data->>'name' = $3`, [EVENT_QUEUE, storeId, name])).rows[0]!.n);

beforeAll(async () => {
  await runMigrations(admin);
  await ensureTestAppRole(admin, 'slips_it_api', 'it_api_pw');
  app = new pg.Pool({ connectionString: APP_URL, max: 6 });
  await admin.query(`drop schema if exists ${SCHEMA} cascade`);
  boss = new PgBoss({ connectionString: ADMIN_URL, schema: SCHEMA });
  await boss.start();
  await boss.createQueue(EVENT_QUEUE);
  await grantEventPublishing(admin, telemetry, EVENT_QUEUE, SCHEMA, 'slips_app');
});
afterAll(async () => {
  await boss?.stop({ graceful: false });
  await admin.query(`drop schema if exists ${SCHEMA} cascade`);
  await app?.end();
  await admin.end();
});

describe('install', () => {
  it('creates the store, one merchant account and encrypted tokens, and emits integration.store.installed', async () => {
    const p = new FakePlatform();
    const profile = uniqueStore();
    const { storeId, created } = await service(p).installFromTokens(p.issue('first'), profile);
    expect(created).toBe(true);
    const store = (await admin.query('select * from stores where id = $1', [storeId])).rows[0];
    expect(store).toMatchObject({ platform: 'salla', platform_store_id: profile.platformStoreId, name: profile.storeName, lifecycle_state: 'active', install_epoch: 1, synced_domains: ['shop.example.com'] });
    expect((await admin.query('select * from merchant_accounts where store_id = $1', [storeId])).rows).toHaveLength(1);
    const tok = (await admin.query('select * from platform_tokens where store_id = $1', [storeId])).rows[0];
    expect(JSON.stringify(tok)).not.toMatch(/AT-first|RT-first/);
    expect(tok.access_token_enc).toMatch(/^v1\.k1\./);
    expect(tok.key_id).toBe('k1');
    expect(await jobsFor(storeId, 'integration.store.installed')).toBe(1);
    const log = (await admin.query('select purpose, outcome from token_access_log where store_id = $1', [storeId])).rows;
    expect(log).toEqual([{ purpose: 'install', outcome: 'ok' }]);
    expect((await admin.query("select id::text from store_locator where platform = 'salla' and platform_store_id = $1", [profile.platformStoreId])).rows[0].id).toBe(storeId);
  });

  it('installing the same platform store again updates it in place (no second store, no second event)', async () => {
    const p = new FakePlatform();
    const profile = uniqueStore();
    const s = service(p);
    const first = await s.installFromTokens(p.issue('a'), profile);
    const second = await s.installFromTokens(p.issue('b'), { ...profile, storeName: 'Renamed', domains: ['new.example.com'] });
    expect(second).toEqual({ storeId: first.storeId, created: false });
    const stores = (await admin.query('select name, synced_domains, install_epoch from stores where platform_store_id = $1', [profile.platformStoreId])).rows;
    expect(stores).toEqual([{ name: 'Renamed', synced_domains: ['new.example.com'], install_epoch: 1 }]);
    expect(await s.getAccessToken(first.storeId)).toBe('AT-b');
    expect(await jobsFor(first.storeId, 'integration.store.installed')).toBe(1);
  });

  it('concurrent installs of one new store produce a single store', async () => {
    const p = new FakePlatform();
    const profile = uniqueStore();
    const s = service(p);
    const results = await Promise.all([s.installFromTokens(p.issue('x1'), profile), s.installFromTokens(p.issue('x2'), profile), s.installFromTokens(p.issue('x3'), profile)]);
    expect(new Set(results.map((r) => r.storeId)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect((await admin.query('select 1 from stores where platform_store_id = $1', [profile.platformStoreId])).rowCount).toBe(1);
  });

  it('rolls back everything (and the event) when persisting fails', async () => {
    const p = new FakePlatform();
    const profile = uniqueStore();
    const broken = new IntegrationService(app, p, { ...cipher, keyId: 'k1', encrypt: () => { throw new Error('kms down'); }, decrypt: cipher.decrypt.bind(cipher) }, telemetry, boss, config);
    await expect(broken.installFromTokens(p.issue('z'), profile)).rejects.toThrow('kms down');
    expect((await admin.query('select 1 from stores where platform_store_id = $1', [profile.platformStoreId])).rowCount).toBe(0);
    expect((await admin.query('select 1 from store_locator where platform_store_id = $1', [profile.platformStoreId])).rowCount).toBe(0);
  });

  it('completeInstall exchanges the code, loads the profile, and validates state and cookie', async () => {
    const p = new FakePlatform();
    const s = service(p);
    const { state, nonce } = createInstallState(config.stateSecret, Date.now());
    expect(await s.completeInstall({ code: 'bad', state, cookieNonce: nonce })).toEqual({ ok: false, reason: 'rejected' });
    expect(await s.completeInstall({ code: 'c1', state, cookieNonce: 'other' })).toEqual({ ok: false, reason: 'state' });
    expect(await s.completeInstall({ code: 'c1', state: 'forged', cookieNonce: nonce })).toEqual({ ok: false, reason: 'state' });
    expect(await s.completeInstall({ error: 'access_denied', state, cookieNonce: nonce })).toEqual({ ok: false, reason: 'denied' });
    const ok = await s.completeInstall({ code: 'c1', state, cookieNonce: nonce });
    expect(ok).toMatchObject({ ok: true, created: true });
    expect(await s.getConnection((ok as { storeId: string }).storeId)).toEqual({ v: 1, state: 'connected', store_name: p.profile.storeName });
  });
});

describe('getAccessToken', () => {
  async function installed(p: FakePlatform, expiresInMs: number) {
    const t = p.issue('seed');
    const { storeId } = await service(p).installFromTokens({ ...t, expiresAt: new Date(Date.now() + expiresInMs) }, uniqueStore());
    return storeId;
  }

  it('returns the stored token without refreshing while it is fresh, and records the access', async () => {
    const p = new FakePlatform();
    const id = await installed(p, 3_600_000);
    expect(await service(p).getAccessToken(id)).toBe('AT-seed');
    expect(p.refreshCalls).toBe(0);
    const log = (await admin.query('select purpose from token_access_log where store_id = $1 order by accessed_at', [id])).rows.map((r) => r.purpose);
    expect(log).toEqual(['install', 'use']);
  });

  it('two concurrent callers with an expired token cause exactly one refresh and both get the new token', async () => {
    const p = new FakePlatform();
    p.refreshDelayMs = 150;
    const id = await installed(p, 10_000); // inside the refresh skew
    const s = service(p);
    const [a, b, c] = await Promise.all([s.getAccessToken(id), s.getAccessToken(id), s.getAccessToken(id)]);
    expect(p.refreshCalls).toBe(1);
    expect([a, b, c]).toEqual(['AT-r1', 'AT-r1', 'AT-r1']);
    const row = (await admin.query('select access_token_enc, refresh_token_enc from platform_tokens where store_id = $1', [id])).rows[0];
    expect(cipher.decrypt(row.access_token_enc, `${id}:access`)).toBe('AT-r1');
    expect(cipher.decrypt(row.refresh_token_enc, `${id}:refresh`)).toBe('RT-r1');
    const purposes = (await admin.query("select purpose from token_access_log where store_id = $1 and purpose = 'refresh'", [id])).rowCount;
    expect(purposes).toBe(1);
  });

  it('a definitive refresh rejection disconnects the store, emits the event once, and stops refreshing', async () => {
    const p = new FakePlatform();
    const id = await installed(p, -1000);
    p.mode = 'rejected';
    const s = service(p);
    const results = await Promise.allSettled([s.getAccessToken(id), s.getAccessToken(id)]);
    expect(results.every((r) => r.status === 'rejected' && r.reason instanceof StoreDisconnectedError)).toBe(true);
    expect(p.refreshCalls).toBe(1);
    expect((await admin.query('select lifecycle_state from stores where id = $1', [id])).rows[0].lifecycle_state).toBe('disconnected');
    expect(await jobsFor(id, 'integration.store.disconnected')).toBe(1);
    expect(await s.getConnection(id)).toMatchObject({ state: 'disconnected' });
    await expect(s.getAccessToken(id)).rejects.toBeInstanceOf(StoreDisconnectedError);
    expect(p.refreshCalls).toBe(1);
    expect((await admin.query("select outcome from token_access_log where store_id = $1 and purpose = 'refresh'", [id])).rows).toEqual([{ outcome: 'rejected' }]);
  });

  it('a transient refresh failure leaves the store connected and the tokens untouched', async () => {
    const p = new FakePlatform();
    const id = await installed(p, -1000);
    p.mode = 'down';
    const s = service(p);
    await expect(s.getAccessToken(id)).rejects.toBeInstanceOf(PlatformUnavailableError);
    expect((await admin.query('select lifecycle_state from stores where id = $1', [id])).rows[0].lifecycle_state).toBe('active');
    expect(await jobsFor(id, 'integration.store.disconnected')).toBe(0);
    p.mode = 'ok';
    expect(await s.getAccessToken(id)).toBe('AT-r1');
  });

  it('an unknown store is not connected', async () => {
    await expect(service(new FakePlatform()).getAccessToken(randomUUID())).rejects.toBeInstanceOf(StoreNotConnectedError);
    expect(await service(new FakePlatform()).getConnection(randomUUID())).toEqual({ v: 1, state: 'not_connected' });
  });

  it('never writes a token or secret to the logs', async () => {
    const out = lines.join('\n');
    expect(out).not.toMatch(/AT-|RT-/);
    expect(out).toContain('store install completed');
  });
});

describe('http role', () => {
  it('the send-only producer publishes events from an http process (no worker consumer needed)', async () => {
    const sender = new SendOnlyEventSender(ADMIN_URL, telemetry, SCHEMA);
    const p = new FakePlatform();
    const s = new IntegrationService(app, p, cipher, telemetry, sender, config);
    const { storeId } = await s.installFromTokens(p.issue('http'), uniqueStore());
    expect(await jobsFor(storeId, 'integration.store.installed')).toBe(1);
    await sender.close();
  });

  it('GET install redirects to Salla with a signed state and a binding cookie; the callback installs and redirects to the dashboard', async () => {
    const p = new FakePlatform();
    const nest = await createHttpApp({ CORS_ORIGINS: 'http://localhost:3000', LOG_LEVEL: 'silent' }, { pool: app, events: boss, cipher, platform: p, integration: config, telemetry });
    await nest.listen(0);
    try {
      const base = await nest.getUrl();
      const start = await fetch(`${base}/v1/integrations/salla/install`, { redirect: 'manual' });
      expect(start.status).toBe(302);
      const cookie = start.headers.get('set-cookie')!;
      expect(cookie).toMatch(/slips_oauth_state=[\w-]+; HttpOnly; SameSite=Lax/);
      const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
      const nonce = /slips_oauth_state=([\w-]+)/.exec(cookie)![1]!;

      const missingCookie = await fetch(`${base}/v1/integrations/salla/callback?code=ok1&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
      expect(missingCookie.headers.get('location')).toBe('https://dash.example.com/?install_error=state');

      const done = await fetch(`${base}/v1/integrations/salla/callback?code=ok1&state=${encodeURIComponent(state)}`, { redirect: 'manual', headers: { cookie: `slips_oauth_state=${nonce}` } });
      expect(done.status).toBe(302);
      expect(done.headers.get('location')).toBe('https://dash.example.com/?connected=1');
      expect(done.headers.get('cache-control')).toBe('no-store');
      expect((await admin.query('select 1 from stores where platform_store_id = $1', [p.profile.platformStoreId])).rowCount).toBe(1);
    } finally {
      await nest.close();
    }
  });
});

describe('security review fixes', () => {
  async function installedExpired(p: FakePlatform) {
    const t = p.issue('seed');
    const { storeId } = await service(p).installFromTokens({ ...t, expiresAt: new Date(Date.now() - 1000) }, uniqueStore());
    return storeId;
  }

  it('the app role has only the outbox insert on pg-boss: no job reads, no internals', async () => {
    await expect(app.query(`select * from ${SCHEMA}.job`)).rejects.toMatchObject({ code: '42501' });
    await expect(app.query(`select * from ${SCHEMA}.job_common`)).rejects.toMatchObject({ code: '42501' });
    await expect(app.query(`select data from ${SCHEMA}.job_common`)).rejects.toMatchObject({ code: '42501' });
    await expect(app.query(`select * from ${SCHEMA}.queue`)).rejects.toMatchObject({ code: '42501' });
    await expect(app.query(`insert into ${SCHEMA}.schedule (name, cron) values ('x', '* * * * *')`)).rejects.toMatchObject({ code: '42501' });
    await expect(app.query(`delete from ${SCHEMA}.job_common`)).rejects.toMatchObject({ code: '42501' });
    // ... and publishing through it still works (covered end to end by the install tests above).
    const p = new FakePlatform();
    const { storeId } = await service(p).installFromTokens(p.issue('grants'), uniqueStore());
    expect(await jobsFor(storeId, 'integration.store.installed')).toBe(1);
  });

  it('a 429 from the token endpoint fails the refresh at once without sleeping inside the transaction', async () => {
    const f = vi.fn(async () => new Response('', { status: 429, headers: { 'retry-after': '90' } }));
    const sleep = vi.fn(async () => undefined);
    const salla = new SallaCommercePlatform({ clientId: 'c', clientSecret: 'secret-123', redirectUri: 'https://x/cb' }, telemetry, { fetch: f as unknown as typeof fetch, sleep });
    const fake = new FakePlatform();
    const id = await installedExpired(fake);
    const s = new IntegrationService(app, salla, cipher, telemetry, boss, config);
    await expect(s.getAccessToken(id)).rejects.toBeInstanceOf(PlatformUnavailableError);
    expect(f).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect((await admin.query('select lifecycle_state from stores where id = $1', [id])).rows[0].lifecycle_state).toBe('active');
  });

  it('retries persisting the rotated pair in its own transaction', async () => {
    const p = new FakePlatform();
    const id = await installedExpired(p);
    const orig = IntegrationRepository.prototype.upsertTokens;
    let calls = 0;
    vi.spyOn(IntegrationRepository.prototype, 'upsertTokens').mockImplementation(function (this: IntegrationRepository, t) {
      return ++calls <= 2 ? Promise.reject(new Error('db blip')) : orig.call(this, t);
    });
    const capture = vi.spyOn(telemetry, 'captureError');
    expect(await service(p).getAccessToken(id)).toBe('AT-r1');
    expect(calls).toBe(3);
    expect(capture).not.toHaveBeenCalled();
    const row = (await admin.query('select access_token_enc from platform_tokens where store_id = $1', [id])).rows[0];
    expect(cipher.decrypt(row.access_token_enc, `${id}:access`)).toBe('AT-r1');
  });

  it('when persisting keeps failing: reports token_persist_failed, and the next invalid_grant leaves the store connected', async () => {
    const p = new FakePlatform();
    const id = await installedExpired(p);
    vi.spyOn(IntegrationRepository.prototype, 'upsertTokens').mockRejectedValue(new Error('db down'));
    const capture = vi.spyOn(telemetry, 'captureError');
    const s = service(p);
    expect(await s.getAccessToken(id)).toBe('AT-r1'); // this caller still gets the fresh token
    expect(capture).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ code: 'token_persist_failed', store_id: id }));
    vi.restoreAllMocks();
    // The stored pair is the old, now-consumed one: Salla answers invalid_grant.
    await expect(service(p).getAccessToken(id)).rejects.toBeInstanceOf(PlatformUnavailableError);
    expect((await admin.query('select lifecycle_state from stores where id = $1', [id])).rows[0].lifecycle_state).toBe('active');
    expect(await jobsFor(id, 'integration.store.disconnected')).toBe(0);
    // The marker is also in the access log, so another replica reaches the same verdict.
    expect((await admin.query("select 1 from token_access_log where store_id = $1 and outcome = 'persist_failed'", [id])).rowCount).toBe(1);
    await expect(service(p).getAccessToken(id)).rejects.toBeInstanceOf(PlatformUnavailableError);
  });

  it('install of an existing store waits for the refresh lock', async () => {
    const p = new FakePlatform();
    const profile = uniqueStore();
    const { storeId } = await service(p).installFromTokens(p.issue('lock'), profile);
    const holder = await admin.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`platform_tokens:${storeId}`]);
      let done = false;
      const install = service(p).installFromTokens(p.issue('lock2'), profile).then((r) => ((done = true), r));
      await new Promise((r) => setTimeout(r, 400));
      expect(done).toBe(false);
      await holder.query('COMMIT');
      await install;
      expect(done).toBe(true);
    } finally {
      holder.release();
    }
  });

  it('the OAuth state secret is stable across processes when OAUTH_STATE_SECRET is set', () => {
    const env = { CORS_ORIGINS: 'x', LOG_LEVEL: 'silent' as const, OAUTH_STATE_SECRET: 'z'.repeat(32) };
    const a = buildInfra(env, 'http', { pool: app, events: boss });
    const b = buildInfra(env, 'http', { pool: app, events: boss });
    expect(a.integration.stateSecret.equals(b.integration.stateSecret)).toBe(true);
    const c = buildInfra({ CORS_ORIGINS: 'x', LOG_LEVEL: 'silent' }, 'http', { pool: app, events: boss });
    const d = buildInfra({ CORS_ORIGINS: 'x', LOG_LEVEL: 'silent' }, 'http', { pool: app, events: boss });
    expect(c.integration.stateSecret.equals(d.integration.stateSecret)).toBe(false); // dev fallback only
  });
});
