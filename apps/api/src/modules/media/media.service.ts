import { Inject, Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import {
  MEDIA_LIMITS,
  MEDIA_UPLOAD_COMPLETE_GRACE_SECONDS,
  MEDIA_UPLOAD_TTL_SECONDS,
  MEDIA_UPLOAD_WINDOW_SECONDS,
  isAllowedMediaType,
  type MediaAsset,
  type MediaAssetStatus,
  type MediaFailureReason,
  type MediaImportRequest,
  type MediaKind,
  type MediaUploadGrant,
  type MediaUploadRequest,
} from '@slips/contracts';
import { currentStoreContext, requireStoreContext, withStoreContext } from '@slips/db';
import type { Pool } from 'pg';
import { publishEvent, uuidv7, type EventSender, type TxQueryable } from '../../events/outbox.js';
import { checkFetchUrl } from '../../ports/fetch-url-policy.js';
import { DB_POOL, EVENT_SENDER, MEDIA_CONFIG, type MediaConfig } from '../../infra.module.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../../ports/object-storage.js';
import { Metric, TELEMETRY, type Telemetry } from '../../ports/telemetry.js';
import { MediaRepository, type MediaAssetRow } from './media.repository.js';

export class MediaTypeNotAllowedError extends Error {
  constructor() {
    super('The media type is not allowed');
    this.name = 'MediaTypeNotAllowedError';
  }
}

export class MediaTooLargeError extends Error {
  constructor() {
    super('The media file is larger than allowed, or not the size that was declared');
    this.name = 'MediaTooLargeError';
  }
}

export class MediaUploadRateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Too many upload URLs were issued for this store recently');
    this.name = 'MediaUploadRateLimitedError';
  }
}

/** An import link is not allowed (Story 3.7): scheme, port, user info, length, or a blocked IP host. */
export class MediaUrlNotAllowedError extends Error {
  constructor(readonly problem: string) {
    super('The link can not be imported');
    this.name = 'MediaUrlNotAllowedError';
  }
}

export class MediaUploadNotFoundError extends Error {
  constructor() {
    super('Upload not found');
    this.name = 'MediaUploadNotFoundError';
  }
}

export class MediaUploadMissingError extends Error {
  constructor() {
    super('The file has not been uploaded');
    this.name = 'MediaUploadMissingError';
  }
}

export class MediaUploadExpiredError extends Error {
  constructor() {
    super('The upload URL expired before the file was uploaded');
    this.name = 'MediaUploadExpiredError';
  }
}

/** `stores/{store_id}/uploads/{sha256}`: store-prefixed and content-addressed. Never served. */
export const uploadKey = (storeId: string, sha256: string): string => `stores/${storeId}/uploads/${sha256}`;

/** Every object of a store lives under this prefix (purged on uninstall). */
export const storePrefix = (storeId: string): string => `stores/${storeId}/`;

/** API-relative poster URL for a `processed` asset; `null` while in flight or `failed` (Story 3.8). */
export const posterUrlFor = (id: string, status: MediaAssetStatus): string | null =>
  status === 'processed' ? `/v1/media/${id}/poster` : null;

export const toMediaAsset = (row: MediaAssetRow): MediaAsset => ({
  v: 1,
  id: row.id,
  kind: row.kind,
  content_type: row.contentType,
  size_bytes: row.sizeBytes,
  status: row.status,
  failure_reason: (row.failureReason as MediaAsset['failure_reason']) ?? null,
  poster_url: posterUrlFor(row.id, row.status),
  created_at: row.createdAt.toISOString(),
  updated_at: row.updatedAt.toISOString(),
});

/**
 * The media module's service (Story 3.5): issues throttled, store-scoped pre-signed upload URLs, records completed
 * uploads as `uploaded` assets (emitting `media.asset.uploaded`), and answers the reads other modules need
 * (`publishableAssetIds`, `storedBytes`). Inspection runs in the worker (`MediaInspector`).
 */
@Injectable()
export class MediaService {
  private readonly repo = new MediaRepository();

