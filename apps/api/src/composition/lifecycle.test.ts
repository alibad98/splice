// Story 1.10 composition tests: live Postgres (non-owner RLS role, real pg-boss queue), the real Salla adapter with mocked HTTP.
import 'reflect-metadata';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EVENT_QUEUE } from '@slips/contracts';
import { ensureTestAppRole, runMigrations } from '@slips/db';
import { EnvelopeTokenCipher } from '../adapters/crypto/envelope-cipher.js';
import { SallaCommercePlatform } from '../adapters/salla/index.js';
import { PinoTelemetry } from '../adapters/telemetry/pino-telemetry.js';
import { createHttpApp } from '../http.js';
import type { INestApplication } from '@nestjs/common';
import { grantEventPublishing } from '../events/queue-grants.js';
import { StoreDisconnectedError } from '../modules/integration/errors.js';
import { IntegrationService } from '../modules/integration/integration.service.js';
import { sessionStoreData } from '../modules/session/session.lifecycle.js';
import { STORE_PURGE_QUEUE, WEBHOOK_SWEEP_QUEUE, integrationJobHandlers } from '../worker/integration-jobs.js';
import { MAX_ATTEMPTS, PARK_WINDOW_MS } from '../modules/integration/webhook-inbox.js';
import { GRACE_PERIOD_MS } from '../modules/integration/store-lifecycle.js';
import type { StoreDataLifecycle } from '../ports/store-data-lifecycle.js';

const ADMIN_URL = 'postgres://slips:slips@127.0.0.1:5433/slips';
const APP_URL = 'postgres://slips_it_life:it_life_pw@127.0.0.1:5433/slips';
const SCHEMA = 'pgboss_lifecycle_test';
const SECRET = 'whsec-lifecycle-test';
const lines: string[] = [];
const telemetry = new PinoTelemetry({ role: 'http', level: 'debug', stream: { write: (l: string) => void lines.push(l) } });
const cipher = new EnvelopeTokenCipher({ k1: randomBytes(32).toString('base64') }, 'k1');
const config = { dashboardUrl: 'https://dash.example.com', stateSecret: randomBytes(32), secureCookies: false };

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 4 });
let app: pg.Pool;
let boss: PgBoss;
let clock = Date.now();

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const userInfo = (merchantId: string, name = 'Shop') => json({ data: { id: 1, name: 'Owner', email: 'owner@example.com', merchant: { id: merchantId, name, domain: 'https://shop.example.com/' } } });
let userInfoFor: string | undefined;
const fetchMock = vi.fn(async () => userInfo(userInfoFor ?? 'none'));
const platform = new SallaCommercePlatform(
  { clientId: 'cid', clientSecret: 'csecret-xyz', redirectUri: 'https://api.example.com/cb', appId: 'app-1', webhookSecret: SECRET },
  telemetry,
  { fetch: fetchMock as unknown as typeof fetch, sleep: async () => undefined },
);

/** A module with several batches of data, to exercise resumable purge. */
class FakeModule implements StoreDataLifecycle {
  module = 'fake-content';
  rows = new Map<string, number>();
  purgeCalls = 0;
  onBatch?: (storeId: string) => Promise<void>;
  async purge({ storeId, batchLimit }: { storeId: string; batchLimit: number }) {
    this.purgeCalls++;
    await this.onBatch?.(storeId);
    const left = (this.rows.get(storeId) ?? 0) - batchLimit;
    this.rows.set(storeId, Math.max(left, 0));
    return { done: left <= 0 };
  }
}
const fake = new FakeModule();
let service: IntegrationService;

const sign = (body: string, key = SECRET) => createHmac('sha256', key).update(body).digest('hex');
const hook = (event: string, merchant: string, data: unknown = {}, extra: Record<string, unknown> = {}) => JSON.stringify({ event, merchant, created_at: new Date(clock).toISOString(), data, ...extra });
const send = (body: string, signature = sign(body)) => service.inbox.receiveAndProcess({ headers: { 'x-salla-signature': signature, 'x-salla-security-strategy': 'signature' }, rawBody: Buffer.from(body) });
const authorizeData = (tag: string) => ({ access_token: `AT-${tag}`, refresh_token: `RT-${tag}`, expires: Math.floor(clock / 1000) + 3600, scope: 'offline_access settings.read', token_type: 'bearer' });
const newMerchant = (): string => `life-${randomUUID()}`;
const jobsFor = async (storeId: string, name: string): Promise<number> =>
  Number((await admin.query<{ n: string }>(`select count(*) as n from ${SCHEMA}.job where name = $1 and data->>'store_id' = $2 and data->>'name' = $3`, [EVENT_QUEUE, storeId, name])).rows[0]!.n);
