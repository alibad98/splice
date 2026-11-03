// Tables owned by the `content` module (AD-2). Tenant tables with forced RLS (migration 0016).
import { sql } from 'drizzle-orm';
import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
