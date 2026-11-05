// Tables owned by the `media` module (AD-2). Tenant tables with forced RLS (migration 0018).
import { sql } from 'drizzle-orm';
import { bigint, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const MEDIA_KINDS = ['image', 'video'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** `uploaded -> scanned -> processed | failed` (Story 3.5); `processed` is written only by processing (Story 3.8). */
export const MEDIA_ASSET_STATUSES = ['uploaded', 'scanned', 'processed', 'failed'] as const;
export type MediaAssetStatus = (typeof MEDIA_ASSET_STATUSES)[number];

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
 */
export const mediaAssets = pgTable('media_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull(),
  kind: text('kind').$type<MediaKind>().notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  sha256: text('sha256').notNull(),
  uploadKey: text('upload_key').notNull(),
  storageKey: text('storage_key'),
  status: text('status').$type<MediaAssetStatus>().notNull().default('uploaded'),
  failureReason: text('failure_reason'),
  createdAt: ts('created_at').notNull().default(sql`now()`),
  updatedAt: ts('updated_at').notNull().default(sql`now()`),
});