const storeRow = async (id: string) => (await admin.query('select * from stores where id = $1', [id])).rows[0];

/** Install a store through the Easy Mode path and return its id. */
async function installStore(merchant = newMerchant()) {
  userInfoFor = merchant;
  await send(hook('app.store.authorize', merchant, authorizeData(merchant)));
  await service.inbox.processDue();
  const { rows } = await admin.query<{ id: string }>("select id::text as id from store_locator where platform = 'salla' and platform_store_id = $1", [merchant]);
  return { merchant, storeId: rows[0]!.id };
}

beforeAll(async () => {
  await runMigrations(admin);
  await ensureTestAppRole(admin, 'slips_it_life', 'it_life_pw');
  app = new pg.Pool({ connectionString: APP_URL, max: 6 });
  await admin.query(`drop schema if exists ${SCHEMA} cascade`);
  boss = new PgBoss({ connectionString: ADMIN_URL, schema: SCHEMA });
  await boss.start();
  await boss.createQueue(EVENT_QUEUE);
  await grantEventPublishing(admin, telemetry, EVENT_QUEUE, SCHEMA, 'slips_app');
  service = new IntegrationService(app, platform, cipher, telemetry, boss, config, [sessionStoreData, fake]);
  service.now = () => clock;
});
afterAll(async () => {
  await boss?.stop({ graceful: false });
  await admin.query(`drop schema if exists ${SCHEMA} cascade`);
  await app?.end();
  await admin.end();
});

describe('webhook intake', () => {
  it('rejects an invalid signature with 401 and stores nothing', async () => {
    const merchant = newMerchant();
    const body = hook('app.uninstalled', merchant);
    expect((await send(body, sign(body, 'wrong-secret'))).status).toBe(401);
    expect((await send(body, 'not-hex')).status).toBe(401);
    expect((await service.inbox.receiveAndProcess({ headers: {}, rawBody: Buffer.from(body) })).status).toBe(401);
    expect((await admin.query('select 1 from webhook_inbox where platform_store_id = $1', [merchant])).rowCount).toBe(0);
  });

  it('stores only the canonical PII-free payload, hash, type, store id and event id; never logs the body', async () => {
    const merchant = newMerchant();
    const body = hook('app.installed', merchant, { customer: { email: 'shopper@example.com', mobile: '0555555555' }, app_name: 'Slips' });
    const res = await send(body);
    expect(res).toMatchObject({ status: 200, duplicate: false });
    const row = (await admin.query('select * from webhook_inbox where platform_store_id = $1', [merchant])).rows[0];
    expect(row).toMatchObject({ type: 'app.installed', platform: 'salla', platform_store_id: merchant });
    expect(row.body_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.event_id).toBeTruthy();
    expect(JSON.stringify(row)).not.toMatch(/shopper@example.com|0555555555/);
    expect(row.payload).toEqual({ event: 'app.installed', kind: 'installed' });
    expect(lines.join('\n')).not.toMatch(/shopper@example.com|0555555555|whsec/);
  });

  it('a duplicate event id yields one inbox row and runs the transition once', async () => {
    const { merchant, storeId } = await installStore();
    const body = hook('app.uninstalled', merchant);
    const [a, b] = await Promise.all([send(body), send(body)]);
    expect([a, b].filter((r) => r.status === 200 && !(r as { duplicate: boolean }).duplicate)).toHaveLength(1);
    await send(body);
    expect((await admin.query('select 1 from webhook_inbox where platform_store_id = $1 and type = $2', [merchant, 'app.uninstalled'])).rowCount).toBe(1);
    expect(await jobsFor(storeId, 'integration.store.uninstalled')).toBe(1);
  });

  it('parks an event for an unknown store, retries for 15 minutes, then dead-letters (accepted with 200, never 404)', async () => {
    const merchant = newMerchant();
    const res = await send(hook('app.uninstalled', merchant));
    expect(res.status).toBe(200);
    const status = async () => (await admin.query('select status, parked_since, last_error from webhook_inbox where platform_store_id = $1', [merchant])).rows[0];
    expect(await status()).toMatchObject({ status: 'pending', last_error: 'unknown_store' });
    clock += 5 * 60_000;
    await service.inbox.processDue();
    expect((await status()).status).toBe('pending');
    clock += PARK_WINDOW_MS;
    await service.inbox.processDue();
    expect(await status()).toMatchObject({ status: 'dead_lettered', last_error: 'unknown_store' });
    expect(await service.inbox.deadLetterCount()).toBeGreaterThanOrEqual(1);
  });

  it('an install event parked before the store exists is resolved once OAuth/authorize completes', async () => {
    const merchant = newMerchant();
    await send(hook('app.installed', merchant));
    expect((await admin.query('select status from webhook_inbox where platform_store_id = $1', [merchant])).rows[0].status).toBe('pending');
    userInfoFor = merchant;
    await send(hook('app.store.authorize', merchant, authorizeData('late')));
    clock += 61_000;
    await service.inbox.processDue(); // the parked install is retried first, then authorize creates the store
    clock += 61_000;
    await service.inbox.processDue();
    expect((await admin.query('select type, status from webhook_inbox where platform_store_id = $1 order by type', [merchant])).rows).toEqual([
      { type: 'app.installed', status: 'ignored' },
      { type: 'app.store.authorize', status: 'processed' },
    ]);
  });
});

