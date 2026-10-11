import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PinoTelemetry } from '../adapters/telemetry/pino-telemetry.js';
import { grantEventPublishing } from './queue-grants.js';

const telemetry = new PinoTelemetry({ role: 'worker', level: 'silent' });

function fakePool(roleExists: boolean) {
  const statements: string[] = [];
  const client = { query: vi.fn(async (t: string) => void statements.push(t)), release: vi.fn() };
  const pool = { query: vi.fn(async () => ({ rowCount: roleExists ? 1 : 0, rows: [] })), connect: vi.fn(async () => client) } as unknown as Pool;
  return { pool, statements };
}

describe('grantEventPublishing', () => {
  it('grants usage, insert and select, and default privileges for later queue tables', async () => {
    const { pool, statements } = fakePool(true);
    await grantEventPublishing(pool, telemetry);
    expect(statements).toEqual([
      'GRANT USAGE ON SCHEMA pgboss TO slips_app',
      'GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA pgboss TO slips_app',
      'ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss GRANT SELECT, INSERT ON TABLES TO slips_app',
    ]);
  });
  it('does nothing when the app role does not exist yet, and refuses unsafe identifiers', async () => {
    const { pool, statements } = fakePool(false);
    await grantEventPublishing(pool, telemetry);
    expect(statements).toEqual([]);
    await expect(grantEventPublishing(pool, telemetry, 'x; drop table y')).rejects.toThrow('unsafe');
  });
});
