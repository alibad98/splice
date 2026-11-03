// Apply pending migrations to the database in MIGRATION_DATABASE_URL (else DATABASE_URL). Use the owner role, never
// the app role. Run from the repo root with `pnpm db:migrate` (builds @slips/db first and loads .env if present).
import pg from 'pg';
import { runMigrations } from '../dist/index.js';

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('db:migrate: set DATABASE_URL (or MIGRATION_DATABASE_URL) to the owner connection string');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 2 });
try {
  await runMigrations(pool);
  const { rows } = await pool.query('select count(*)::int as n from drizzle.__drizzle_migrations');
  console.log(`db:migrate: up to date (${rows[0].n} migrations applied) on ${new URL(url).host}`);
} catch (err) {
  console.error('db:migrate failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
