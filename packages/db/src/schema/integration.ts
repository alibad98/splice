// Tables owned by the `integration` module (AD-2). Tenant tables carry store_id with forced RLS (migration 0004).
import { sql } from 'drizzle-orm';
import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const STORE_PLATFORMS = ['salla'] as const;
export type StorePlatform = (typeof STORE_PLATFORMS)[number];
/** AD-20: active -> disconnected -> uninstalled (30-day grace) -> purged. Uninstall, grace and purge: Story 1.10. */
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
  /** Set when the store becomes `uninstalled`; the 30-day grace ends at `graceEndsAt` (AD-20). */
  uninstalledAt: timestamp('uninstalled_at', { withTimezone: true }),
  graceEndsAt: timestamp('grace_ends_at', { withTimezone: true }),
  purgedAt: timestamp('purged_at', { withTimezone: true }),
  /** When the current install epoch began; a webhook older than this belongs to an earlier epoch and is dropped. */
  epochStartedAt: timestamp('epoch_started_at', { withTimezone: true }).notNull().default(sql`now()`),
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
  /** Platform user who opened an embedded session (audit); null for direct-link sessions. */
  platformUserId: text('platform_user_id'),
  createdAt: now(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().default(sql`now()`),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const WEBHOOK_STATUSES = ['pending', 'processed', 'ignored', 'dead_lettered'] as const;
export type WebhookStatus = (typeof WEBHOOK_STATUSES)[number];

/** Verified webhooks (AD-13). Canonical PII-free payload only; not a tenant table because the store may not exist yet. */
export const webhookInbox = pgTable('webhook_inbox', {
  id: uuid('id').primaryKey(),
  platform: text('platform').$type<StorePlatform>().notNull(),
  eventId: text('event_id').notNull(),
  type: text('type').notNull(),
  platformStoreId: text('platform_store_id').notNull(),
  bodyHash: text('body_hash').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  secretEnc: text('secret_enc'),
  secretKeyId: text('secret_key_id'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }),
  status: text('status').$type<WebhookStatus>().notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().default(sql`now()`),
  parkedSince: timestamp('parked_since', { withTimezone: true }),
  lastError: text('last_error'),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().default(sql`now()`),
  processedAt: timestamp('processed_at', { withTimezone: true }),
});

/** Resumable per-store data jobs (the purge). One row per (store, kind, install epoch). */
export const storeDataJobs = pgTable('store_data_jobs', {
  id: uuid('id').primaryKey(),
  storeId: uuid('store_id').notNull(),
  kind: text('kind').$type<'purge'>().notNull(),
  installEpoch: integer('install_epoch').notNull(),
  status: text('status').$type<'running' | 'completed' | 'aborted'>().notNull().default('running'),
  completedModules: text('completed_modules').array().notNull().default(sql`'{}'::text[]`),
  batches: integer('batches').notNull().default(0),
  abortReason: text('abort_reason'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

/** Append-only lifecycle trail keyed by the platform locator so it survives a purge. No PII. */
export const lifecycleAudit = pgTable('lifecycle_audit', {
  id: uuid('id').primaryKey(),
  platform: text('platform').$type<StorePlatform>().notNull(),
  platformStoreId: text('platform_store_id').notNull(),
  action: text('action').notNull(),
  installEpoch: integer('install_epoch').notNull(),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  at: timestamp('at', { withTimezone: true }).notNull().default(sql`now()`),
});

/** Uninstalled stores awaiting purge, readable across tenants for the sweep. One row per store; replaced on uninstall, removed on reinstall or purge. */
export const storePurgeSchedule = pgTable('store_purge_schedule', {
  id: uuid('id').primaryKey(),
  installEpoch: integer('install_epoch').notNull(),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
});
