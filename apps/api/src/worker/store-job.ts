import { withStoreContext } from '@slips/db';
import { JobMeta } from '@slips/contracts';
import type { Pool } from 'pg';
import type { JobHandler } from '../adapters/telemetry/jobs.js';

/**
 * Wrap a handler for a tenant job: read `store_id` from the `JobMeta` envelope and run the handler inside
 * that store's context (one transaction, `SET LOCAL`), for this job only. A payload with no `store_id` fails
 * the job (cross-store work fans out one job per store, AD-3). Compose inside `instrumentJob`.
 */
export function storeScopedJob(pool: Pool, handler: JobHandler): JobHandler {
  return async (data, job) => {
    const meta = JobMeta.safeParse(data);
    if (!meta.success || !meta.data.store_id) throw new Error('tenant job payload has no store_id');
    await withStoreContext(pool, meta.data.store_id, () => handler(data, job));
  };
}
