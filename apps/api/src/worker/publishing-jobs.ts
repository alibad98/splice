import { MANIFEST_DELIVERY_QUEUE, type ManifestDelivery } from '../modules/publishing/manifest-delivery.js';
// Worker-side wiring of the publishing module (Story 4.4 pilot slice): every event in `MANIFEST_INPUTS` enqueues one
// debounced, single-flight store manifest compile inside its delivery transaction; the job compiles it. Product events
// enqueue only when content links the product (Story 4.6 pilot slice).
import type { Pool } from 'pg';
import { isFinalAttempt, jobMeta, type JobHandler } from '../adapters/telemetry/jobs.js';
import type { EventHandlerRegistry } from '../events/dispatcher.js';
import type { TxQueryable } from '../events/outbox.js';
import { MANIFEST_COMPILE_QUEUE, MANIFEST_COMPILE_SINGLETON_SECONDS, MANIFEST_INPUTS, ManifestCompileJob } from '../modules/publishing/manifest-inputs.js';
import type { StoreManifestCompiler } from '../modules/publishing/store-manifest.js';
import type { ContentService } from '../modules/content/content.service.js';
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

/** Product events whose compile is gated on the product being linked to live content. */
const PRODUCT_EVENTS: ReadonlySet<string> = new Set(['catalog.product.updated', 'catalog.product.deleted']);

/**
 * One handler per `MANIFEST_INPUTS` event (the delivery ledger dedupes redelivered event ids). `catalog.product.updated`
 * and `catalog.product.deleted` enqueue only when at least one non-deleted content item links the product (read through
 * the content owner, joining the delivery transaction): an unlinked product can not change what a manifest shows.
 * Every other input enqueues unconditionally.
 */
export function registerPublishingEventHandlers(registry: EventHandlerRegistry, boss: JobSender, telemetry: Telemetry, content: Pick<ContentService, 'getLinkCountsByProductIds'>): void {
  for (const name of MANIFEST_INPUTS) {
    registry.on(name, `publishing.manifest.compile.on.${name}`, async (event, tx) => {
      const storeId = event.payload.store_id;
      if (PRODUCT_EVENTS.has(name)) {
        const productId = (event.payload as { product_id: string }).product_id;
        const links = await content.getLinkCountsByProductIds(storeId, [productId]);
        if (!links.get(productId)) {
          telemetry.log.debug('store manifest compile skipped: product not linked', { event: name, event_id: event.id, store_id: storeId, product_id: productId });
          return;
        }
      }
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
