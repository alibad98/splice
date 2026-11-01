// Tables owned by the `catalog` module (AD-2). Tenant tables with forced RLS (migration 0012).
import { sql } from 'drizzle-orm';
import { bigint, boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { StorePlatform } from './integration.js';

/** Stored once by `catalog`; clients never recompute it (spine Availability convention). */
export const AVAILABILITY_BUCKETS = ['available', 'low', 'out_of_stock'] as const;
export type AvailabilityBucket = (typeof AVAILABILITY_BUCKETS)[number];

/** `queued`: requested by the merchant, waiting for the worker (Story 2.3). */
export const CATALOG_SYNC_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const;
export type CatalogSyncStatus = (typeof CATALOG_SYNC_STATUSES)[number];
export const CATALOG_SYNC_REASONS = ['platform_unavailable', 'auth_rejected', 'store_inactive', 'unknown_currency', 'invalid_data', 'internal'] as const;
export type CatalogSyncReason = (typeof CATALOG_SYNC_REASONS)[number];

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull(),
  platform: text('platform').$type<StorePlatform>().notNull(),
  externalId: text('external_id').notNull(),
  name: text('name').notNull(),
  sourceUpdatedAt: ts('source_updated_at').notNull(),
  createdAt: ts('created_at').notNull().default(sql`now()`),
  updatedAt: ts('updated_at').notNull().default(sql`now()`),
});

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull(),
  platform: text('platform').$type<StorePlatform>().notNull(),
  externalId: text('external_id').notNull(),
  name: text('name').notNull(),
  imageUrl: text('image_url'),
  categoryExternalIds: text('category_external_ids').array().notNull().default(sql`'{}'::text[]`),
  /** Integer minor units of `currency`. */
  priceMinor: bigint('price_minor', { mode: 'number' }).notNull(),
  salePriceMinor: bigint('sale_price_minor', { mode: 'number' }),
  currency: text('currency').notNull(),
  taxInclusive: boolean('tax_inclusive').notNull(),
  /** Null: unlimited or not reported. */
  stock: integer('stock'),
  availability: text('availability').$type<AvailabilityBucket>().notNull(),
  hasRequiredOptions: boolean('has_required_options').notNull(),
  visible: boolean('visible').notNull(),
  sourceUpdatedAt: ts('source_updated_at').notNull(),
  createdAt: ts('created_at').notNull().default(sql`now()`),
  updatedAt: ts('updated_at').notNull().default(sql`now()`),
});

/** One row per store: the latest sync run, resumable from `next_page`. */
export const catalogSyncState = pgTable('catalog_sync_state', {
  storeId: uuid('store_id').primaryKey(),
  runId: uuid('run_id').notNull(),
  status: text('status').$type<CatalogSyncStatus>().notNull(),
  reason: text('reason').$type<CatalogSyncReason>(),
  nextPage: integer('next_page').notNull().default(1),
  createdCount: integer('created_count').notNull().default(0),
  updatedCount: integer('updated_count').notNull().default(0),
  startedAt: ts('started_at').notNull().default(sql`now()`),
  finishedAt: ts('finished_at'),
  lastSyncedAt: ts('last_synced_at'),
  /** When the merchant last asked for a manual sync (rate limit); null for install-triggered runs only. */
  requestedAt: ts('requested_at'),
  updatedAt: ts('updated_at').notNull().default(sql`now()`),
});
