// Composition test for Story 1.9: embedded and direct-link sign-in, CSRF, idle expiry, admin guard. Live Postgres (real RLS role), fake platform.
import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EVENT_QUEUE, EmbeddedSession, SessionInfo } from '@slips/contracts';
import { ensureTestAppRole, runMigrations } from '@slips/db';
import { EnvelopeTokenCipher } from '../adapters/crypto/envelope-cipher.js';
import { PinoTelemetry } from '../adapters/telemetry/pino-telemetry.js';
import { grantEventPublishing } from '../events/queue-grants.js';
import { createHttpApp } from '../http.js';
import type { SessionConfig } from '../infra.module.js';
import { IntegrationService } from '../modules/integration/integration.service.js';
import { SessionService } from '../modules/session/session.service.js';
import { PlatformAuthRejectedError, PlatformUnavailableError, type CommercePlatform, type EmbeddedIdentity, type MerchantProfile, type TokenSet } from '../ports/commerce-platform.js';

const ADMIN_URL = 'postgres://slips:slips@127.0.0.1:5433/slips';
const APP_URL = 'postgres://slips_it_session:it_session_pw@127.0.0.1:5433/slips';
const SCHEMA = 'pgboss_session_test';
const lines: string[] = [];
const telemetry = new PinoTelemetry({ role: 'http', level: 'debug', stream: { write: (l: string) => void lines.push(l) } });
const cipher = new EnvelopeTokenCipher({ k1: randomBytes(32).toString('base64') }, 'k1');
const integration = { dashboardUrl: 'https://dash.example.com', stateSecret: randomBytes(32), secureCookies: true };
const sessionConfig: SessionConfig = { secret: randomBytes(32), secureCookies: true, embeddedTtlMs: 15 * 60_000, directMaxAgeMs: 30 * 24 * 3_600_000, idleMs: 12 * 3_600_000 };
const HOUR = 3_600_000;

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 4 });
let app: pg.Pool;
let boss: PgBoss;
let nest: INestApplication;
let base: string;

class FakePlatform implements CommercePlatform {
  readonly platform = 'salla' as const;
  /** host token -> what the platform says about it */
  hostTokens = new Map<string, EmbeddedIdentity>();
  unavailable = false;
  profile: MerchantProfile = this.newProfile();
  newProfile(): MerchantProfile {
    return { platformStoreId: `ses-${randomUUID()}`, storeName: 'Session Store', platformMerchantId: 'm-1', ownerName: 'Owner', domains: [] };
  }
  readonly auth = {
    buildAuthorizeUrl: (state: string) => `https://accounts.example/auth?state=${state}`,
    exchangeCode: async (): Promise<TokenSet> => ({ accessToken: 'AT-x', refreshToken: 'RT-x', expiresAt: new Date(Date.now() + HOUR), scopes: [] }),
    refresh: async (): Promise<TokenSet> => {
      throw new PlatformAuthRejectedError();
    },
    getMerchantProfile: async () => this.profile,
  };
  readonly embedded = {
    introspect: async (token: string): Promise<EmbeddedIdentity> => {
      if (this.unavailable) throw new PlatformUnavailableError('down');
      const id = this.hostTokens.get(token);
      if (!id) throw new PlatformAuthRejectedError();
      return id;
    },
    openUrl: () => 'https://s.example/embedded/app/app-1',
  };
  products = { list: async () => ({ items: [], hasMore: false }) };
  orders = { get: async () => ({ externalId: '1', status: 's', total: 1, currency: 'SAR', lines: [] }) };
  subscriptions = { list: async () => [] };
  webhooks = { verify: () => false, parse: () => null };
}
const platform = new FakePlatform();

