import { createServer, type Server } from 'node:http';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { EVENT_QUEUE } from '@slips/contracts';
import { EventHandlerRegistry, eventDispatcher } from '../events/dispatcher.js';
import { grantEventPublishing } from '../events/queue-grants.js';
import { HealthResponse } from '@slips/contracts';
import { isAuthorizedForMetrics } from '../adapters/telemetry/http.js';
import { instrumentJob, type JobHandler } from '../adapters/telemetry/jobs.js';
import { startQueueStatsPoller } from '../adapters/telemetry/queue-stats.js';
import { IntegrationService } from '../modules/integration/integration.service.js';
import { SWEEP_CRON, WEBHOOK_SWEEP_QUEUE, integrationJobHandlers, registerIntegrationEventHandlers } from './integration-jobs.js';
import { buildInfra } from '../http.js';
import type { Env } from '../config/env.js';
import type { DatabaseProbe } from '../ports/database-probe.js';
import { Metric, type Telemetry } from '../ports/telemetry.js';
import { GROUP_POLICY, QUEUES, deadLetterName, queueOptions, queuesFor, type QueueDefinition } from './queues.js';

/** The slice of PgBoss queue registration used, so it can be tested with a fake. */
export interface QueueRegistrar {
  createQueue(name: string, options?: Record<string, unknown>): Promise<unknown>;
  work(name: string, options: { localConcurrency: number }, handler: (jobs: Array<{ id: string; data: unknown }>) => Promise<void>): Promise<unknown>;
}

/**
 * Create each queue (plus its dead-letter queue) with its group policy and attach an instrumented handler.
 * A queue without a handler is a boot error rather than a job that burns its retries.
 */
export async function registerQueues(
  boss: QueueRegistrar,
  telemetry: Telemetry,
  queues: readonly QueueDefinition[],
  handlers: Readonly<Record<string, JobHandler>>,
): Promise<void> {
  for (const queue of queues) {
    const handler = handlers[queue.name];
    if (!handler) throw new Error(`no handler registered for queue ${queue.name}`);
    const dead = deadLetterName(queue.name);
    await boss.createQueue(dead);
    await boss.createQueue(queue.name, { ...queueOptions(queue.group), deadLetter: dead });
    await boss.work(queue.name, { localConcurrency: GROUP_POLICY[queue.group].concurrency }, instrumentJob(telemetry, queue.name, handler));
  }
}

export interface WorkerHttpOptions {
  port: number;
  probe: DatabaseProbe;
  telemetry: Telemetry;
  version: string;
  render(): string;
  metricsToken: string | undefined;
}

/** Worker liveness and metrics server: `GET /health` (200 ok, 503 degraded) and `GET /metrics`. */
export function startWorkerHttp(opts: WorkerHttpOptions): Promise<Server> {
  const server = createServer((req, res) => {
    void (async () => {
      const path = (req.url ?? '/').split('?')[0];
      if (req.method === 'GET' && path === '/health') {
        const up = await opts.probe.isReachable();
        opts.telemetry.gauge(Metric.WorkerUp, up ? 1 : 0);
        const body = HealthResponse.parse({
          status: up ? 'ok' : 'degraded',
          role: 'worker',
          version: opts.version,
          time: new Date().toISOString(),
          checks: { database: up ? 'ok' : 'down' },
        });
        res.writeHead(up ? 200 : 503, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      } else if (req.method === 'GET' && path === '/metrics') {
        if (!opts.metricsToken) res.writeHead(404).end();
        else if (!isAuthorizedForMetrics(req.headers.authorization, opts.metricsToken)) res.writeHead(401).end();
        else res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' }).end(opts.render());
      } else {
        res.writeHead(404).end();
      }
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, () => resolve(server));
  });
}

/** Boot the worker role: connect pg-boss, register the selected queue groups, expose liveness and metrics. */
export async function startWorker(
  env: Env,
  queues: readonly QueueDefinition[] = QUEUES,
  handlers: Readonly<Record<string, JobHandler>> = {},
  events: EventHandlerRegistry = new EventHandlerRegistry(),
): Promise<PgBoss> {
  const infra = buildInfra(env, 'worker');
  const { telemetry } = infra;
  const server = await startWorkerHttp({
    port: env.WORKER_HEALTH_PORT,
    probe: infra.probe,
    telemetry,
    version: env.APP_VERSION,
    render: infra.metrics.render,
    metricsToken: env.METRICS_TOKEN,
  });
  // Domain events are consumed here and nowhere else (AD-17); handlers run in the worker's own pool.
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 4 });
  pool.on('error', () => undefined);
  const boss = new PgBoss({ connectionString: env.DATABASE_URL, persistQueueStats: true });
  boss.on('error', (err) => telemetry.captureError(err, { component: 'pg-boss' }));
  // The worker publishes through its own pg-boss; the integration service runs on the worker's pool.
  const integration = new IntegrationService(pool, infra.platform, infra.cipher, telemetry, boss, infra.integration, infra.lifecycles, infra.installListeners);
  registerIntegrationEventHandlers(events, telemetry);
  const allHandlers = { [EVENT_QUEUE]: eventDispatcher(pool, events), ...integrationJobHandlers(integration, telemetry, boss), ...handlers };
  let stopPoller = () => {};
  try {
    await boss.start();
    const selected = queuesFor(env.WORKER_QUEUES, queues);
    await registerQueues(boss, telemetry, selected, allHandlers);
    await grantEventPublishing(pool, telemetry, EVENT_QUEUE);
    if (selected.some((q) => q.name === WEBHOOK_SWEEP_QUEUE)) await boss.schedule(WEBHOOK_SWEEP_QUEUE, SWEEP_CRON, { v: 1, trace_id: 'schedule' });
    stopPoller = startQueueStatsPoller(
      boss,
      selected.map((q) => ({ name: q.name, deadLetter: deadLetterName(q.name) })),
      telemetry,
      30_000,
      infra.probe,
    );
  } catch (err) {
    server.close();
    await boss.stop({ graceful: false }).catch(() => undefined);
    await pool.end().catch(() => undefined);
    await infra.pool.end().catch(() => undefined);
    throw err;
  }

  telemetry.log.info('worker started', { queue_groups: env.WORKER_QUEUES, health_port: env.WORKER_HEALTH_PORT });

  const shutdown = async () => {
    try {
      stopPoller();
      server.close();
      await boss.stop({ graceful: true });
      await pool.end();
      await infra.probe.close();
      await infra.pool.end();
      process.exit(0);
    } catch (err) {
      telemetry.captureError(err, { component: 'shutdown' });
      process.exit(1);
    }
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return boss;
}
