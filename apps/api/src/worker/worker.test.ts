import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { HealthResponse } from '@slips/contracts';
import { PinoTelemetry } from '../adapters/telemetry/pino-telemetry.js';
import { Metric } from '../ports/telemetry.js';
import { GROUP_POLICY, deadLetterName, queueOptions } from './queues.js';
import { registerQueues, startWorkerHttp } from './worker.js';

describe('registerQueues', () => {
  it('creates each queue with its group policy and a dead-letter queue, and attaches a handler', async () => {
    const created: Array<[string, Record<string, unknown> | undefined]> = [];
    const worked: Array<[string, number]> = [];
    const boss = {
      createQueue: async (name: string, options?: Record<string, unknown>) => void created.push([name, options]),
      work: async (name: string, o: { localConcurrency: number; includeMetadata: true }) => void worked.push([name, o.includeMetadata ? o.localConcurrency : -1]),
    };
    const t = new PinoTelemetry({ role: 'worker', level: 'silent' });
    await registerQueues(boss, t, [{ name: 'media.transcode', group: 'media' }, { name: 'integration.webhook', group: 'realtime' }], {
      'media.transcode': async () => undefined,
      'integration.webhook': async () => undefined,
    });
    expect(created).toContainEqual(['media.transcode.dead_letter', undefined]);
    expect(created).toContainEqual(['media.transcode', { ...queueOptions('media'), deadLetter: deadLetterName('media.transcode') }]);
    expect(created.find(([n]) => n === 'integration.webhook')?.[1]).toMatchObject({ retryLimit: 4 });
    expect(worked).toEqual([['media.transcode', GROUP_POLICY.media.concurrency], ['integration.webhook', GROUP_POLICY.realtime.concurrency]]);
  });

  it('passes the job retry metadata to the handler so the last attempt can be told', async () => {
    let work: ((jobs: Array<{ id: string; data: unknown; retryCount: number; retryLimit: number }>) => Promise<void>) | undefined;
    const boss = {
      createQueue: async () => undefined,
      work: async (_n: string, _o: unknown, h: typeof work) => void (work = h),
    };
    const seen: Array<{ retryCount?: number; retryLimit?: number }> = [];
    const t = new PinoTelemetry({ role: 'worker', level: 'silent' });
    await registerQueues(boss, t, [{ name: 'batch.rollup', group: 'batch' }], {
      'batch.rollup': async (_data, job) => void seen.push({ retryCount: job.retryCount, retryLimit: job.retryLimit }),
    });
    const data = { v: 1, trace_id: 't', store_id: '00000000-0000-4000-8000-000000000001' };
    await work!([{ id: 'j1', data, retryCount: 4, retryLimit: 4 }]);
    expect(seen).toEqual([{ retryCount: 4, retryLimit: 4 }]);
  });

  it('fails boot for a queue with no handler', async () => {
    const boss = { createQueue: async () => undefined, work: async () => undefined };
    const t = new PinoTelemetry({ role: 'worker', level: 'silent' });
    await expect(registerQueues(boss, t, [{ name: 'batch.rollup', group: 'batch' }], {})).rejects.toThrow(/batch\.rollup/);
  });
});

describe('worker liveness server', () => {
  it('reports ok / degraded from the database probe and guards /metrics', async () => {
    let up = true;
    const t = new PinoTelemetry({ role: 'worker', level: 'silent' });
    const server = await startWorkerHttp({
      port: 0,
      probe: { isReachable: async () => up, close: async () => undefined },
      telemetry: t,
      version: '1.2.3',
      render: () => t.registry.render(),
      metricsToken: 'worker-metrics-token-1',
    });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const ok = await fetch(`${base}/health`);
      expect(ok.status).toBe(200);
      expect(HealthResponse.parse(await ok.json())).toMatchObject({ role: 'worker', status: 'ok', version: '1.2.3' });
      expect(t.registry.value(Metric.WorkerUp)).toBe(1);
      up = false;
      const down = await fetch(`${base}/health`);
      expect(down.status).toBe(503);
      expect(t.registry.value(Metric.WorkerUp)).toBe(0);
      expect((await fetch(`${base}/metrics`)).status).toBe(401);
      expect((await fetch(`${base}/metrics`, { headers: { authorization: 'Bearer worker-metrics-token-1' } })).status).toBe(200);
    } finally {
      server.close();
    }
  });
});