const post = (path: string, init: RequestInit = {}) => fetch(`${base}${path}`, { method: 'POST', ...init });
const json = (body: unknown) => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function installStore(name = 'Session Store'): Promise<{ storeId: string; platformStoreId: string }> {
  const profile = { ...platform.newProfile(), storeName: name };
  const svc = new IntegrationService(app, platform, cipher, telemetry, boss, integration);
  const { storeId } = await svc.installFromTokens({ accessToken: 'AT-i', refreshToken: 'RT-i', expiresAt: new Date(Date.now() + HOUR), scopes: [] }, profile);
  return { storeId, platformStoreId: profile.platformStoreId };
}
const hostToken = (platformStoreId: string): string => {
  const t = `host-${randomUUID()}`;
  platform.hostTokens.set(t, { platformStoreId, platformUserId: 'u-1', expiresAt: new Date(Date.now() + 60_000) });
  return t;
};
async function embeddedBearer(name?: string) {
  const store = await installStore(name);
  const res = await post('/v1/session/embedded', json({ token: hostToken(store.platformStoreId) }));
  expect(res.status).toBe(200);
  return { ...store, bearer: EmbeddedSession.parse(await res.json()).access_token };
}
async function directCookie() {
  const store = await installStore('Direct Store');
  platform.profile = { ...platform.newProfile(), platformStoreId: store.platformStoreId, storeName: 'Direct Store' };
  const start = await fetch(`${base}/v1/integrations/salla/install`, { redirect: 'manual' });
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
  const nonce = /slips_oauth_state=([\w-]+)/.exec(start.headers.get('set-cookie')!)![1]!;
  const done = await fetch(`${base}/v1/integrations/salla/callback?code=ok&state=${encodeURIComponent(state)}`, { redirect: 'manual', headers: { cookie: `slips_oauth_state=${nonce}` } });
  const setCookies = done.headers.getSetCookie();
  const session = setCookies.find((c) => c.startsWith('slips_session='))!;
  return { ...store, done, setCookies, session, cookie: session.split(';')[0]! };
}

