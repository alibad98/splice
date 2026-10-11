import type { Pool } from 'pg';
import type { Telemetry } from '../ports/telemetry.js';

const IDENT = /^[a-z_][a-z0-9_]*$/;

/**
 * Lets the app role enqueue events from its own domain transactions (AD-17 outbox: `publishEvent` inserts into
 * pg-boss job tables on the caller's transaction, so the caller's role needs INSERT there; RETURNING id needs
 * SELECT). Run by the worker at boot with the role that owns the pg-boss schema, after queues exist. Default
 * privileges cover queue tables created later by that same role. Idempotent; a no-op when the app role does not
 * exist yet (migrations not applied).
 */
export async function grantEventPublishing(pool: Pool, telemetry: Telemetry, schema = 'pgboss', appRole = 'slips_app'): Promise<void> {
  if (!IDENT.test(schema) || !IDENT.test(appRole)) throw new Error('unsafe identifier');
  const role = await pool.query('select 1 from pg_roles where rolname = $1', [appRole]);
  if (role.rowCount === 0) {
    telemetry.log.warn('event publishing grants skipped: app role does not exist', { role: appRole });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query(`GRANT USAGE ON SCHEMA ${schema} TO ${appRole}`);
    await client.query(`GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA ${schema} TO ${appRole}`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT SELECT, INSERT ON TABLES TO ${appRole}`);
  } finally {
    client.release();
  }
}
