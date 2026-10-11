import { PgBoss } from 'pg-boss';
import type { EventSender } from '../../events/outbox.js';
import type { Telemetry } from '../../ports/telemetry.js';

/**
 * Send-only pg-boss producer for the http role (AD-17: http publishes, only the worker consumes). It starts
 * lazily on first publish, runs no migrations, supervision or scheduling, and never calls work/fetch/subscribe.
 * The events queue is created by the worker at boot; publishing before the first worker boot fails on its FK.
 */
export class SendOnlyEventSender implements EventSender {
  private boss: Promise<PgBoss> | undefined;

  constructor(
    private readonly connectionString: string,
    private readonly telemetry: Telemetry,
    private readonly schema?: string,
  ) {}

  private ready(): Promise<PgBoss> {
    this.boss ??= (async () => {
      const boss = new PgBoss({ connectionString: this.connectionString, migrate: false, supervise: false, schedule: false, max: 2, ...(this.schema ? { schema: this.schema } : {}) });
      boss.on('error', (err) => this.telemetry.captureError(err, { component: 'pg-boss-producer' }));
      await boss.start();
      return boss;
    })();
    // A failed start is retried by the next publish instead of being cached.
    this.boss.catch(() => {
      this.boss = undefined;
    });
    return this.boss;
  }

  async send(queue: string, data: object, options: Parameters<EventSender['send']>[2]): Promise<string | null> {
    return (await this.ready()).send(queue, data, options);
  }

  async close(): Promise<void> {
    const boss = this.boss;
    this.boss = undefined;
    if (boss) await (await boss.catch(() => undefined))?.stop({ graceful: true, close: true }).catch(() => undefined);
  }
}
