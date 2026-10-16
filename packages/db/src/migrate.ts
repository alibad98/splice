import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

/** Session-level advisory lock key so concurrent migrators (parallel test files, rolling deploys) run one at a time. */
const MIGRATION_LOCK_KEY = 7_140_818_001;

/** Apply pending migrations. Run with the owner role, never the app role. Serialised by an advisory lock. */
export async function runMigrations(pool: Pool): Promise<void> {
  const lock = await pool.connect();
  try {
    await lock.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    try {
      await lock.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
      lock.release();
    } catch {
      lock.release(true);
    }
  }
}
