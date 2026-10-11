// Tables owned by the `integration` module (AD-2). Tenant tables carry store_id with forced RLS (migration 0004).
import { sql } from 'drizzle-orm';
import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const STORE_PLATFORMS = ['salla'] as const;
export type StorePlatform = (typeof STORE_PLATFORMS)[number];
/** AD-20: active -> disconnected -> uninstalled (30-day grace) -> purged. Transitions beyond `disconnected` arrive in Story 1.10. */
export const LIFECYCLE_STATES = ['active', 'disconnected', 'uninstalled', 'purged'] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

const now = () => timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`);

/** The store. `store_id` always equals `id` (CHECK), so the same RLS policy covers it. Located by (platform, platform_store_id). */
export const stores = pgTable('stores', {
  id: uuid('id').primaryKey(),
  storeId: uuid('store_id').notNull(),
  platform: text('platform').$type<StorePlatform>().notNull(),
  platformStoreId: text('platform_store_id').notNull(),
  name: text('name').notNull(),
  lifecycleState: text('lifecycle_state').$type<LifecycleState>().notNull().default('active'),
  installEpoch: integer('install_epoch').notNull().default(1),
  syncedDomains: text('synced_domains').array().notNull().default(sql`'{}'::text[]`),
  createdAt: now(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
});

/** Maps (platform, platform_store_id) to the store id before any store context exists. No RLS, no store_id column; exposes only that mapping. */
export const storeLocator = pgTable('store_locator', {
  platform: text('platform').$type<StorePlatform>().notNull(),
  platformStoreId: text('platform_store_id').notNull(),
  id: uuid('id').notNull(),
});

/** One merchant account per store (the store owner). */
export const merchantAccounts = pgTable('merchant_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull(),
  platformMerchantId: text('platform_merchant_id').notNull(),
  ownerName: text('owner_name'),
  createdAt: now(),
});

/** Envelope-encrypted token pair (never plaintext). `key_id` names the master key that wrapped the data keys. */
export const platformTokens = pgTable('platform_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull(),
  accessTokenEnc: text('access_token_enc').notNull(),
  refreshTokenEnc: text('refresh_token_enc').notNull(),
  accessExpiresAt: timestamp('access_expires_at', { withTimezone: true }).notNull(),
  scopes: text('scopes').notNull().default(''),
  keyId: text('key_id').notNull(),
  createdAt: now(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
});

/** Append-only record of every token access (NFR3). Holds no token value. */
export const tokenAccessLog = pgTable('token_access_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull(),
  purpose: text('purpose').notNull(),
  outcome: text('outcome').notNull(),
  accessedAt: timestamp('accessed_at', { withTimezone: true }).notNull().default(sql`now()`),
});

export const SESSION_MODES = ['embedded', 'direct'] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

/** A signed-in merchant (Story 1.9): an in-memory bearer minted after embedded introspection, or a direct-link cookie session. Holds only a hash of the secret. */
export const merchantSessions = pgTable('merchant_sessions', {
  id: uuid('id').primaryKey(),
  storeId: uuid('store_id').notNull(),
  mode: text('mode').$type<SessionMode>().notNull(),
  secretHash: text('secret_hash').notNull(),
  createdAt: now(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().default(sql`now()`),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
