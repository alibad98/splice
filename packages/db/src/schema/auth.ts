// Tables owned by the `session` module: email/password identity (migration 0011). Not tenant tables: a login is read
// across stores at sign-in, before a store is chosen, so they carry no store_id (the link column is linked_store_id).
import { sql } from 'drizzle-orm';
import { integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { stores } from './integration.js';

const now = () => timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`);

export const OTP_PURPOSES = ['setup', 'reset'] as const;
export type OtpPurposeDb = (typeof OTP_PURPOSES)[number];

/** One login per (lower-case) email. `passwordHash` is null until the owner accepts the setup invite. */
export const merchantLogins = pgTable('merchant_logins', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  passwordSetAt: timestamp('password_set_at', { withTimezone: true }),
  createdAt: now(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
});

/** The stores a login may open: every store whose owner email matched at install. */
export const merchantLoginStores = pgTable(
  'merchant_login_stores',
  {
    loginId: uuid('login_id').notNull().references(() => merchantLogins.id, { onDelete: 'cascade' }),
    linkedStoreId: uuid('linked_store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    createdAt: now(),
  },
  (t) => [primaryKey({ columns: [t.loginId, t.linkedStoreId] })],
);

/** Single-use codes for the setup invite and password reset. */
export const loginOtps = pgTable('login_otps', {
  id: uuid('id').primaryKey().defaultRandom(),
  loginId: uuid('login_id').notNull().references(() => merchantLogins.id, { onDelete: 'cascade' }),
  purpose: text('purpose').$type<OtpPurposeDb>().notNull(),
  codeHash: text('code_hash').notNull(),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: now(),
});
