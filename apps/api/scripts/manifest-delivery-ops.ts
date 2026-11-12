// Run with the worker's database credentials and schema. No consumers, migrations or schedules are started here.
import { PgBoss } from 'pg-boss';
import pg from 'pg';
import { withStoreContext } from '@slips/db';
import { PinoTelemetry } from '../src/adapters/telemetry/pino-telemetry.js';
import { enqueueManifestCompile } from '../src/worker/publishing-jobs.js';
import { MANIFEST_COMPILE_QUEUE } from '../src/modules/publishing/manifest-inputs.js';
import { MANIFEST_DELIVERY_QUEUE } from '../src/modules/publishing/manifest-delivery.js';

const [command, kindOrStore, selectedStore] = process.argv.slice(2);
const storeId = command === 'redrive' ? selectedStore : kindOrStore;
if (!process.env.DATABASE_URL || (storeId && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(storeId))) throw new Error('Set DATABASE_URL and use a UUID store id');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const boss = new PgBoss({ connectionString: process.env.DATABASE_URL, schema: process.env.PG_BOSS_SCHEMA ?? 'pgboss', migrate: false, supervise: false, schedule: false });
boss.on('error', () => undefined);
const telemetry = new PinoTelemetry({ role: 'worker', level: 'silent' });
try {
  await boss.start();
  if (command === 'backfill') {
    let after: string | null = null;
    let queued = 0;
    for (;;) {
      const result: pg.QueryResult<{ id: string }> = await pool.query('select id::text as id from active_store_ids($1::uuid,$2::int) as id', [after, 250]);
      if (!result.rows.length) break;
      for (const row of result.rows) {
        if (storeId && row.id !== storeId) continue;
        if (await withStoreContext(pool, row.id, tx => enqueueManifestCompile(boss, tx, telemetry, row.id, new Date().toISOString()))) queued++;
      }
      after = result.rows.at(-1)!.id;
    }
    console.info(JSON.stringify({ queued }));
  } else if (command === 'redrive' && storeId) {
    const kinds: Record<string, { queue: string; phase?: string; cleanup?: boolean }> = {
      compile: { queue: MANIFEST_COMPILE_QUEUE },
      upload: { queue: MANIFEST_DELIVERY_QUEUE, phase: 'upload', cleanup: false },
      purge: { queue: MANIFEST_DELIVERY_QUEUE, phase: 'purge', cleanup: false },
      'cleanup-upload': { queue: MANIFEST_DELIVERY_QUEUE, phase: 'upload', cleanup: true },
      'cleanup-purge': { queue: MANIFEST_DELIVERY_QUEUE, phase: 'purge', cleanup: true },
    };
    const kind = kinds[kindOrStore ?? ''];
    if (!kind) throw new Error('Invalid redrive phase');
    const { queue, ...filter } = kind;
    const options = { sourceName: queue, destination: queue, data: { store_id: storeId, ...filter }, createdBefore: new Date(), limit: 100 };
    console.info(JSON.stringify({ preview: await boss.previewRedrive(`${queue}.dead_letter`, options), moved: await boss.redrive(`${queue}.dead_letter`, options) }));
  } else if (command === 'status' && storeId) {
    for (const queue of [MANIFEST_COMPILE_QUEUE, MANIFEST_DELIVERY_QUEUE]) {
      for (const name of [queue, `${queue}.dead_letter`]) {
        const jobs = await boss.findJobs<{ phase?: string; cleanup?: boolean }>(name, { data: { store_id: storeId } });
        console.info(JSON.stringify({ queue: name, jobs: jobs.map(job => ({ id: job.id, state: job.state, phase: job.data.phase, cleanup: job.data.cleanup })) }));
      }
    }
    const state = await withStoreContext(pool, storeId, tx => tx.query('select revision,install_epoch,content_hash,uploaded_hash,delivered_hash,failed,requested_at,delivered_at from manifest_deliveries where store_id=$1', [storeId]));
    const manifest = await withStoreContext(pool, storeId, tx => tx.query('select exists(select 1 from store_manifests where store_id=$1) as present', [storeId]));
    console.info(JSON.stringify({ delivery: state.rows, manifestPresent: manifest.rows[0]!.present }));
  } else throw new Error('Usage: backfill [store-id] | redrive <compile|upload|purge|cleanup-upload|cleanup-purge> <store-id> | status <store-id>');
} finally {
  await boss.stop({ graceful: true });
  await pool.end();
}
