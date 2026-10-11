import pg from 'pg';
import type { DatabaseProbe } from '../../ports/database-probe.js';

/** Reachability probe: `select 1` on a tiny dedicated pool, bounded by a timeout. */
export class PgDatabaseProbe implements DatabaseProbe {
  private readonly pool: pg.Pool;

  constructor(connectionString: string, timeoutMs = 2000) {
    this.pool = new pg.Pool({
      connectionString,
      max: 1,
      connectionTimeoutMillis: timeoutMs,
      query_timeout: timeoutMs,
      idleTimeoutMillis: 10_000,
    });
    // An idle client error must not crash the process; the next probe reports the outage.
    this.pool.on('error', () => undefined);
  }

  async isReachable(): Promise<boolean> {
    try {
      await this.pool.query('select 1');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
