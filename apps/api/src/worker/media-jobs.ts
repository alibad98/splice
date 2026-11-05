// Worker-side wiring of the media module (Story 3.5): an uploaded asset queues one inspect job (media group, 3 attempts).
import { MEDIA_INSPECT_QUEUE, MediaInspectJob } from '@slips/contracts';
import type { Pool } from 'pg';
import { isFinalAttempt, jobMeta, type JobHandler } from '../adapters/telemetry/jobs.js';
import type { EventHandlerRegistry } from '../events/dispatcher.js';
import type { MediaInspector } from '../modules/media/media-inspect.js';
import type { Telemetry } from '../ports/telemetry.js';
import type { JobSender } from './integration-jobs.js';
import { storeScopedJob } from './store-job.js';

/**
 * `media.asset.uploaded` queues `media.asset.inspect` on pg-boss's own connection. The job id and singleton key are the
 * asset id, so a redelivered event never queues a second inspection. Scanned and failed outcomes are logged (processing,
 * Story 3.8, adds its own consumer).
 */
export function registerMediaEventHandlers(registry: EventHandlerRegistry, boss: JobSender, telemetry: Telemetry): void {
  registry.on('media.asset.uploaded', 'media.inspect.on.media.asset.uploaded', async (event) => {
    const { store_id: storeId, asset_id: assetId } = event.payload;
    const payload: MediaInspectJob = { ...jobMeta(telemetry, storeId), store_id: storeId, asset_id: assetId };
    const jobId = await boss.send(MEDIA_INSPECT_QUEUE, payload, { id: assetId, singletonKey: assetId });
    if (!jobId) telemetry.log.info('media inspect already queued', { event_id: event.id, asset_id: assetId });
  });
  registry.on('media.asset.scanned', 'media.log.media.asset.scanned', async (event) => {
    telemetry.log.info('media event', { event: event.name, event_id: event.id, asset_id: event.payload.asset_id, size_bytes: event.payload.size_bytes });
  });
  registry.on('media.asset.failed', 'media.log.media.asset.failed', async (event) => {
    telemetry.log.info('media event', { event: event.name, event_id: event.id, asset_id: event.payload.asset_id, reason: event.payload.reason });
  });
}

/** The inspect job, in the job's store context; the last attempt records `inspection_failed` instead of throwing. */
export function mediaJobHandlers(pool: Pool, inspector: MediaInspector): Record<string, JobHandler> {
  return {
    [MEDIA_INSPECT_QUEUE]: storeScopedJob(pool, async (data, job) => {
      const parsed = MediaInspectJob.parse(data);
      await inspector.inspect(parsed.store_id, parsed.asset_id, { finalAttempt: isFinalAttempt(job) });
    }),
  };
}