describe('Easy Mode app.store.authorize', () => {
  it('installs through installFromTokens: encrypted tokens, epoch 1, secret cleared from the inbox', async () => {
    const { merchant, storeId } = await installStore();
    expect(await storeRow(storeId)).toMatchObject({ lifecycle_state: 'active', install_epoch: 1, platform_store_id: merchant });
    const tok = (await admin.query('select * from platform_tokens where store_id = $1', [storeId])).rows[0];
    expect(JSON.stringify(tok)).not.toMatch(/AT-life|RT-life/);
    const inbox = (await admin.query('select secret_enc, payload, status from webhook_inbox where platform_store_id = $1 and type = $2', [merchant, 'app.store.authorize'])).rows[0];
    expect(inbox.secret_enc).toBeNull();
    expect(inbox.status).toBe('processed');
    expect(JSON.stringify(inbox.payload)).not.toMatch(/AT-|RT-/);
    expect(await jobsFor(storeId, 'integration.store.installed')).toBe(1);
    expect(await service.isStoreActive({ platform: 'salla', platformStoreId: merchant })).toBe(true);
  });

  it('keeps the token pair encrypted in the inbox until processed', async () => {
    const merchant = newMerchant();
    userInfoFor = merchant;
    await send(hook('app.store.authorize', merchant, authorizeData('pending')));
    const row = (await admin.query('select secret_enc, payload from webhook_inbox where platform_store_id = $1', [merchant])).rows[0];
    expect(row.secret_enc).toMatch(/^v1\.k1\./);
    expect(JSON.stringify(row)).not.toMatch(/AT-pending|RT-pending/);
    await service.inbox.processDue();
  });

  it('retries when the platform is unavailable and dead-letters after the attempt limit', async () => {
    const merchant = newMerchant();
    fetchMock.mockImplementation(async () => new Response('{}', { status: 503 }));
    try {
      await send(hook('app.store.authorize', merchant, authorizeData('down')));
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        clock += 16 * 60_000;
        await service.inbox.processDue();
      }
    } finally {
      fetchMock.mockImplementation(async () => userInfo(userInfoFor ?? 'none'));
    }
    const row = (await admin.query('select status, attempts, secret_enc from webhook_inbox where platform_store_id = $1', [merchant])).rows[0];
    expect(row).toMatchObject({ status: 'dead_lettered', attempts: MAX_ATTEMPTS, secret_enc: null });
  });
});

