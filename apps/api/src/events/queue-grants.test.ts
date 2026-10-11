import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PinoTelemetry } from '../adapters/telemetry/pino-telemetry.js';
import { grantEventPublishing } from './queue-grants.js';

const telemetry = new PinoTelemetry({ role: 'worker', level: 'silent' });

function fakePool(roleExists: boolean) {
  const statements: string[] = [];
  const client = { query: vi.fn(async (t: string) => void statements.push(t)), release: vi.fn() };
  const pool = { query: vi.fn(async (t: string) => (t.includes('pg_roles') ? { rowCount: roleExists ? 1 : 0, rows: [] } : { rowCount: 1, rows: [{ table_name: 'job_common' }] })), connect: vi.fn(async () => client) } as unknown as Pool;
  return { pool, statements };
}

describe('grantEventPublishing', () => {
  it('grants only usage, insert and select(id) on the queue table plus queue settings columns, and revokes broader grants', async () => {
    const { pool, statements } = fakePool(true);
    await grantEventPublishing(pool, telemetry, 'events.dispatch');
    expect(statements).toEqual([
      'REVOKE ALL ON ALL TABLES IN SCHEMA pgboss FROM slips_app',
      'ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss REVOKE ALL ON TABLES FROM slips_app',
      'GRANT USAGE ON SCHEMA pgboss TO slips_app',
      'GRANT INSERT, SELECT (id) ON pgboss.job_common TO slips_app',
      expect.stringMatching(/^GRANT SELECT \(name, expire_seconds.*\) ON pgboss\.queue TO slips_app$/),
    ]);
  });
  it('does nothing when the app role does not exist yet, and refuses unsafe identifiers', async () => {
    const { pool, statements } = fakePool(false);
    await grantEventPublishing(pool, telemetry, 'events.dispatch');
    expect(statements).toEqual([]);
    await expect(grantEventPublishing(pool, telemetry, 'events.dispatch', 'x; drop table y')).rejects.toThrow('unsafe');
  });
});
