import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { currentStoreContext } from '@slips/db';
import { storeScopedJob } from './store-job.js';

const STORE = '11111111-1111-4111-8111-111111111111';

function fakePool() {
  const log: Array<[string, unknown[] | undefined]> = [];
  const client = { query: (t: string, v?: unknown[]) => (log.push([t, v]), Promise.resolve({ rows: [], rowCount: 0 })), release: () => log.push(['release', undefined]) };
  return { pool: { connect: () => Promise.resolve(client) } as unknown as Pool, log };
}

describe('storeScopedJob', () => {
  it('runs the handler in the job store context between BEGIN and COMMIT, and clears it after', async () => {
    const { pool, log } = fakePool();
    let seen: string | undefined;
    await storeScopedJob(pool, async () => {
      seen = currentStoreContext()?.storeId;
    })({ v: 1, trace_id: 't', store_id: STORE }, { id: 'j1', data: {} });
    expect(seen).toBe(STORE);
    expect(currentStoreContext()).toBeUndefined();
    expect(log.map(([t]) => t.split(' ')[0])).toEqual(['BEGIN', 'select', 'COMMIT', 'release']);
    expect(log[1]![1]).toEqual([STORE]);
  });

  it('fails a job with no store_id without opening a transaction', async () => {
    const { pool, log } = fakePool();
    await expect(storeScopedJob(pool, async () => {})({ v: 1, trace_id: 't' }, { id: 'j2', data: {} })).rejects.toThrow(/no store_id/);
    expect(log).toEqual([]);
  });

  it('rolls back and rethrows when the handler fails', async () => {
    const { pool, log } = fakePool();
    await expect(storeScopedJob(pool, async () => Promise.reject(new Error('x')))({ v: 1, trace_id: 't', store_id: STORE }, { id: 'j3', data: {} })).rejects.toThrow('x');
    expect(log.map(([t]) => t).includes('ROLLBACK')).toBe(true);
  });
});
