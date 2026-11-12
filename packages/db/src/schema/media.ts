// Tables owned by the `media` module (AD-2). Tenant tables with forced RLS (migration 0018).
import { sql } from 'drizzle-orm';
import { bigint, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const MEDIA_KINDS = ['image', 'video'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/**
 * `[importing ->] uploaded -> scanned -> processed | failed` (Stories 3.5, 3.7); `processed` is written only by processing
 * (Story 3.8). `importing`: the worker is fetching `source_url` into storage.
 */
export const MEDIA_ASSET_STATUSES = ['importing', 'uploaded', 'scanned', 'processed', 'failed'] as const;
export type MediaAssetStatus = (typeof MEDIA_ASSET_STATUSES)[number];

/** Rendition profiles produced by `media.asset.process` (Story 3.8). */
export const RENDITION_PROFILES = ['480p', '720p', '1080p', 'poster', 'web'] as const;
export type RenditionProfile = (typeof RENDITION_PROFILES)[number];

/** Content types allowed for stored renditions (Story 3.8). */
export const RENDITION_CONTENT_TYPES = ['video/mp4', 'image/webp', 'image/jpeg'] as const;
export type RenditionContentType = (typeof RENDITION_CONTENT_TYPES)[number];

const ts = (name: string) => timestamp(name, { withTimezone: true });

/**
 * One issued pre-signed upload URL (Story 3.5). Counted for the per-store upload throttle; `completed_asset_id` is set
 * once the upload is completed, so a repeated complete returns the same asset.
 */
export const mediaUploadGrants = pgTable('media_upload_grants', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull(),
  kind: text('kind').$type<MediaKind>().notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  /** Lower-case hex SHA-256 the client declared; the PUT is signed with it and the worker re-checks it. */
  sha256: text('sha256').notNull(),
  /** `stores/{store_id}/uploads/{sha256}`: store-prefixed and content-addressed. */
  storageKey: text('storage_key').notNull(),
  expiresAt: ts('expires_at').notNull(),
  completedAssetId: uuid('completed_asset_id'),
  createdAt: ts('created_at').notNull().default(sql`now()`),
});

/**
 * A media file of a store (Story 3.5). `upload_key` is the raw upload (deleted after inspection, never served);
 * `storage_key` is the inspected, metadata-free copy (`stores/{store_id}/assets/{id}/{sha256_of_clean}/original.{ext}`),
 * null until the asset is scanned. `size_bytes` is the stored size (the clean copy once scanned).
 *
 * Imports (Story 3.7, migration 0020) record `source_url`; `sha256`, `size_bytes`, `content_type` and `upload_key` are
 * null while `importing`, and stay null when the import failed before its file was stored (a CHECK enforces it).
 */
export const mediaAssets = pgTable('media_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull(),
  kind: text('kind').$type<MediaKind>().notNull(),
  contentType: text('content_type'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  sha256: text('sha256'),
  uploadKey: text('upload_key'),
  storageKey: text('storage_key'),
  /** The external link an imported asset was fetched from (Story 3.7); null for uploads. Never served or hotlinked. */
  sourceUrl: text('source_url'),
  status: text('status').$type<MediaAssetStatus>().notNull().default('uploaded'),
  failureReason: text('failure_reason'),
  createdAt: ts('created_at').notNull().default(sql`now()`),
  updatedAt: ts('updated_at').notNull().default(sql`now()`),
});

/**
 * Processed renditions of a media asset (Story 3.8, migration 0021). Videos produce progressive MP4 renditions
 * (`480p`, `720p`, `1080p` up to source resolution) plus a `poster` (`image/webp`, `720x1280`); images produce a
 * web-optimized `web` rendition (`image/webp`). Stored at `stores/{store_id}/assets/{asset_id}/{sha256}/renditions/{profile}.{ext}`.
 */
export const renditions = pgTable('renditions', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull(),
  assetId: uuid('asset_id').notNull(),
  profile: text('profile').$type<RenditionProfile>().notNull(),
  contentType: text('content_type').$type<RenditionContentType>().notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  sha256: text('sha256').notNull(),
  storageKey: text('storage_key').notNull(),
  createdAt: ts('created_at').notNull().default(sql`now()`),
});
