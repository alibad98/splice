// Worker-side wiring of the media module (Stories 3.5, 3.7): an uploaded asset queues one inspect job and a link import
// one import job (media group, 3 attempts).
import { MEDIA_IMPORT_QUEUE, MEDIA_INSPECT_QUEUE, MediaImportJob, MediaInspectJob } from '@slips/contracts';
import type { Pool } from 'pg';
import { isFinalAttempt, jobMeta, type JobHandler } from '../adapters/telemetry/jobs.js';
import type { EventHandlerRegistry } from '../events/dispatcher.js';
import type { MediaImporter } from '../modules/media/media-import.js';
import type { MediaInspector } from '../modules/media/media-inspect.js';
import type { Telemetry } from '../ports/telemetry.js';
import type { JobSender } from './integration-jobs.js';
import { storeScopedJob } from './store-job.js';

/**
 * `media.asset.uploaded` queues `media.asset.inspect` on pg-boss's own connection. The job id and singleton key are the
 * asset id, so a redelivered event never queues a second inspection. Scanned and failed outcomes are logged and release
 * the upload object (processing, Story 3.8, adds its own consumer).
 */
export function registerMediaEventHandlers(registry: EventHandlerRegistry, boss: JobSender, telemetry: Telemetry, inspector: MediaInspector): void {
  registry.on('media.asset.uploaded', 'media.inspect.on.media.asset.uploaded', async (event) => {
    const { store_id: storeId, asset_id: assetId } = event.payload;
    const payload: MediaInspectJob = { ...jobMeta(telemetry, storeId), store_id: storeId, asset_id: assetId };
    const jobId = await boss.send(MEDIA_INSPECT_QUEUE, payload, { id: assetId, singletonKey: assetId });
    if (!jobId) telemetry.log.info('media inspect already queued', { event_id: event.id, asset_id: assetId });
  });
  // A link import (Story 3.7) queues one fetch job; job id = asset id, so a redelivered event never fetches twice.
  registry.on('media.asset.import_requested', 'media.import.on.media.asset.import_requested', async (event) => {
    const { store_id: storeId, asset_id: assetId } = event.payload;
    const payload: MediaImportJob = { ...jobMeta(telemetry, storeId), store_id: storeId, asset_id: assetId };
    const jobId = await boss.send(MEDIA_IMPORT_QUEUE, payload, { id: assetId, singletonKey: assetId });
    if (!jobId) telemetry.log.info('media import already queued', { event_id: event.id, asset_id: assetId });
  });
  registry.on('media.asset.scanned', 'media.log.media.asset.scanned', async (event) => {
    telemetry.log.info('media event', { event: event.name, event_id: event.id, asset_id: event.payload.asset_id, size_bytes: event.payload.size_bytes });
  });
  // The verdict committed: only now is the upload object deleted (a rolled-back verdict keeps it for the retry). Store context is set by the dispatcher.
  for (const name of ['media.asset.scanned', 'media.asset.failed'] as const) {
    registry.on(name, `media.release-upload.on.${name}`, async (event) => {
      await inspector.releaseUpload(event.payload.asset_id);
    });
  }
  registry.on('media.asset.failed', 'media.log.media.asset.failed', async (event) => {
    telemetry.log.info('media event', { event: event.name, event_id: event.id, asset_id: event.payload.asset_id, reason: event.payload.reason });
  });
}

/**
 * The inspect and import jobs, in the job's store context. The last inspect attempt records `inspection_failed`, the
 * last import attempt `fetch_failed`, instead of throwing.
 */
export function mediaJobHandlers(pool: Pool, inspector: MediaInspector, importer: MediaImporter): Record<string, JobHandler> {
  return {
    [MEDIA_INSPECT_QUEUE]: storeScopedJob(pool, async (data, job) => {
      const parsed = MediaInspectJob.parse(data);
      await inspector.inspect(parsed.store_id, parsed.asset_id, { finalAttempt: isFinalAttempt(job) });
    }),
    [MEDIA_IMPORT_QUEUE]: storeScopedJob(pool, async (data, job) => {
      const parsed = MediaImportJob.parse(data);
      await importer.import(parsed.store_id, parsed.asset_id, { finalAttempt: isFinalAttempt(job) });
    }),
  };
}
