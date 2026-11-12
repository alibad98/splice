import { MANIFEST_DELIVERY_QUEUE, type ManifestDelivery } from '../modules/publishing/manifest-delivery.js';
// Worker-side wiring of the publishing module (Story 4.4 pilot slice): every event in `MANIFEST_INPUTS` enqueues one
// debounced, single-flight store manifest compile inside its delivery transaction; the job compiles it.
import type { Pool } from 'pg';
import { isFinalAttempt, jobMeta, type JobHandler } from '../adapters/telemetry/jobs.js';
import type { EventHandlerRegistry } from '../events/dispatcher.js';
import type { TxQueryable } from '../events/outbox.js';
import { MANIFEST_COMPILE_QUEUE, MANIFEST_COMPILE_SINGLETON_SECONDS, MANIFEST_INPUTS, ManifestCompileJob } from '../modules/publishing/manifest-inputs.js';
import type { StoreManifestCompiler } from '../modules/publishing/store-manifest.js';
import type { Telemetry } from '../ports/telemetry.js';
import type { JobSender } from './integration-jobs.js';
import { storeScopedJob } from './store-job.js';

/**
 * Enqueue one compile for the store on `tx`, so the job exists exactly when the transaction commits. Single-flight and
 * debounced per store: one job per `MANIFEST_COMPILE_SINGLETON_SECONDS` slot (singleton key = store id); a trigger that
 * finds the current slot taken takes the next slot, and one that finds both taken is already covered by the queued
 * compile, which reads the committed state when it runs. Returns the job id, or null when it was covered.
 */
export async function enqueueManifestCompile(boss: JobSender, tx: TxQueryable, telemetry: Telemetry, storeId: string, occurredAt: string): Promise<string | null> {
  const payload: ManifestCompileJob = { ...jobMeta(telemetry, storeId), store_id: storeId, occurred_at: occurredAt };
  return boss.send(MANIFEST_COMPILE_QUEUE, payload, {
    singletonKey: storeId,
    singletonSeconds: MANIFEST_COMPILE_SINGLETON_SECONDS,
    singletonNextSlot: true,
    db: { executeSql: (text: string, values?: unknown[]) => tx.query(text, values) },
  });
}

/** One handler per `MANIFEST_INPUTS` event (the delivery ledger dedupes redelivered event ids). */
export function registerPublishingEventHandlers(registry: EventHandlerRegistry, boss: JobSender, telemetry: Telemetry): void {
  for (const name of MANIFEST_INPUTS) {
    registry.on(name, `publishing.manifest.compile.on.${name}`, async (event, tx) => {
      const storeId = event.payload.store_id;
      const jobId = await enqueueManifestCompile(boss, tx, telemetry, storeId, event.occurredAt ?? new Date().toISOString());
      if (!jobId) telemetry.log.info('store manifest compile already queued', { event: name, event_id: event.id, store_id: storeId });
    });
  }
}

/** The compile job: runs in the store's context (one transaction), see `StoreManifestCompiler`. */
export function publishingJobHandlers(pool: Pool, compiler: Pick<StoreManifestCompiler, 'compile'>, delivery?: Pick<ManifestDelivery, 'deliver'>): Record<string, JobHandler> {
  return {
    ...(delivery ? { [MANIFEST_DELIVERY_QUEUE]: async (data: unknown, job: Parameters<JobHandler>[1]) => delivery.deliver(data, isFinalAttempt(job)) } : {}),
    [MANIFEST_COMPILE_QUEUE]: storeScopedJob(pool, async (data) => {
      const job = ManifestCompileJob.parse(data);
      await compiler.compile(job.store_id, { occurredAt: new Date(job.occurred_at) });
    }),
  };
}