beforeAll(async () => {
  await runMigrations(admin);
  await ensureTestAppRole(admin, 'slips_it_session', 'it_session_pw');
  app = new pg.Pool({ connectionString: APP_URL, max: 6 });
  await admin.query(`drop schema if exists ${SCHEMA} cascade`);
  boss = new PgBoss({ connectionString: ADMIN_URL, schema: SCHEMA });
  await boss.start();
  await boss.createQueue(EVENT_QUEUE);
  await grantEventPublishing(admin, telemetry, EVENT_QUEUE, SCHEMA, 'slips_app');
  nest = await createHttpApp({ CORS_ORIGINS: 'http://localhost:3000', LOG_LEVEL: 'silent' }, { pool: app, events: boss, cipher, platform, integration, session: sessionConfig, telemetry });
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

describe('embedded sign-in', () => {
  it('introspects the host token, binds the session to that store and returns a short-lived bearer; no cookie is set', async () => {
    const store = await installStore('Embedded Store');
    const res = await post('/v1/session/embedded', json({ token: hostToken(store.platformStoreId) }));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('cache-control')).toBe('no-store');
    const session = EmbeddedSession.parse(await res.json());
    expect(session.token_type).toBe('Bearer');
    expect(session.expires_in).toBeLessThanOrEqual(900);
    const me = await fetch(`${base}/v1/session`, { headers: { authorization: `Bearer ${session.access_token}` } });
    const info = SessionInfo.parse(await me.json());
    expect(info).toMatchObject({ mode: 'embedded', store: { name: 'Embedded Store' }, connection: { state: 'connected', store_name: 'Embedded Store' } });
    expect(info.csrf_token).toBeUndefined();
    expect(info.open_in_platform_url).toBeUndefined();
    expect((await admin.query('select mode from merchant_sessions where store_id = $1', [store.storeId])).rows).toEqual([{ mode: 'embedded' }]);
  });

  it('takes the store only from introspection, never from the request body', async () => {
    const a = await installStore('Store A');
    const b = await installStore('Store B');
    const res = await post('/v1/session/embedded', json({ token: hostToken(a.platformStoreId), store_id: b.storeId, merchant_id: b.platformStoreId }));
    const bearer = EmbeddedSession.parse(await res.json()).access_token;
    const info = SessionInfo.parse(await (await fetch(`${base}/v1/session`, { headers: { authorization: `Bearer ${bearer}` } })).json());
    expect(info.store.name).toBe('Store A');
  });

  it('refuses an invalid or missing token with problem+json', async () => {
    const bad = await post('/v1/session/embedded', json({ token: 'nope' }));
    expect(bad.status).toBe(401);
    expect(bad.headers.get('content-type')).toMatch(/application\/problem\+json/);
    expect(await bad.json()).toMatchObject({ status: 401, code: 'invalid_token' });
    const missing = await post('/v1/session/embedded', json({}));
    expect(missing.status).toBe(400);
  });

  it('refuses an unknown store, a disconnected store and an uninstalled store with a reinstall message', async () => {
    const unknown = await post('/v1/session/embedded', json({ token: hostToken(`never-${randomUUID()}`) }));
    expect(unknown.status).toBe(403);
    const body = (await unknown.json()) as { code: string; detail: string };
    expect(body.code).toBe('store_not_installed');
    expect(body.detail).toMatch(/Reinstall/);
    for (const state of ['disconnected', 'uninstalled']) {
      const s = await installStore();
      await admin.query('update stores set lifecycle_state = $2 where id = $1', [s.storeId, state]);
      const res = await post('/v1/session/embedded', json({ token: hostToken(s.platformStoreId) }));
      expect(res.status).toBe(403);
      expect(((await res.json()) as { code: string }).code).toBe('store_not_installed');
    }
    expect((await admin.query("select count(*)::int as n from merchant_sessions where store_id in (select id from stores where lifecycle_state <> 'active')")).rows[0].n).toBe(0);
  });

  it('answers 503 when the platform can not be asked', async () => {
    platform.unavailable = true;
    try {
      const res = await post('/v1/session/embedded', json({ token: 'x' }));
      expect(res.status).toBe(503);
      expect(((await res.json()) as { code: string }).code).toBe('platform_unavailable');
    } finally {
      platform.unavailable = false;
    }
  });

  it('expires the bearer after its short lifetime', async () => {
    const { bearer } = await embeddedBearer();
    const sessions = nest.get(SessionService);
    sessions.now = () => Date.now() + 16 * 60_000;
    try {
      const res = await fetch(`${base}/v1/session`, { headers: { authorization: `Bearer ${bearer}` } });
      expect(res.status).toBe(401);
      expect(((await res.json()) as { code: string }).code).toBe('session_expired');
    } finally {
      sessions.now = Date.now;
    }
  });
});

describe('direct-link sign-in', () => {
  it('after Salla OAuth issues a first-party httpOnly Secure SameSite=Lax cookie; /v1/session returns a CSRF token and the Open in Salla link', async () => {
    const d = await directCookie();
    expect(d.done.headers.get('location')).toBe('https://dash.example.com/?connected=1');
    expect(d.session).toMatch(/^slips_session=[\w-]+\.[\w-]+\.[\w-]+; HttpOnly; SameSite=Lax; Path=\/; Max-Age=\d+; Secure$/);
    expect(d.session).not.toMatch(/SameSite=None/i);
    const info = SessionInfo.parse(await (await fetch(`${base}/v1/session`, { headers: { cookie: d.cookie } })).json());
    expect(info).toMatchObject({ mode: 'direct', connection: { state: 'connected' }, open_in_platform_url: 'https://s.example/embedded/app/app-1' });
    expect(info.csrf_token).toBeTruthy();
  });

  it('rejects a state-changing request without a valid CSRF token with problem+json 403, and accepts it with one', async () => {
    const d = await directCookie();
    const info = SessionInfo.parse(await (await fetch(`${base}/v1/session`, { headers: { cookie: d.cookie } })).json());
    for (const headers of [{ cookie: d.cookie }, { cookie: d.cookie, 'x-csrf-token': 'wrong' }]) {
      const res = await post('/v1/session/sign-out', { headers });
      expect(res.status).toBe(403);
      expect(res.headers.get('content-type')).toMatch(/application\/problem\+json/);
      expect(await res.json()).toMatchObject({ status: 403, code: 'csrf_invalid' });
    }
    const other = await directCookie();
    const otherCsrf = SessionInfo.parse(await (await fetch(`${base}/v1/session`, { headers: { cookie: other.cookie } })).json()).csrf_token!;
    expect((await post('/v1/session/sign-out', { headers: { cookie: d.cookie, 'x-csrf-token': otherCsrf } })).status).toBe(403);
    expect((await fetch(`${base}/v1/session`, { headers: { cookie: d.cookie } })).status).toBe(200); // still signed in
    const ok = await post('/v1/session/sign-out', { headers: { cookie: d.cookie, 'x-csrf-token': info.csrf_token! } });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('set-cookie')).toMatch(/^slips_session=; .*Max-Age=0/);
  });

  it('sign out ends the session at once (the old cookie no longer works)', async () => {
    const d = await directCookie();
    const csrf = SessionInfo.parse(await (await fetch(`${base}/v1/session`, { headers: { cookie: d.cookie } })).json()).csrf_token!;
    await post('/v1/session/sign-out', { headers: { cookie: d.cookie, 'x-csrf-token': csrf } });
    const after = await fetch(`${base}/v1/session`, { headers: { cookie: d.cookie } });
    expect(after.status).toBe(401);
    expect((await admin.query('select 1 from merchant_sessions where store_id = $1', [d.storeId])).rowCount).toBe(0);
  });

  it('embedded sign-out ends the bearer immediately', async () => {
    const { bearer } = await embeddedBearer();
    expect((await post('/v1/session/sign-out', { headers: { authorization: `Bearer ${bearer}` } })).status).toBe(204);
    expect((await fetch(`${base}/v1/session`, { headers: { authorization: `Bearer ${bearer}` } })).status).toBe(401);
  });

  it('expires a session idle for 12 hours, clears the cookie and says so; activity keeps it alive', async () => {
    const d = await directCookie();
    const sessions = nest.get(SessionService);
    try {
      sessions.now = () => Date.now() + 11 * HOUR;
      expect((await fetch(`${base}/v1/session`, { headers: { cookie: d.cookie } })).status).toBe(200); // touches last_seen at +11h
      sessions.now = () => Date.now() + 22 * HOUR; // 11h after the touch: still alive
      expect((await fetch(`${base}/v1/session`, { headers: { cookie: d.cookie } })).status).toBe(200);
      sessions.now = () => Date.now() + 22 * HOUR + 12 * HOUR + 60_000;
      const res = await fetch(`${base}/v1/session`, { headers: { cookie: d.cookie } });
      expect(res.status).toBe(401);
      expect(((await res.json()) as { code: string; detail: string }).code).toBe('session_expired');
      expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/);
    } finally {
      sessions.now = Date.now;
    }
  });
});

