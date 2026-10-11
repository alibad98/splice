import { describe, expect, it } from 'vitest';
import { JobMeta } from '@slips/contracts';
import { Metric } from '../../ports/telemetry.js';
import { instrumentJob, jobMeta } from './jobs.js';
import { PinoTelemetry } from './pino-telemetry.js';
import { pollQueueStats } from './queue-stats.js';

function silent() {
  return new PinoTelemetry({ role: 'worker', level: 'silent' });
}

describe('instrumentJob', () => {
  it('runs the handler in a context with job_id, trace_id and store_id and counts completion', async () => {
    const t = silent();
    let seen: unknown;
    await instrumentJob(t, 'media.transcode', async () => {
      seen = t.context();
    })([{ id: 'job-1', data: { v: 1, trace_id: 'tr-1', store_id: 'st-1' } }]);
    expect(seen).toMatchObject({ job_id: 'job-1', trace_id: 'tr-1', store_id: 'st-1' });
    expect(t.registry.value(Metric.JobsProcessed, { queue: 'media.transcode', outcome: 'completed' })).toBe(1);
  });

  it('fails a job without trace_id and counts it', async () => {
    const t = silent();
    await expect(instrumentJob(t, 'batch.rollup', async () => undefined)([{ id: 'j', data: { v: 1 } }])).rejects.toThrow(/invalid job payload/);
    expect(t.registry.value(Metric.JobsProcessed, { queue: 'batch.rollup', outcome: 'failed' })).toBe(1);
  });

  it('counts webhook failures and rethrows so pg-boss retries', async () => {
    const t = silent();
    const wrapped = instrumentJob(t, 'integration.webhook', async () => {
      throw new Error('nope');
    });
    await expect(wrapped([{ id: 'j', data: { v: 1, trace_id: 't' } }])).rejects.toThrow('nope');
    expect(t.registry.value(Metric.WebhookFailures)).toBe(1);
  });
});

describe('pollQueueStats', () => {
  it('publishes depth, oldest age and dead-letter depth per queue', async () => {
    const t = silent();
    await pollQueueStats(
      {
        getQueues: async () => [
          { name: 'integration.webhook', queuedCount: 7, readyOldestSeconds: 42 },
          { name: 'integration.webhook.dead_letter', queuedCount: 2, readyOldestSeconds: null },
        ],
      },
      [{ name: 'integration.webhook', deadLetter: 'integration.webhook.dead_letter' }],
      t,
    );
    expect(t.registry.value(Metric.QueueDepth, { queue: 'integration.webhook' })).toBe(7);
    expect(t.registry.value(Metric.QueueOldestAgeSeconds, { queue: 'integration.webhook' })).toBe(42);
    expect(t.registry.value(Metric.DeadLetterDepth, { queue: 'integration.webhook' })).toBe(2);
  });
});

describe('jobMeta', () => {
  it('carries the request trace_id and store_id into the job payload', () => {
    const t = silent();
    const meta = t.withContext({ trace_id: 'trace-req', store_id: 'store-1' }, () => jobMeta(t));
    expect(meta).toEqual({ v: 1, trace_id: 'trace-req', store_id: 'store-1' });
    expect(JobMeta.safeParse(meta).success).toBe(true);
  });
  it('mints a trace_id outside a request and omits an unknown store_id', () => {
    const meta = jobMeta(silent());
    expect(meta.trace_id).toMatch(/^[0-9a-f]{32}$/);
    expect('store_id' in meta).toBe(false);
  });
});
