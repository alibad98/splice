import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EVENT_CATALOG } from '@slips/contracts';
import { EventHandlerRegistry } from '../events/dispatcher.js';
import { PinoTelemetry } from '../adapters/telemetry/pino-telemetry.js';
import { parseEnv } from '../config/env.js';
import { startWorker } from './worker.js';
import { WEBHOOK_SWEEP_QUEUE, SWEEP_CRON } from './integration-jobs.js';
import { CATALOG_RECONCILE_SCHEDULE_QUEUE, RECONCILE_CRON } from '../modules/catalog/catalog-reconcile.js';

const fakes = vi.hoisted(() => ({
  boss: {
    on: vi.fn(), start: vi.fn(), stop: vi.fn(),
    createQueue: vi.fn(), work: vi.fn(), schedule: vi.fn(),
  },
  server: { once: vi.fn(), listen: vi.fn((_port: number, ready: () => void) => ready()), close: vi.fn() },
}));
vi.mock('node:http', () => ({ createServer: () => fakes.server }));
vi.mock('pg', () => ({ default: { Pool: class { on = vi.fn(); end = vi.fn(); } } }));
vi.mock('pg-boss', () => ({ PgBoss: class { constructor() { return fakes.boss; } } }));
vi.mock('../events/queue-grants.js', () => ({ grantEventPublishing: vi.fn() }));
vi.mock('../adapters/telemetry/queue-stats.js', () => ({ startQueueStatsPoller: () => () => {} }));
vi.mock('../http.js', () => ({
  buildInfra: () => ({
    telemetry: new PinoTelemetry({ role: 'worker', level: 'silent' }),
    pool: { end: vi.fn() }, probe: { close: vi.fn() }, metrics: { render: () => '' },
    platform: {}, cipher: {}, storage: {}, scanner: {}, integration: {}, media: {},
    fetcher: {}, processor: {}, lifecycles: [], installListeners: [],
  }),
  ensureDevBucket: vi.fn(),
}));

const signals = { SIGINT: process.listeners('SIGINT'), SIGTERM: process.listeners('SIGTERM') };
afterEach(() => {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    for (const handler of process.listeners(signal)) if (!signals[signal].includes(handler)) process.removeListener(signal, handler);
  }
  vi.clearAllMocks();
});

describe('worker startup wiring', () => {
  it('registers handlers for every catalogued event and both recurring jobs', async () => {
    const registry = new EventHandlerRegistry();
    const env = parseEnv({ ROLE: 'worker', NODE_ENV: 'test', DATABASE_URL: 'postgres://test:test@127.0.0.1/test' });
    await startWorker(env, undefined, undefined, registry);
    for (const name of Object.keys(EVENT_CATALOG)) expect(registry.handlersFor(name).length, name).toBeGreaterThan(0);
    expect(fakes.boss.schedule).toHaveBeenCalledWith(WEBHOOK_SWEEP_QUEUE, SWEEP_CRON, { v: 1, trace_id: 'schedule' });
    expect(fakes.boss.schedule).toHaveBeenCalledWith(CATALOG_RECONCILE_SCHEDULE_QUEUE, RECONCILE_CRON, { v: 1, trace_id: 'schedule' });
  });

  it('does not register recurring jobs on a media-only worker', async () => {
    const env = parseEnv({ ROLE: 'worker', NODE_ENV: 'test', DATABASE_URL: 'postgres://test:test@127.0.0.1/test', WORKER_QUEUES: 'media' });
    await startWorker(env);
    expect(fakes.boss.schedule).not.toHaveBeenCalled();
    expect(fakes.boss.work.mock.calls.map(call => call[0])).toEqual(['media.asset.inspect', 'media.asset.import', 'media.asset.process']);
  });
});