describe('uninstall and reinstall', () => {
  it('uninstall: state, 30-day grace, event, tokens revoked, sessions gone, active check false', async () => {
    const { merchant, storeId } = await installStore();
    await admin.query(`insert into merchant_sessions (id, store_id, mode, secret_hash, expires_at) values ($1, $2, 'direct', 'h', now() + interval '1 day')`, [randomUUID(), storeId]);
    const res = await send(hook('app.uninstalled', merchant));
    expect(res.status).toBe(200);
    const store = await storeRow(storeId);
    expect(store.lifecycle_state).toBe('uninstalled');
    expect(new Date(store.grace_ends_at).getTime() - new Date(store.uninstalled_at).getTime()).toBe(GRACE_PERIOD_MS);
    expect(await jobsFor(storeId, 'integration.store.uninstalled')).toBe(1);
    expect((await admin.query('select 1 from platform_tokens where store_id = $1', [storeId])).rowCount).toBe(0);
    expect((await admin.query('select 1 from merchant_sessions where store_id = $1', [storeId])).rowCount).toBe(0);
    expect((await admin.query('select due_at from store_purge_schedule where id = $1', [storeId])).rowCount).toBe(1);
    expect(await service.isStoreActive({ platform: 'salla', platformStoreId: merchant })).toBe(false);
    expect(await service.isStoreActiveById(storeId)).toBe(false);
    await expect(service.getAccessToken(storeId)).rejects.toBeInstanceOf(StoreDisconnectedError);
    expect(await service.getConnection(storeId)).toMatchObject({ state: 'disconnected' });
    expect((await admin.query('select action from lifecycle_audit where platform_store_id = $1', [merchant])).rows).toEqual([{ action: 'uninstalled' }]);
  });

  it('an unknown or purged store is not active', async () => {
    expect(await service.isStoreActive({ platform: 'salla', platformStoreId: 'nope-' + randomUUID() })).toBe(false);
  });

  it('reinstall within the grace restores the same row, increments the epoch and emits reinstalled', async () => {
    const { merchant, storeId } = await installStore();
    await send(hook('app.uninstalled', merchant));
    clock += 10 * 24 * 3_600_000;
    userInfoFor = merchant;
    await send(hook('app.store.authorize', merchant, authorizeData('again')));
    await service.inbox.processDue();
    const store = await storeRow(storeId);
    expect(store).toMatchObject({ lifecycle_state: 'active', install_epoch: 2, grace_ends_at: null, uninstalled_at: null });
    expect((await admin.query('select count(*)::int as n from stores where platform_store_id = $1', [merchant])).rows[0].n).toBe(1);
    expect(await jobsFor(storeId, 'integration.store.reinstalled')).toBe(1);
    expect((await admin.query('select 1 from store_purge_schedule where id = $1', [storeId])).rowCount).toBe(0);
    expect(await service.getAccessToken(storeId)).toBe('AT-again');
    expect(await service.isStoreActive({ platformStoreId: merchant })).toBe(true);
  });

  it('an uninstall created before a reinstall does not uninstall the reinstalled store', async () => {
    const { merchant, storeId } = await installStore();
    await send(hook('app.uninstalled', merchant));
    expect((await storeRow(storeId)).lifecycle_state).toBe('uninstalled');
    clock += 60_000;
    userInfoFor = merchant;
    await send(hook('app.store.authorize', merchant, authorizeData('r2')));
    await service.inbox.processDue();
    expect((await storeRow(storeId)).install_epoch).toBe(2);
    // A redelivery created before the reinstall (a different body, so a different event id) belongs to the old epoch.
    const stale = hook('app.uninstalled', merchant, {}, { created_at: new Date(clock - 50_000).toISOString() });
    await send(stale);
    expect((await storeRow(storeId)).lifecycle_state).toBe('active');
    expect((await admin.query("select status from webhook_inbox where platform_store_id = $1 and type = 'app.uninstalled' order by received_at desc limit 1", [merchant])).rows[0].status).toBe('ignored');
  });
});

describe('out-of-order delivery', () => {
  it('an authorize created before the uninstall does not resurrect the uninstalled store', async () => {
    const { merchant, storeId } = await installStore();
    const earlier = new Date(clock - 30_000).toISOString();
    await send(hook('app.uninstalled', merchant));
    userInfoFor = merchant;
    await send(hook('app.store.authorize', merchant, authorizeData('old'), { created_at: earlier }));
    await service.inbox.processDue();
    expect((await storeRow(storeId)).lifecycle_state).toBe('uninstalled');
    expect((await admin.query("select status from webhook_inbox where platform_store_id = $1 and type = 'app.store.authorize' and occurred_at = $2", [merchant, earlier])).rows).toEqual([{ status: 'ignored' }]);
  });
});

