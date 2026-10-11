import { PgBoss } from 'pg-boss';
import type { Env } from '../config/env.js';
import { GROUP_POLICY, queueOptions, queuesFor } from './queues.js';

/** Boot the worker role: connect pg-boss and register only the selected queue groups. */
export async function startWorker(env: Env): Promise<PgBoss> {
  const boss = new PgBoss(env.DATABASE_URL);
  boss.on('error', (err) => console.error('[worker] pg-boss error', err));
  await boss.start();

  for (const queue of queuesFor(env.WORKER_QUEUES)) {
    await boss.createQueue(queue.name, queueOptions(queue.group));
    await boss.work(queue.name, { localConcurrency: GROUP_POLICY[queue.group].concurrency }, async () => {
      throw new Error(`no handler registered for ${queue.name}`);
    });
  }

  console.log(`[worker] registered queue groups: ${env.WORKER_QUEUES.join(', ')}`);

  const shutdown = async () => {
    try {
      await boss.stop({ graceful: true });
      process.exit(0);
    } catch (err) {
      console.error('[worker] shutdown failed', err);
      process.exit(1);
    }
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return boss;
}
