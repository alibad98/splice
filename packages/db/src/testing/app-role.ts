import type { Pool } from 'pg';

const NAME = /^[a-z_][a-z0-9_]*$/;

/**
 * Test helper: a login role that inherits `slips_app` (non-superuser, non-owner, no BYPASSRLS) so tests can
 * exercise RLS without touching the shared `slips_app` login flag. Idempotent. `admin` must be privileged.
 */
export async function ensureTestAppRole(admin: Pool, name: string, password: string): Promise<void> {
  if (!NAME.test(name) || !/^[A-Za-z0-9_]+$/.test(password)) throw new Error('unsafe test role name or password');
  const client = await admin.connect();
  try {
    await client.query('select pg_advisory_lock(7140818002)');
    const exists = await client.query('select 1 from pg_roles where rolname = $1', [name]);
    if (exists.rowCount === 0) await client.query(`create role "${name}" login nosuperuser nobypassrls password '${password}' in role slips_app`);
  } finally {
    await client.query('select pg_advisory_unlock(7140818002)').catch(() => undefined);
    client.release();
  }
}