describe('credential separation and tenant scope', () => {
  it('a cookie value is not accepted as a bearer and a bearer is not accepted as a cookie', async () => {
    const d = await directCookie();
    const e = await embeddedBearer();
    expect((await fetch(`${base}/v1/session`, { headers: { authorization: `Bearer ${d.cookie.split('=')[1]}` } })).status).toBe(401);
    expect((await fetch(`${base}/v1/session`, { headers: { cookie: `slips_session=${e.bearer}` } })).status).toBe(401);
  });

  it('a session credential for store A does not open store B', async () => {
    const a = await embeddedBearer('A');
    const b = await installStore('B');
    const [, sessionId, secret] = a.bearer.split('.');
    const forged = `${b.storeId}.${sessionId}.${secret}`;
    expect((await fetch(`${base}/v1/session`, { headers: { authorization: `Bearer ${forged}` } })).status).toBe(401);
    expect((await fetch(`${base}/v1/session`, { headers: { authorization: 'Bearer garbage' } })).status).toBe(401);
    expect((await fetch(`${base}/v1/session`)).status).toBe(401);
  });

  it('keeps health public', async () => {
    expect([200, 503]).toContain((await fetch(`${base}/v1/health`)).status);
  });
});

describe('admin guard', () => {
  it('refuses merchant sessions (bearer and cookie), anonymous callers and the sign-in stub on /v1/admin', async () => {
    const e = await embeddedBearer();
    const d = await directCookie();
    for (const headers of [{ authorization: `Bearer ${e.bearer}` }, { cookie: d.cookie }, {}]) {
      const res = await fetch(`${base}/v1/admin/session`, { headers });
      expect(res.status).toBe(403);
      expect(res.headers.get('content-type')).toMatch(/application\/problem\+json/);
      expect(((await res.json()) as { code: string }).code).toBe('admin_forbidden');
    }
    const signIn = await post('/v1/admin/sign-in', json({ email: 'a@b.c', password: 'x' }));
    expect(signIn.status).toBe(403);
    expect(((await signIn.json()) as { code: string }).code).toBe('admin_forbidden');
  });

  it('every API response forbids framing', async () => {
    const res = await fetch(`${base}/v1/admin/session`);
    expect(res.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
  });
});

describe('security review fixes', () => {
  it('admin routes are not reachable by changing the path case (merchant bearer and cookie)', async () => {
    const e = await embeddedBearer();
    const d = await directCookie();
    for (const path of ['/V1/ADMIN/session', '/v1/Admin/session', '/V1/Admin/session', '/v1/ADMIN/session']) {
      for (const headers of [{ authorization: `Bearer ${e.bearer}` }, { cookie: d.cookie }]) {
        const res = await fetch(`${base}${path}`, { headers });
        expect([403, 404]).toContain(res.status);
        expect(await res.text()).not.toContain('"admin":true');
      }
    }
  });

  it('records the platform user on the embedded session row', async () => {
    const e = await embeddedBearer();
    expect((await admin.query('select platform_user_id from merchant_sessions where store_id = $1', [e.storeId])).rows).toEqual([{ platform_user_id: 'u-1' }]);
  });

  it('a callback without the state cookie, or with a mismatched state, fails closed and sets no session cookie', async () => {
    const start = await fetch(`${base}/v1/integrations/salla/install`, { redirect: 'manual' });
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const before = Number((await admin.query('select count(*) as n from merchant_sessions')).rows[0].n);
    for (const headers of [{}, { cookie: 'slips_oauth_state=not-the-nonce' }]) {
      const res = await fetch(`${base}/v1/integrations/salla/callback?code=ok&state=${encodeURIComponent(state)}`, { redirect: 'manual', headers });
      expect(res.headers.get('location')).toBe('https://dash.example.com/?install_error=state');
      expect(res.headers.getSetCookie().some((c) => c.startsWith('slips_session=') && !/Max-Age=0/.test(c))).toBe(false);
    }
    const forged = await fetch(`${base}/v1/integrations/salla/callback?code=ok&state=forged.123.abc`, { redirect: 'manual', headers: { cookie: 'slips_oauth_state=forged' } });
    expect(forged.headers.get('location')).toContain('install_error=state');
    expect(forged.headers.getSetCookie().some((c) => c.startsWith('slips_session=') && !/Max-Age=0/.test(c))).toBe(false);
    expect(Number((await admin.query('select count(*) as n from merchant_sessions')).rows[0].n)).toBe(before);
  });

  it('signing in again revokes the session named by an existing session cookie', async () => {
    const first = await directCookie();
    const start = await fetch(`${base}/v1/integrations/salla/install`, { redirect: 'manual' });
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const nonce = /slips_oauth_state=([\w-]+)/.exec(start.headers.get('set-cookie')!)![1]!;
    platform.profile = { ...platform.profile, platformStoreId: first.platformStoreId };
    const done = await fetch(`${base}/v1/integrations/salla/callback?code=ok&state=${encodeURIComponent(state)}`, { redirect: 'manual', headers: { cookie: `slips_oauth_state=${nonce}; ${first.cookie}` } });
    const fresh = done.headers.getSetCookie().find((c) => c.startsWith('slips_session=') && !/Max-Age=0/.test(c))!.split(';')[0]!;
    expect((await fetch(`${base}/v1/session`, { headers: { cookie: first.cookie } })).status).toBe(401);
    expect((await fetch(`${base}/v1/session`, { headers: { cookie: fresh } })).status).toBe(200);
  });
});

describe('secrets', () => {
  it('no session credential or host token reaches the logs', () => {
    const out = lines.join('\n');
    expect(out).not.toMatch(/host-[0-9a-f-]{36}/);
    expect(out).not.toMatch(/slips_session=/);
    expect(out).not.toMatch(/[0-9a-f-]{36}\.[0-9a-f-]{36}\.[\w-]{40,}/);
  });
});
