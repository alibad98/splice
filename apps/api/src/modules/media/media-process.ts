// Worker-side media processing (Story 3.8): reads the clean `storage_key` of a `scanned` asset, produces progressive MP4
// renditions (`480p`, `720p`, `1080p` up to source short-side resolution) + `poster` (`image/webp`, `720x1280`) for videos
// or a web-optimized `web` rendition (`image/webp`) for images, uploads each under an immutable SHA-256 rendition key,
// inserts `renditions` rows, sets `status = 'processed'`, and emits `media.asset.processed`.
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { MEDIA_LIMITS, type MediaFailureReason, type RenditionProfile } from '@slips/contracts';
import { currentStoreContext, requireStoreContext, withStoreContext } from '@slips/db';
import type { Pool } from 'pg';
import { publishEvent, uuidv7, type EventSender } from '../../events/outbox.js';
import type { MediaProcessor } from '../../ports/media-processor.js';
import type { ObjectStorage } from '../../ports/object-storage.js';
import { Metric, type Telemetry } from '../../ports/telemetry.js';
import { MediaRepository, type MediaAssetRow, type NewRenditionRow } from './media.repository.js';

const RENDITION_EXT: Readonly<Record<'video/mp4' | 'image/webp' | 'image/jpeg', string>> = {
  'video/mp4': 'mp4',
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
};

/**
 * Immutable storage key for a processed rendition (Story 3.8, AD-11):
 * `stores/{store_id}/assets/{asset_id}/{sha256}/renditions/{profile}.{ext}`
 */
export const renditionKey = (
  storeId: string,
  assetId: string,
  sha256Hex: string,
  profile: RenditionProfile,
  contentType: 'video/mp4' | 'image/webp' | 'image/jpeg',
): string => `stores/${storeId}/assets/${assetId}/${sha256Hex}/renditions/${profile}.${RENDITION_EXT[contentType]}`;

async function readBounded(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      total += buf.length;
      if (total > maxBytes) throw new Error('media object exceeds size limit');
      chunks.push(buf);
    }
  } finally {
    stream.destroy();
  }
  return Buffer.concat(chunks, total);
}

interface PreparedRendition {
  readonly row: NewRenditionRow;
  readonly bytes: Buffer;
}

export class MediaProcessorRunner {
  constructor(
    private readonly storage: ObjectStorage,
    private readonly processor: MediaProcessor,
    private readonly events: EventSender,
    private readonly telemetry: Telemetry,
    private readonly pool?: Pool,
    private readonly repo: MediaRepository = new MediaRepository(),
  ) {}

  private inStore<T>(storeId: string, fn: () => Promise<T>): Promise<T> {
    if (currentStoreContext() || !this.pool) return fn();
    return withStoreContext(this.pool, storeId, fn);
  }

  /**
   * Process one `scanned` asset into renditions and poster. Idempotent: returns immediately if the asset is not `scanned`.
   * Transient errors throw when `!opts.finalAttempt` so pg-boss retries; on `finalAttempt`, marks the asset `failed` with
   * `processing_failed` and emits `media.asset.failed`.
   */
  async process(
    storeId: string,
    assetId: string,
    opts: { finalAttempt?: boolean; now?: Date } = {},
  ): Promise<MediaAssetRow | undefined> {
    const now = opts.now ?? new Date();
    const startedAt = performance.now();

    const initial = await this.inStore(storeId, () => this.repo.findAsset(assetId));
    if (!initial || initial.status !== 'scanned') return initial;

    const uploadedKeys: string[] = [];
    let prepared: PreparedRendition[] = [];

    try {
      if (!initial.storageKey || !initial.contentType) {
        throw new Error(`scanned asset ${assetId} is missing storage_key or content_type`);
      }
      const stream = await this.storage.getStream(initial.storageKey);
      if (!stream) {
        throw new Error(`scanned asset ${assetId} object is missing at ${initial.storageKey}`);
      }
      const raw = await readBounded(stream, MEDIA_LIMITS[initial.kind].max_bytes);
      const outputs =
        initial.kind === 'video'
          ? await this.processor.processVideo(raw, initial.contentType)
          : await this.processor.processImage(raw, initial.contentType);

      if (outputs.length === 0) {
        throw new Error(`media processor returned no renditions for asset ${assetId}`);
      }

      prepared = outputs.map((r) => {
        const sha256 = createHash('sha256').update(r.bytes).digest('hex');
        const key = renditionKey(storeId, initial.id, sha256, r.profile, r.contentType);
        return {
          bytes: r.bytes,
          row: {
            id: uuidv7(now.getTime()),
            storeId,
            assetId: initial.id,
            profile: r.profile,
            contentType: r.contentType,
            width: r.width,
            height: r.height,
            sizeBytes: r.bytes.length,
            sha256,
            storageKey: key,
            createdAt: now,
          },
        };
      });

      for (const item of prepared) {
        await this.storage.put(item.row.storageKey, item.bytes, item.row.contentType);
        uploadedKeys.push(item.row.storageKey);
      }

      return await this.inStore(storeId, async () => {
        const locked = await this.repo.findAsset(assetId, { forUpdate: true });
        if (!locked || locked.status !== 'scanned') {
          for (const key of uploadedKeys) {
            await this.storage.delete(key).catch(() => undefined);
          }
          return locked;
        }

        const inserted = await this.repo.insertRenditions(prepared.map((p) => p.row));
        const updated = await this.repo.finishProcessing(locked.id, { status: 'processed' }, now);
        await publishEvent(requireStoreContext(), this.events, this.telemetry, 'media.asset.processed', {
          v: 1,
          store_id: storeId,
          asset_id: locked.id,
          kind: locked.kind,
        });

        const storedBytesAdded = inserted.reduce((sum, r) => sum + r.sizeBytes, 0);
        if (storedBytesAdded > 0) {
          this.telemetry.counter(Metric.MediaStoredBytes, {}, storedBytesAdded);
        }
        const durationSeconds = Math.max(0, (performance.now() - startedAt) / 1000);
        this.telemetry.observe(Metric.MediaProcessingDuration, durationSeconds, { kind: locked.kind });
        return updated;
      });
    } catch (err) {
      for (const key of uploadedKeys) {
        await this.storage.delete(key).catch(() => undefined);
      }
      if (!opts.finalAttempt) throw err;
      this.telemetry.captureError(err, { asset_id: assetId, store_id: storeId, stage: 'media.asset.process' });
      return this.inStore(storeId, async () => {
        const locked = await this.repo.findAsset(assetId, { forUpdate: true });
        if (!locked || locked.status !== 'scanned') return locked;
        return this.fail(storeId, locked, 'processing_failed', now);
      });
    }
  }

  private async fail(storeId: string, asset: MediaAssetRow, reason: MediaFailureReason, now: Date): Promise<MediaAssetRow> {
    const updated = await this.repo.finishProcessing(asset.id, { status: 'failed', reason }, now);
    await publishEvent(requireStoreContext(), this.events, this.telemetry, 'media.asset.failed', {
      v: 1,
      store_id: storeId,
      asset_id: asset.id,
      reason,
    });
    return updated;
  }
}