describe('purge', () => {
  async function uninstalled() {
    const s = await installStore();
    fake.rows.set(s.storeId, 1200);
    await admin.query(`insert into token_access_log (store_id, purpose, outcome) values ($1, 'use', 'ok')`, [s.storeId]);
    await send(hook('app.uninstalled', s.merchant));
    return s;
  }

  it('is not due before the grace ends, then runs in batches, audits, deletes tenant data and sets purged', async () => {
    const { merchant, storeId } = await uninstalled();
    expect(await service.lifecycle.purge(storeId, 1)).toBe('not_due');
    expect(await service.lifecycle.duePurges()).not.toContainEqual({ storeId, installEpoch: 1 });
    clock += GRACE_PERIOD_MS + 1000;
    expect(await service.lifecycle.duePurges()).toContainEqual({ storeId, installEpoch: 1 });
    fake.purgeCalls = 0;
    expect(await service.lifecycle.purge(storeId, 1, 500)).toBe('completed');
    expect(fake.purgeCalls).toBe(3);
    expect(fake.rows.get(storeId)).toBe(0);
    expect(await storeRow(storeId)).toMatchObject({ lifecycle_state: 'purged', install_epoch: 1, name: 'purged' });
    for (const t of ['platform_tokens', 'merchant_accounts', 'token_access_log', 'merchant_sessions']) expect((await admin.query(`select 1 from ${t} where store_id = $1`, [storeId])).rowCount).toBe(0);
    expect((await admin.query('select 1 from webhook_inbox where platform_store_id = $1', [merchant])).rowCount).toBe(0);
    expect((await admin.query('select 1 from store_purge_schedule where id = $1', [storeId])).rowCount).toBe(0);
    const audit = (await admin.query('select action, details from lifecycle_audit where platform_store_id = $1 order by at', [merchant])).rows;
    expect(audit.map((a) => a.action)).toEqual(['uninstalled', 'purged']);
    expect(audit[1].details).toMatchObject({ batches: 5, modules: ['session', 'fake-content', 'integration'] });
    expect(await jobsFor(storeId, 'integration.store.purged')).toBe(1);
    expect((await admin.query('select status, completed_modules from store_data_jobs where store_id = $1', [storeId])).rows[0]).toMatchObject({ status: 'completed' });
    // Idempotent: running it again does nothing.
    expect(await service.lifecycle.purge(storeId, 1)).toBe('noop');
  });

  it('resumes where it stopped after a crash', async () => {
    const { storeId } = await uninstalled();
    clock += GRACE_PERIOD_MS + 1000;
    let batches = 0;
    fake.onBatch = async () => {
      if (++batches === 2) throw new Error('crash');
    };
    await expect(service.lifecycle.purge(storeId, 1, 500)).rejects.toThrow('crash');
    fake.onBatch = undefined;
    fake.purgeCalls = 0;
    expect(await service.lifecycle.purge(storeId, 1, 500)).toBe('completed');
    expect(fake.purgeCalls).toBe(2); // 1200 rows, 500 per batch, one batch already done
    const job = (await admin.query('select completed_modules from store_data_jobs where store_id = $1', [storeId])).rows[0];
    expect(job.completed_modules).toEqual(['session', 'fake-content', 'integration']);
  });

  it('a reinstall during a running purge stops further batches (stale-epoch work is dropped)', async () => {
    const { merchant, storeId } = await uninstalled();
    clock += GRACE_PERIOD_MS + 1000;
    // Batch 1 commits, then the job is interrupted before batch 2 (a worker crash mid-purge).
    let n = 0;
    fake.onBatch = async () => {
      if (++n === 2) throw new Error('interrupted');
    };
    await expect(service.lifecycle.purge(storeId, 1, 500)).rejects.toThrow('interrupted');
    fake.onBatch = undefined;
    // The merchant reinstalls while the purge is part-way.
    userInfoFor = merchant;
    await send(hook('app.store.authorize', merchant, authorizeData('during')));
    await service.inbox.processDue();
    expect((await storeRow(storeId)).install_epoch).toBe(2);
    // The redelivered purge job still carries epoch 1: it is dropped without touching any module.
    fake.purgeCalls = 0;
    expect(await service.lifecycle.purge(storeId, 1, 500)).toBe('stale');
    expect(fake.purgeCalls).toBe(0);
    expect((await storeRow(storeId)).lifecycle_state).toBe('active');
  });

  it('aborts the running job when state or epoch changed under it', async () => {
    const { merchant, storeId } = await uninstalled();
    clock += GRACE_PERIOD_MS + 1000;
    let n = 0;
    fake.onBatch = async () => {
      if (++n === 2) {
        // Simulate the reinstall committing between this batch and the next by running it on the admin connection.
        await admin.query("update stores set lifecycle_state = 'active', install_epoch = 2 where id = $1", [storeId]);
      }
    };
    // The update on stores blocks on the row lock held by this transaction only if it touched the row; it did not, so it commits.
    expect(await service.lifecycle.purge(storeId, 1, 500)).toBe('aborted');
    fake.onBatch = undefined;
    expect((await admin.query('select status, abort_reason from store_data_jobs where store_id = $1', [storeId])).rows[0]).toMatchObject({ status: 'aborted', abort_reason: 'epoch_changed' });
    expect((await storeRow(storeId)).lifecycle_state).toBe('active');
    void merchant;
  });

  it('a reinstall after the purge starts a fresh epoch on the same row', async () => {
    const { merchant, storeId } = await uninstalled();
    clock += GRACE_PERIOD_MS + 1000;
    await service.lifecycle.purge(storeId, 1);
    userInfoFor = merchant;
    await send(hook('app.store.authorize', merchant, authorizeData('fresh')));
    await service.inbox.processDue();
    expect(await storeRow(storeId)).toMatchObject({ lifecycle_state: 'active', install_epoch: 2, purged_at: null });
    expect(await jobsFor(storeId, 'integration.store.installed')).toBe(2);
  });
});

