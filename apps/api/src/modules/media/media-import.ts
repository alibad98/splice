// Worker-side import of an external link (Story 3.7): fetch through the SSRF-safe fetcher, store the bytes at the normal
// upload key, then hand the asset to the 3.5 inspection (`uploaded` + `media.asset.uploaded`), or `failed` with a reason.
import { createHash } from 'node:crypto';
import { MEDIA_LIMITS, isAllowedMediaType, type MediaContentType, type MediaFailureReason, type MediaKind } from '@slips/contracts';
import { requireStoreContext } from '@slips/db';
import { fileTypeFromBuffer } from 'file-type';
import { publishEvent, type EventSender } from '../../events/outbox.js';
import type { ExternalFetcher } from '../../ports/external-fetcher.js';
import type { ObjectStorage } from '../../ports/object-storage.js';
import type { Telemetry } from '../../ports/telemetry.js';
import { MediaRepository } from './media.repository.js';
import { uploadKey } from './media.service.js';

const otherKind = (kind: MediaKind): MediaKind => (kind === 'image' ? 'video' : 'image');

/**
 * Imports one `importing` asset inside the import job's store context. Outcomes about the link or the file end in
 * `failed` (`fetch_blocked`, `fetch_too_large`, `fetch_failed` for a 4xx, `type_not_allowed`, `type_mismatch`); transient
 * failures (network, timeout, 5xx, storage down) throw so the job retries, and on the final attempt the asset is set
 * `failed` (`fetch_failed`). A fetched file of an allowed type is stored at `stores/{store_id}/uploads/{sha256}` and the
 * asset becomes `uploaded`, so the same inspection as an upload runs next (hash, sniff, metadata strip, malware scan).
 */
export class MediaImporter {
  private readonly repo = new MediaRepository();

  constructor(
    private readonly fetcher: ExternalFetcher,
    private readonly storage: ObjectStorage,
    private readonly events: EventSender,
    private readonly telemetry: Telemetry,
  ) {}

  async import(storeId: string, assetId: string, opts: { finalAttempt: boolean }, now: () => Date = () => new Date()): Promise<void> {
    const asset = await this.repo.findAsset(assetId, { forUpdate: true });
    if (!asset) {
      this.telemetry.log.warn('media import: asset not found', { asset_id: assetId });
      return;
    }
    // Only while importing: a redelivered job after the outcome committed does nothing.
    if (asset.status !== 'importing' || !asset.sourceUrl) return;
    const kind: MediaKind = asset.kind;
    const tx = requireStoreContext();
    const fail = async (reason: MediaFailureReason): Promise<void> => {
      await this.repo.finishImport(assetId, { status: 'failed', reason }, now());
      await publishEvent(tx, this.events, this.telemetry, 'media.asset.failed', { v: 1, store_id: storeId, asset_id: assetId, reason });
    };
    let stored: { sha256: string; sizeBytes: number; contentType: MediaContentType; key: string } | MediaFailureReason;
    try {
      stored = await this.fetchAndStore(storeId, asset.id, asset.sourceUrl, kind);
    } catch (err) {
      if (!opts.finalAttempt) throw err;
      this.telemetry.captureError(err, { component: 'media.import', asset_id: assetId });
      stored = 'fetch_failed';
    }
    if (typeof stored === 'string') return fail(stored);
    await this.repo.finishImport(assetId, { status: 'uploaded', sha256: stored.sha256, sizeBytes: stored.sizeBytes, contentType: stored.contentType, uploadKey: stored.key }, now());
    await publishEvent(tx, this.events, this.telemetry, 'media.asset.uploaded', {
      v: 1,
      store_id: storeId,
      asset_id: assetId,
      kind,
      content_type: stored.contentType,
      size_bytes: stored.sizeBytes,
    });
  }

  /** The stored file, or the failure reason about the link or the file. Throws only for failures worth retrying. */
  private async fetchAndStore(
    storeId: string,
    assetId: string,
    sourceUrl: string,
    kind: MediaKind,
  ): Promise<{ sha256: string; sizeBytes: number; contentType: MediaContentType; key: string } | MediaFailureReason> {
    const result = await this.fetcher.fetch(sourceUrl, { maxBytes: MEDIA_LIMITS[kind].max_bytes });
    if (result.outcome === 'blocked') {
      this.telemetry.log.warn('media import: link blocked', { asset_id: assetId, detail: result.detail });
      return 'fetch_blocked';
    }
    if (result.outcome === 'too_large') return 'fetch_too_large';
    if (result.outcome === 'failed') {
      this.telemetry.log.info('media import: source answered an error', { asset_id: assetId, detail: result.detail, status: result.status });
      return 'fetch_failed';
    }
    if (result.body.length === 0) return 'type_not_allowed';
    // The declared Content-Type is never trusted: the bytes are sniffed (and sniffed again by the inspection).
    const sniffed = (await fileTypeFromBuffer(result.body))?.mime;
    if (!sniffed || !isAllowedMediaType(kind, sniffed)) {
      return sniffed && isAllowedMediaType(otherKind(kind), sniffed) ? 'type_mismatch' : 'type_not_allowed';
    }
    const sha256 = createHash('sha256').update(result.body).digest('hex');
    const key = uploadKey(storeId, sha256);
    await this.storage.put(key, result.body, sniffed);
    return { sha256, sizeBytes: result.body.length, contentType: sniffed, key };
  }
}
