import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

export const MIGRATIONS_FOLDER = new URL('../migrations', import.meta.url).pathname;

/** Apply pending migrations. Run with the owner role, never the app role. */
export async function runMigrations(pool: Pool): Promise<void> {
  await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
}
