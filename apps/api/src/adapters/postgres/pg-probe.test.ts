import { describe, expect, it } from 'vitest';
import { PgDatabaseProbe } from './pg-probe.js';

// Local test database / CI service container (see .github/workflows/ci.yml).
const LIVE = 'postgres://slips:slips@127.0.0.1:5433/slips';

describe('PgDatabaseProbe', () => {
  it('is reachable against a live database', async () => {
    const probe = new PgDatabaseProbe(LIVE);
    try {
      expect(await probe.isReachable()).toBe(true);
    } finally {
      await probe.close();
    }
  });

  it('reports unreachable (without throwing) when nothing listens', async () => {
    const probe = new PgDatabaseProbe('postgres://slips:slips@127.0.0.1:1/slips', 500);
    try {
      expect(await probe.isReachable()).toBe(false);
    } finally {
      await probe.close();
    }
  });
});