  async requeueProcessing(tx: TxQueryable, storeId: string, assetIds: readonly string[]): Promise<string[]> {
    const requeued: string[] = [];
    for (const id of [...new Set(assetIds)].sort()) {
      const row = await this.repo.requeueProcessing(id, new Date());
      if (!row) continue;
      await publishEvent(tx, this.events, this.telemetry, 'media.asset.scanned', { v: 1, store_id: storeId, asset_id: id, kind: row.kind, size_bytes: row.sizeBytes! });
      requeued.push(id);
    }
    return requeued;
  }

  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(EVENT_SENDER) private readonly events: EventSender,
    @Inject(TELEMETRY) private readonly telemetry: Telemetry,
    @Inject(MEDIA_CONFIG) private readonly config: MediaConfig,
  ) {}

  /**
   * A pre-signed PUT URL for one file. Checks the type and size limits, then, serialized per store by an advisory
   * transaction lock, the throttle (`uploadRateLimit` grants per 10 minutes), and records the grant.
   */
  async issueUpload(storeId: string, input: MediaUploadRequest, now: Date = new Date()): Promise<MediaUploadGrant> {
    const contentType = input.content_type.trim().toLowerCase();
    if (!isAllowedMediaType(input.kind, contentType)) throw new MediaTypeNotAllowedError();
    if (input.size_bytes > MEDIA_LIMITS[input.kind].max_bytes) throw new MediaTooLargeError();
    const key = uploadKey(storeId, input.sha256);
    const expiresAt = new Date(now.getTime() + MEDIA_UPLOAD_TTL_SECONDS * 1000);
    // Signed before the per-store lock is taken, so storage signing never holds the lock or a pooled connection.
    const presigned = await this.storage.presignPut({ key, contentType, sizeBytes: input.size_bytes, sha256Hex: input.sha256, expiresInSeconds: MEDIA_UPLOAD_TTL_SECONDS });
    const id = await withStoreContext(this.pool, storeId, async () => {
      await this.assertWithinUploadLimit(storeId, now);
      const grant = await this.repo.insertGrant({
        id: uuidv7(now.getTime()),
        storeId,
        kind: input.kind,
        contentType,
        sizeBytes: input.size_bytes,
        sha256: input.sha256,
        storageKey: key,
        expiresAt,
        completedAssetId: null,
        createdAt: now,
      });
      return grant.id;
    });
    return { v: 1, upload_id: id, url: presigned.url, method: 'PUT', headers: presigned.headers, expires_at: expiresAt.toISOString() };
  }

  /**
   * Inside the store's transaction: takes the per-store advisory lock, then throws `MediaUploadRateLimitedError` when the
   * store already has `uploadRateLimit` upload grants and link imports in the window (metric + warn log).
   */
  private async assertWithinUploadLimit(storeId: string, now: Date): Promise<void> {
    const limit = this.config.uploadRateLimit;
    await this.repo.lockStoreGrants();
    const windowMs = MEDIA_UPLOAD_WINDOW_SECONDS * 1000;
    const nth = await this.repo.nthRecentIssueSince(new Date(now.getTime() - windowMs), limit);
    if (nth) {
      const retryAfterSeconds = Math.max(1, Math.ceil((nth.getTime() + windowMs - now.getTime()) / 1000));
      this.telemetry.counter(Metric.MediaUploadThrottled);
      this.telemetry.log.warn('media upload throttled', { store_id: storeId, limit, retry_after_seconds: retryAfterSeconds });
      throw new MediaUploadRateLimitedError(retryAfterSeconds);
    }
  }

  /**
   * Records an import from an external link (Story 3.7) as an `importing` asset with its `source_url` and emits
   * `media.asset.import_requested` in the same transaction; the worker fetches it. The link must be http(s) on port 80/443
   * without user info and its host must not be a blocked IP literal (`MediaUrlNotAllowedError`); hosts given by name are
   * checked when the worker resolves them. Imports count toward the same per-store throttle as upload URLs.
   */
  async importFromUrl(storeId: string, input: MediaImportRequest, now: Date = new Date()): Promise<MediaAsset> {
    const checked = checkFetchUrl(input.url);
    if (!checked.ok) throw new MediaUrlNotAllowedError(checked.problem);
    const sourceUrl = checked.url.href;
    const row = await withStoreContext(this.pool, storeId, async () => {
      await this.assertWithinUploadLimit(storeId, now);
      const asset = await this.repo.insertAsset({
        id: uuidv7(now.getTime()),
        storeId,
        kind: input.kind,
        contentType: null,
        sizeBytes: null,
        sha256: null,
        uploadKey: null,
        storageKey: null,
        sourceUrl,
        status: 'importing',
        failureReason: null,
        createdAt: now,
        updatedAt: now,
      });
      await publishEvent(requireStoreContext(), this.events, this.telemetry, 'media.asset.import_requested', { v: 1, store_id: storeId, asset_id: asset.id, kind: asset.kind });
      return asset;
    });
    return toMediaAsset(row);
  }

  /**
   * Records a finished upload as an `uploaded` asset and emits `media.asset.uploaded` in the same transaction.
   * Idempotent: a completed grant returns its asset without touching storage again.
   */
  async completeUpload(storeId: string, uploadId: string, now: Date = new Date()): Promise<MediaAsset> {
    const grant = await withStoreContext(this.pool, storeId, () => this.repo.findGrant(uploadId));
    if (!grant) throw new MediaUploadNotFoundError();
    if (grant.completedAssetId) return this.getAsset(storeId, grant.completedAssetId);
    // Past expiry plus the grace for a PUT still in flight, the grant is closed even if the same bytes exist at the shared key.
    if (now.getTime() > grant.expiresAt.getTime() + MEDIA_UPLOAD_COMPLETE_GRACE_SECONDS * 1000) throw new MediaUploadExpiredError();
    const head = await this.storage.head(grant.storageKey);
    if (!head) throw now.getTime() > grant.expiresAt.getTime() ? new MediaUploadExpiredError() : new MediaUploadMissingError();
    if (head.sizeBytes !== grant.sizeBytes) {
      const shared = await withStoreContext(this.pool, storeId, () => this.repo.uploadKeyInUse(grant.storageKey, { grantId: grant.id }, now));
      if (!shared) await this.storage.delete(grant.storageKey);
      throw new MediaTooLargeError();
    }
    const row = await withStoreContext(this.pool, storeId, async () => {
      const locked = await this.repo.findGrant(uploadId, { forUpdate: true });
      if (!locked) throw new MediaUploadNotFoundError();
      if (locked.completedAssetId) {
        const existing = await this.repo.findAsset(locked.completedAssetId);
        if (!existing) throw new MediaUploadNotFoundError();
        return existing;
      }
      const asset = await this.repo.insertAsset({
        id: uuidv7(now.getTime()),
        storeId,
        sourceUrl: null,
        kind: locked.kind,
        contentType: locked.contentType,
        sizeBytes: locked.sizeBytes,
        sha256: locked.sha256,
        uploadKey: locked.storageKey,
        storageKey: null,
        status: 'uploaded',
        failureReason: null,
        createdAt: now,
        updatedAt: now,
      });
      await this.repo.markGrantCompleted(locked.id, asset.id);
      await publishEvent(requireStoreContext(), this.events, this.telemetry, 'media.asset.uploaded', {
        v: 1,
        store_id: storeId,
        asset_id: asset.id,
        kind: asset.kind,
        content_type: locked.contentType,
        size_bytes: locked.sizeBytes,
      });
      return asset;
    });
    return toMediaAsset(row);
  }

  /** One asset of the store; `MediaAssetNotFoundError` for unknown or other-store ids. */
  async getAsset(storeId: string, id: string): Promise<MediaAsset> {
    const row = await withStoreContext(this.pool, storeId, () => this.repo.findAsset(id));
    if (!row) throw new MediaAssetNotFoundError();
    return toMediaAsset(row);
  }

  /**
   * Streams the poster (`poster` rendition for videos, `web` rendition for images) of a `processed` asset of the store
   * (Story 3.8). Throws `MediaAssetNotFoundError` (404) when the asset is unknown, belongs to another store, or is not
   * `processed`.
   */
  async getPoster(storeId: string, id: string): Promise<{ stream: Readable; contentType: string; sizeBytes: number }> {
    const rendition = await withStoreContext(this.pool, storeId, async () => {
      const asset = await this.repo.findAsset(id);
      if (!asset || asset.status !== 'processed') throw new MediaAssetNotFoundError();
      const profile = asset.kind === 'video' ? 'poster' : 'web';
      const found = await this.repo.findRendition(asset.id, profile);
      if (!found) throw new MediaAssetNotFoundError();
      return found;
    });
    const stream = await this.storage.getStream(rendition.storageKey);
    if (!stream) throw new MediaAssetNotFoundError();
    return { stream, contentType: rendition.contentType, sizeBytes: rendition.sizeBytes };
  }

  /**
   * Kind, status and failure reason of the asked assets in one read (Story 3.6: slides). Unknown and other-store ids are
   * absent from the map.
   */
  async getAssetsByIds(storeId: string, ids: readonly string[]): Promise<Map<string, MediaAssetSummary>> {
    if (ids.length === 0) return new Map();
    const rows =
      currentStoreContext()?.storeId === storeId
        ? await this.repo.summariesByIds(ids)
        : await withStoreContext(this.pool, storeId, () => this.repo.summariesByIds(ids));
    return new Map(
      rows.map((r) => [
        r.id,
        {
          kind: r.kind,
          status: r.status,
          failure_reason: (r.failureReason as MediaFailureReason | null) ?? null,
          source_url: r.sourceUrl,
          poster_url: posterUrlFor(r.id, r.status),
        },
      ]),
    );
  }

  /** The asked asset ids that may be published: `processed` only (never `uploaded`, `scanned` or `failed`). */
  async publishableAssetIds(storeId: string, ids: readonly string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    return withStoreContext(this.pool, storeId, () => this.repo.processedIds(ids));
  }

  /** Bytes the store keeps in media storage: `size_bytes` of its assets that are not `failed` (imports count once fetched). */
  async storedBytes(storeId: string): Promise<number> {
    return withStoreContext(this.pool, storeId, () => this.repo.storedBytes());
  }
}

/** What other modules read about an asset (Story 3.6). */
export interface MediaAssetSummary {
  kind: MediaKind;
  status: MediaAssetStatus;
  failure_reason: MediaFailureReason | null;
  /** The link an imported asset came from (Story 3.7); null for uploads. */
  source_url: string | null;
  /** `/v1/media/:id/poster` when `status === 'processed'`, otherwise `null` (Story 3.8). */
  poster_url: string | null;
}

export class MediaAssetNotFoundError extends Error {
  constructor() {
    super('Media asset not found');
    this.name = 'MediaAssetNotFoundError';
  }
}
