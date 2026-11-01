// Worker-side wiring of the catalog module: install/reinstall events queue a full sync; the job runs it (Story 2.1).
import type { EventName } from '@slips/contracts';
import { jobMeta, type JobHandler } from '../adapters/telemetry/jobs.js';
import type { EventHandlerRegistry } from '../events/dispatcher.js';
import { CATALOG_FULL_SYNC_QUEUE, FullSyncJob, type CatalogSync } from '../modules/catalog/catalog-sync.js';
import type { Telemetry } from '../ports/telemetry.js';
import type { JobSender } from './integration-jobs.js';

/** Window in which a second full-sync request for the same store is dropped (one run imports everything). */
export const FULL_SYNC_SINGLETON_SECONDS = 60;

export function catalogJobHandlers(sync: CatalogSync): Record<string, JobHandler> {
  return {
    [CATALOG_FULL_SYNC_QUEUE]: async (data) => {
      const job = FullSyncJob.parse(data);
      await sync.run(job.store_id, job.run_id);
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
  registry.on('catalog.sync.completed', 'catalog.log.sync.completed', async (event) => {
    telemetry.log.info('catalog event', { event: event.name, event_id: event.id, created: event.payload.created, updated: event.payload.updated });
  });
}
