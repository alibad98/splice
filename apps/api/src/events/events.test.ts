// Runs against the live test Postgres: real pg-boss, real transactions, real ledger table.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EVENT_QUEUE } from '@slips/contracts';
import { runMigrations } from '@slips/db';
import { PinoTelemetry } from '../adapters/telemetry/pino-telemetry.js';
import { Metric } from '../ports/telemetry.js';
import { QUEUES } from '../worker/queues.js';
import { registerQueues } from '../worker/worker.js';
import { EventHandlerRegistry, eventDispatcher } from './dispatcher.js';
import { publishEvent, uuidv7 } from './outbox.js';

const URL = 'postgres://slips:slips@127.0.0.1:5433/slips';
const SCHEMA = 'pgboss_events_test';
const STORE = '11111111-1111-4111-8111-111111111111';
const telemetry = new PinoTelemetry({ role: 'worker', level: 'silent' });
const pool = new pg.Pool({ connectionString: URL, max: 4 });
let boss: PgBoss;

const jobCount = async (): Promise<number> =>
  Number((await pool.query<{ n: string }>(`select count(*) as n from ${SCHEMA}.job where name = $1`, [EVENT_QUEUE])).rows[0]!.n);
const payload = { v: 1 as const, store_id: STORE, install_epoch: 1 };

async function inTx(fn: (c: pg.PoolClient) => Promise<void>, commit: boolean): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await fn(c);
    await c.query(commit ? 'COMMIT' : 'ROLLBACK');
  } finally {
    c.release();
  }
}

beforeAll(async () => {
  await runMigrations(pool);
  await pool.query(`drop schema if exists ${SCHEMA} cascade`);
  boss = new PgBoss({ connectionString: URL, schema: SCHEMA });
  await boss.start();
  await boss.createQueue(EVENT_QUEUE);
});

afterAll(async () => {
  await boss?.stop({ graceful: false });
  await pool.query(`drop schema if exists ${SCHEMA} cascade`);
  await pool.end();
});

describe('transactional outbox', () => {
  it('commit leaves exactly one job; rollback leaves none', async () => {
    const before = await jobCount();
    await inTx(async (c) => void (await publishEvent(c, boss, telemetry, 'integration.store.installed', payload)), false);
    expect(await jobCount()).toBe(before);
    let id = '';
    await inTx(async (c) => void (id = await publishEvent(c, boss, telemetry, 'integration.store.installed', payload, { storeId: STORE })), true);
    expect(await jobCount()).toBe(before + 1);
    const row = (await pool.query<{ id: string; data: { name: string; store_id: string; v: number } }>(`select id, data from ${SCHEMA}.job where id = $1`, [id])).rows[0]!;
    expect(row.data).toMatchObject({ name: 'integration.store.installed', store_id: STORE, v: 1 });
  });

  it('is invisible before commit', async () => {
    const before = await jobCount();
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await publishEvent(c, boss, telemetry, 'integration.store.installed', payload);
      expect(await jobCount()).toBe(before);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
    expect(await jobCount()).toBe(before + 1);
  });

  it('rejects a payload that fails its schema and enqueues nothing', async () => {
    const before = await jobCount();
    await expect(inTx(async (c) => void (await publishEvent(c, boss, telemetry, 'integration.store.installed', { ...payload, v: 2 } as never)), true)).rejects.toThrow();
    expect(await jobCount()).toBe(before);
  });

  it('generates time-ordered UUIDv7 ids', () => {
    const a = uuidv7(1_000);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidv7(2_000) > a).toBe(true);
  });
});

describe('event dispatcher', () => {
  const envelope = (event_id = uuidv7(), extra: object = {}) => ({ v: 1, trace_id: 't', store_id: STORE, event_id, name: 'integration.store.installed', occurred_at: new Date().toISOString(), payload, ...extra });
  const job = { id: 'j', data: {} };

  it('applies the handler effect once when the same event id is delivered twice', async () => {
    let runs = 0;
    const registry = new EventHandlerRegistry().on('integration.store.installed', 'test.once', async () => void runs++);
    const dispatch = eventDispatcher(pool, registry);
    const e = envelope();
    await dispatch(e, job);
    await dispatch(e, job);
    expect(runs).toBe(1);
    await dispatch(envelope(), job);
    expect(runs).toBe(2);
  });

  it('rolls the ledger row back with a failing handler, so the retry runs it again', async () => {
    let attempts = 0;
    const registry = new EventHandlerRegistry().on('integration.store.installed', 'test.flaky', async () => {
      if (++attempts === 1) throw new Error('boom');
    });
    const dispatch = eventDispatcher(pool, registry);
    const e = envelope();
    await expect(dispatch(e, job)).rejects.toThrow('boom');
    await dispatch(e, job);
    expect(attempts).toBe(2);
  });

  it('runs tenant events in the store context and rejects unknown events and bad payloads', async () => {
    let seen: string | undefined;
    const registry = new EventHandlerRegistry().on('integration.store.installed', 'test.ctx', async (_e, tx) => {
      seen = ((await tx.query("select current_setting('app.store_id') as s")).rows[0] as { s: string }).s;
    });
    const dispatch = eventDispatcher(pool, registry);
    await dispatch(envelope(), job);
    expect(seen).toBe(STORE);
    await expect(dispatch(envelope(uuidv7(), { name: 'integration.store.exploded' }), job)).rejects.toThrow(/unknown domain event/);
    await expect(dispatch(envelope(uuidv7(), { payload: { v: 2 } }), job)).rejects.toThrow();
  });

  it('rejects duplicate handler ids', () => {
    const r = new EventHandlerRegistry().on('integration.store.installed', 'x', async () => undefined);
    expect(() => r.on('integration.store.installed', 'x', async () => undefined)).toThrow(/duplicate/);
  });

  it('delivers a published event end to end through pg-boss and counts it in the job metrics', async () => {
    const t = new PinoTelemetry({ role: 'worker', level: 'silent' });
    const got: string[] = [];
    const registry = new EventHandlerRegistry().on('integration.store.installed', 'test.e2e', async (e) => void got.push(e.id));
    const id = await (async () => {
      let out = '';
      await inTx(async (c) => void (out = await publishEvent(c, boss, t, 'integration.store.installed', payload, { storeId: STORE })), true);
      return out;
    })();
    await registerQueues(boss, t, QUEUES.filter((q) => q.name === EVENT_QUEUE), { [EVENT_QUEUE]: eventDispatcher(pool, registry) });
    const until = Date.now() + 15_000;
    while (!got.includes(id) && Date.now() < until) await new Promise((r) => setTimeout(r, 200));
    expect(got).toContain(id);
    expect(t.registry.value(Metric.JobsProcessed, { queue: EVENT_QUEUE, outcome: 'completed' })).toBeGreaterThan(0);
  }, 30_000);
});

describe('the http role never consumes events', () => {
  it('calls pg-boss work/fetch/subscribe only under src/worker', () => {
    const root = join(import.meta.dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name) && !p.includes('/worker/') && /\.(work|fetch|subscribe)\(/.test(readFileSync(p, 'utf8')) && /pg-boss|boss\./.test(readFileSync(p, 'utf8'))) offenders.push(p);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
