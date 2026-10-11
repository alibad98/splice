import { randomBytes } from 'node:crypto';
import { JobMeta } from '@slips/contracts';
import { Metric, type Telemetry } from '../../ports/telemetry.js';

/** The slice of a pg-boss job the wrapper needs. */
export interface JobLike {
  id: string;
  data: unknown;
}

export type JobHandler = (data: unknown, job: JobLike) => Promise<void>;

const WEBHOOK_QUEUE = /^integration\.webhook/;

/**
 * Wrap a job handler for pg-boss `work`: validate the `JobMeta` envelope, run inside a context that
 * carries `job_id`, `trace_id`, `store_id`, log, and count outcomes per queue. Errors are rethrown so
 * pg-boss retries and finally dead-letters.
 */
export function instrumentJob(telemetry: Telemetry, queue: string, handler: JobHandler) {
  return async (jobs: readonly JobLike[]): Promise<void> => {
    for (const job of jobs) {
      const meta = JobMeta.safeParse(job.data);
      await telemetry.withContext(
        { job_id: job.id, ...(meta.success ? { trace_id: meta.data.trace_id, store_id: meta.data.store_id } : {}) },
        async () => {
          const started = Date.now();
          try {
            if (!meta.success) throw new Error(`invalid job payload for ${queue}: ${meta.error.issues.map((i) => i.path.join('.')).join(', ')}`);
            await handler(job.data, job);
            telemetry.counter(Metric.JobsProcessed, { queue, outcome: 'completed' });
            telemetry.log.info('job completed', { queue, duration_ms: Date.now() - started });
          } catch (err) {
            telemetry.counter(Metric.JobsProcessed, { queue, outcome: 'failed' });
            if (WEBHOOK_QUEUE.test(queue)) telemetry.counter(Metric.WebhookFailures);
            telemetry.captureError(err, { queue, duration_ms: Date.now() - started });
            throw err;
          }
        },
      );
    }
  };
}

/**
 * Envelope for a job payload, built at enqueue time from the ambient context so one trace spans
 * request and job. Pass an explicit `storeId` when the context has none. Spread it into the payload.
 */
export function jobMeta(telemetry: Telemetry, storeId?: string): JobMeta {
  const ctx = telemetry.context();
  const store_id = storeId ?? ctx.store_id;
  return { v: 1, trace_id: ctx.trace_id ?? randomBytes(16).toString('hex'), ...(store_id ? { store_id } : {}) };
}
