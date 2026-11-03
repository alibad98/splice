// Worker-side wiring of the catalog module: install/reinstall events queue a full sync; the job runs it (Story 2.1).
// A daily cron fans out one reconcile job per active store (Story 2.6).
import { randomBytes } from 'node:crypto';
import type { EventName } from '@slips/contracts';
import { isFinalAttempt, jobMeta, type JobHandler } from '../adapters/telemetry/jobs.js';
import type { EventHandlerRegistry } from '../events/dispatcher.js';
import { CATALOG_FULL_SYNC_QUEUE, FullSyncJob, type CatalogSync } from '../modules/catalog/catalog-sync.js';
import { CATALOG_RECONCILE_QUEUE, CATALOG_RECONCILE_SCHEDULE_QUEUE, ReconcileJob, reconcileOffsetSeconds, type CatalogReconcile } from '../modules/catalog/catalog-reconcile.js';
import type { Telemetry } from '../ports/telemetry.js';
import type { JobSender } from './integration-jobs.js';

/** Window in which a second full-sync request for the same store is dropped (one run imports everything). */
export const FULL_SYNC_SINGLETON_SECONDS = 60;

/** Stores listed per page by the reconcile fan-out. */
export const RECONCILE_FANOUT_PAGE = 500;
/** One reconcile per store per UTC day: the singleton window that goes with the day-keyed singleton key. */
export const RECONCILE_SINGLETON_SECONDS = 86_400;
/**
 * How long one reconcile attempt may run before pg-boss expires it (default 15 min). An attempt restarts from page 1, so a
 * large store needs room to list everything; an expired attempt counts as a failed one and is retried.
 */
export const RECONCILE_EXPIRE_SECONDS = 4 * 60 * 60;

/** The slice of integration the fan-out uses: the only way catalog learns which stores exist. */
export interface ActiveStoreSource {
  activeStoreIds(after: string | null, limit: number): Promise<string[]>;
}

/** Queue one `catalog.reconcile` per active store for the UTC day of `now`; returns how many were queued (not already queued that day). */
export async function fanOutReconcile(stores: ActiveStoreSource, boss: JobSender, now: Date = new Date()): Promise<number> {
  const day = now.toISOString().slice(0, 10);
  const dayStart = Date.parse(`${day}T00:00:00.000Z`);
  let queued = 0;
  for (let after: string | null = null; ; ) {
    const ids = await stores.activeStoreIds(after, RECONCILE_FANOUT_PAGE);
    for (const storeId of ids) {
      const payload: ReconcileJob = { v: 1, trace_id: randomBytes(16).toString('hex'), store_id: storeId };
      // A fixed offset after 00:00 UTC (not after this job ran), so the same store runs 24 h apart even if the fan-out is late.
      const startAfter = new Date(dayStart + reconcileOffsetSeconds(storeId) * 1000);
      const jobId = await boss.send(CATALOG_RECONCILE_QUEUE, payload, { singletonKey: `${storeId}:${day}`, singletonSeconds: RECONCILE_SINGLETON_SECONDS, startAfter, expireInSeconds: RECONCILE_EXPIRE_SECONDS });
      if (jobId) queued++;
    }
    if (ids.length < RECONCILE_FANOUT_PAGE) break;
    after = ids[ids.length - 1]!;
  }
  return queued;
}

export function catalogJobHandlers(sync: CatalogSync, reconcile: CatalogReconcile, stores: ActiveStoreSource, boss: JobSender, telemetry: Telemetry): Record<string, JobHandler> {
  return {
    [CATALOG_FULL_SYNC_QUEUE]: async (data, meta) => {
      const job = FullSyncJob.parse(data);
      // A retryable failure reads `failed` only on the last attempt (Story 2.3).
      await sync.run(job.store_id, job.run_id, { finalAttempt: isFinalAttempt(meta) });
    },
    // Daily cron (Story 2.6): one reconcile job per active store.
    [CATALOG_RECONCILE_SCHEDULE_QUEUE]: async () => {
      const queued = await fanOutReconcile(stores, boss);
      telemetry.log.info('catalog reconcile scheduled', { queued });
    },
    [CATALOG_RECONCILE_QUEUE]: async (data, meta) => {
      const job = ReconcileJob.parse(data);
      await reconcile.run(job.store_id, { finalAttempt: isFinalAttempt(meta) });
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
  // Nothing consumes product changes yet (content in Story 3.4 and publishing in Epic 4 will); the dispatcher still needs a handler.
  registry.on('catalog.product.updated', 'catalog.log.product.updated', async (event) => {
    telemetry.log.info('catalog event', { event: event.name, event_id: event.id, product_id: event.payload.product_id, changed: event.payload.changed });
  });
  // Same for deletions (Story 2.5): content flags linked content "Linked product deleted", publishing drops it from manifests.
  registry.on('catalog.product.deleted', 'catalog.log.product.deleted', async (event) => {
    telemetry.log.info('catalog event', { event: event.name, event_id: event.id, product_id: event.payload.product_id });
  });
  registry.on('catalog.sync.completed', 'catalog.log.sync.completed', async (event) => {
    telemetry.log.info('catalog event', { event: event.name, event_id: event.id, created: event.payload.created, updated: event.payload.updated });
  });
}