describe('POST /v1/webhooks/salla', () => {
  let nest: INestApplication;
  let base = '';
  beforeAll(async () => {
    nest = await createHttpApp(
      { CORS_ORIGINS: 'http://localhost:3000', LOG_LEVEL: 'silent' },
      { pool: app, events: boss, cipher, platform, integration: config, telemetry, session: { secret: randomBytes(32), secureCookies: false, embeddedTtlMs: 60_000, directMaxAgeMs: 60_000, idleMs: 60_000 } },
    );
    await nest.listen(0);
    base = (await nest.getUrl()).replace('[::1]', 'localhost');
  });
  afterAll(async () => {
    await nest?.close();
  });
  const post = (body: string, headers: Record<string, string>) => fetch(`${base}/v1/webhooks/salla`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

  it('verifies over the raw body: 401 for a bad or missing signature (nothing stored), 200 for a valid one, even for an unknown store', async () => {
    const merchant = newMerchant();
    // Whitespace the JSON parser would normalise away: only the raw bytes verify.
    const body = `{ "event" : "app.uninstalled",  "merchant": "${merchant}" }`;
    const ok = { 'x-salla-signature': sign(body), 'x-salla-security-strategy': 'signature' };
    expect((await post(body, { 'x-salla-signature': sign(body, 'bad'), 'x-salla-security-strategy': 'signature' })).status).toBe(401);
    expect((await post(body, {})).status).toBe(401);
    expect((await admin.query('select 1 from webhook_inbox where platform_store_id = $1', [merchant])).rowCount).toBe(0);
    expect((await post(JSON.stringify(JSON.parse(body)), ok)).status).toBe(401); // re-serialised body no longer matches
    const res = await post(body, ok);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect((await admin.query('select status from webhook_inbox where platform_store_id = $1', [merchant])).rows).toEqual([{ status: 'pending' }]);
    expect(lines.join('\n')).not.toContain(sign(body));
  });

  it('answers 400 for a signed body that is not an event, and never 404 for a store it does not know', async () => {
    const junk = '{"hello":"world"}';
    expect((await post(junk, { 'x-salla-signature': sign(junk), 'x-salla-security-strategy': 'signature' })).status).toBe(400);
    const unknown = hook('app.installed', newMerchant());
    expect((await post(unknown, { 'x-salla-signature': sign(unknown), 'x-salla-security-strategy': 'signature' })).status).toBe(200);
  });
});

describe('worker jobs', () => {
  it('the sweep finishes pending webhooks and queues a purge for each store whose grace ended; the purge job completes it', async () => {
    const { merchant, storeId } = await installStore();
    const sent: Array<{ queue: string; data: Record<string, unknown> }> = [];
    const handlers = integrationJobHandlers(service, telemetry, { send: async (queue, data) => (sent.push({ queue, data: data as Record<string, unknown> }), 'id') });
    await send(hook('app.uninstalled', merchant, {}, { created_at: new Date(clock + 1000).toISOString() }));
    clock += GRACE_PERIOD_MS + 60_000;
    await handlers[WEBHOOK_SWEEP_QUEUE]!({ v: 1, trace_id: 't' }, { id: 'j', data: {} });
    const queued = sent.find((s) => s.queue === STORE_PURGE_QUEUE && s.data.store_id === storeId);
    expect(queued?.data).toMatchObject({ v: 1, store_id: storeId, install_epoch: expect.any(Number) });
    await handlers[STORE_PURGE_QUEUE]!(queued!.data, { id: 'j2', data: queued!.data });
    expect((await storeRow(storeId)).lifecycle_state).toBe('purged');
  });
});
