// Worker-side wiring of the catalog module: install/reinstall events queue a full sync; the job runs it (Story 2.1).
import type { EventName } from '@slips/contracts';
import { isFinalAttempt, jobMeta, type JobHandler } from '../adapters/telemetry/jobs.js';
import type { EventHandlerRegistry } from '../events/dispatcher.js';
import { CATALOG_FULL_SYNC_QUEUE, FullSyncJob, type CatalogSync } from '../modules/catalog/catalog-sync.js';
import type { Telemetry } from '../ports/telemetry.js';
import type { JobSender } from './integration-jobs.js';

/** Window in which a second full-sync request for the same store is dropped (one run imports everything). */
export const FULL_SYNC_SINGLETON_SECONDS = 60;

export function catalogJobHandlers(sync: CatalogSync): Record<string, JobHandler> {
  return {
    [CATALOG_FULL_SYNC_QUEUE]: async (data, meta) => {
      const job = FullSyncJob.parse(data);
      // A retryable failure reads `failed` only on the last attempt (Story 2.3).
      await sync.run(job.store_id, job.run_id, { finalAttempt: isFinalAttempt(meta) });
    },
  };
}

/**
 * Queue a full sync when a store is installed or reinstalled. The job is sent on pg-boss's own connection (the app
 * role may only enqueue domain events); the event id is the run id, so a send repeated by a retried delivery resumes
 * or skips the same run instead of starting another.
 */
export function registerCatalogEventHandlers(registry: EventHandlerRegistry, boss: JobSender, telemetry: Telemetry): void {
  const triggers = ['integration.store.installed', 'integration.store.reinstalled'] as const satisfies readonly EventName[];
  for (const name of triggers) {
    registry.on(name, `catalog.full-sync.on.${name}`, async (event) => {
      const storeId = event.payload.store_id;
      const payload: FullSyncJob = { ...jobMeta(telemetry, storeId), store_id: storeId, run_id: event.id };
      const jobId = await boss.send(CATALOG_FULL_SYNC_QUEUE, payload, { singletonKey: storeId, singletonSeconds: FULL_SYNC_SINGLETON_SECONDS });
      // Null: a full sync for this store was queued within the window; that run imports everything.
      if (!jobId) telemetry.log.info('catalog full sync already queued', { event: name, event_id: event.id });
    });
  }
  // A merchant's manual sync (Story 2.3): the run is already recorded `queued` with this event id as its run id. Same
  // singleton key as install; a send that collides with a job queued in the current slot moves to the next slot instead
  // of being dropped, so the queued run is never left without a job.
  registry.on('catalog.sync.requested', 'catalog.full-sync.on.catalog.sync.requested', async (event) => {
    const storeId = event.payload.store_id;
    const payload: FullSyncJob = { ...jobMeta(telemetry, storeId), store_id: storeId, run_id: event.payload.run_id };
    const jobId = await boss.send(CATALOG_FULL_SYNC_QUEUE, payload, { singletonKey: storeId, singletonSeconds: FULL_SYNC_SINGLETON_SECONDS, singletonNextSlot: true });
    // Never leave the queued run without a job: fail the delivery so the event is retried.
    if (!jobId) throw new Error(`catalog full sync not queued for requested run ${event.payload.run_id}`);
  });
  registry.on('catalog.sync.completed', 'catalog.log.sync.completed', async (event) => {
    telemetry.log.info('catalog event', { event: event.name, event_id: event.id, created: event.payload.created, updated: event.payload.updated });
  });
}
