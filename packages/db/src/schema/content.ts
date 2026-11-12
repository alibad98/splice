// Tables owned by the `content` module (AD-2). Tenant tables with forced RLS (migration 0016).
import { sql } from 'drizzle-orm';
import { boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const CONTENT_STATUSES = ['draft', 'processing', 'failed', 'scheduled', 'published', 'ended', 'archived', 'deactivated'] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const CONTENT_FORMATS = ['story', 'reel'] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];

export const CTA_ACTIONS = ['add_to_cart', 'open_product', 'open_link'] as const;
export type CtaAction = (typeof CTA_ACTIONS)[number];

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const contentItems = pgTable('content_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull(),
  title: text('title').notNull(),
  format: text('format').$type<ContentFormat>().notNull(),
  ctaLabel: text('cta_label').notNull(),
  ctaAction: text('cta_action').$type<CtaAction>().notNull(),
  ctaUrl: text('cta_url'),
  ctaStyle: text('cta_style'),
  status: text('status').$type<ContentStatus>().notNull().default('draft'),
  archivedFrom: text('archived_from').$type<ContentStatus>(),
  reactivateTo: text('reactivate_to').$type<ContentStatus>(),
  autoPublish: boolean('auto_publish').notNull().default(false),
  firstPublishedAt: ts('first_published_at'),
  /** Tombstone (Story 3.1): set when the merchant deletes the item; null = live. Never a hard delete. */
  deletedAt: ts('deleted_at'),
  createdAt: ts('created_at').notNull().default(sql`now()`),
  updatedAt: ts('updated_at').notNull().default(sql`now()`),
});

/**
 * Product links (Story 3.4): one product per content item (unique on store + content). No FK to `products` (owned by
 * `catalog`, AD-2). Unlinking keeps the row with `product_id` null (links are never hard-deleted outside the store
 * purge). `slide_id` is reserved for later per-slide links.
 */
export const contentProductLinks = pgTable('content_product_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull(),
  contentId: uuid('content_id').notNull(),
  productId: uuid('product_id'),
  slideId: uuid('slide_id'),
  createdAt: ts('created_at').notNull().default(sql`now()`),
});

/**
 * Slides of a content item (Story 3.6, migration 0019). `media_asset_id` references a `media_assets` row (owned by `media`,
 * AD-2: no FK); `kind` is copied from the asset. `position` orders the live slides. A removed slide is soft-deleted and
 * revived when the same asset is re-added (one live slide per asset per item). Only the store purge hard-deletes.
 */
export const slides = pgTable('slides', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull(),
  contentId: uuid('content_id').notNull(),
  mediaAssetId: uuid('media_asset_id').notNull(),
  kind: text('kind').$type<'image' | 'video'>().notNull(),
  position: integer('position').notNull(),
  altText: text('alt_text'),
  deletedAt: ts('deleted_at'),
  createdAt: ts('created_at').notNull().default(sql`now()`),
  updatedAt: ts('updated_at').notNull().default(sql`now()`),
});

/** Home placements, owned and written by content. Unsupported targets remain outside the pilot. `layout` is Ring only (Story 4.2 pilot, migration 0023). */
export const placements = pgTable('placements', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull(),
  contentId: uuid('content_id').notNull(),
  type: text('type').$type<'home'>().notNull(),
  layout: text('layout').$type<'ring'>().notNull().default('ring'),
  createdAt: ts('created_at').notNull().default(sql`now()`),
});
