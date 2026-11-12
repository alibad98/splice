// Tables owned by the `publishing` module (AD-2). Tenant table with forced RLS (migration 0024).
import { bigint, boolean, text, integer, jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * The compiled per-store manifest (Story 4.4 pilot slice): one row per store, derived data (never exported). `revision`
 * only grows: every compile locks the row and writes `revision + 1`. A row at revision 0 has not been compiled yet.
 */
export const storeManifests = pgTable('store_manifests', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull().unique('store_manifests_store_unique'),
  revision: bigint('revision', { mode: 'number' }).notNull().default(0),
  manifest: jsonb('manifest'),
  sizeGzipBytes: integer('size_gzip_bytes'),
  compiledAt: timestamp('compiled_at', { withTimezone: true }),
});

export const manifestDeliveries = pgTable('manifest_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull().unique(),
  installEpoch: integer('install_epoch').notNull(),
  platformStoreId: text('platform_store_id').notNull(),
  revision: bigint('revision', { mode: 'number' }).notNull(),
  contentHash: text('content_hash').notNull(),
  uploadedHash: text('uploaded_hash'),
  deliveredHash: text('delivered_hash'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  failed: boolean('failed').notNull().default(false),
});
