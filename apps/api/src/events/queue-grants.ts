import type { Pool } from 'pg';
import type { Telemetry } from '../ports/telemetry.js';

const IDENT = /^[a-z_][a-z0-9_]*$/;
const QUEUE_SETTING_COLUMNS =
  'name, expire_seconds, deletion_seconds, retention_seconds, retry_limit, retry_delay, retry_backoff, retry_delay_max, policy, dead_letter, heartbeat_seconds';

/**
 * Lets the app role enqueue events from its own domain transactions (AD-17 outbox: `publishEvent` inserts into the
 * event queue's pg-boss job table on the caller's transaction). Least privilege: USAGE on the schema, INSERT on the
 * one table backing `queue`, SELECT on its `id` column only (the insert returns the id) and on the queue-settings
 * columns of `queue` that the insert joins. The role can not read
 * job payloads, touch other queues' tables, or write pg-boss internals (queue, schedule, version...). Earlier broad
 * grants and default privileges are revoked. Run by the worker at boot with the role that owns the pg-boss schema,
 * after the queue exists. Idempotent; a no-op when the app role or the queue does not exist yet.
 */
export async function grantEventPublishing(pool: Pool, telemetry: Telemetry, queue: string, schema = 'pgboss', appRole = 'slips_app'): Promise<void> {
  if (!IDENT.test(schema) || !IDENT.test(appRole)) throw new Error('unsafe identifier');
  const role = await pool.query('select 1 from pg_roles where rolname = $1', [appRole]);
  if (role.rowCount === 0) {
    telemetry.log.warn('event publishing grants skipped: app role does not exist', { role: appRole });
    return;
  }
  const found = await pool.query<{ table_name: string }>(`select table_name from ${schema}.queue where name = $1`, [queue]);
  const table = found.rows[0]?.table_name;
  if (!table) {
    telemetry.log.warn('event publishing grants skipped: queue does not exist', { queue });
    return;
  }
  if (!IDENT.test(table)) throw new Error('unsafe identifier');
  const client = await pool.connect();
  try {
    await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA ${schema} FROM ${appRole}`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} REVOKE ALL ON TABLES FROM ${appRole}`);
    await client.query(`GRANT USAGE ON SCHEMA ${schema} TO ${appRole}`);
    await client.query(`GRANT INSERT, SELECT (id) ON ${schema}.${table} TO ${appRole}`);
    // The insert joins the queue's settings (retry, expiry, policy, dead letter): grant those columns only.
    await client.query(`GRANT SELECT (${QUEUE_SETTING_COLUMNS}) ON ${schema}.queue TO ${appRole}`);
  } finally {
    client.release();
  }
}
