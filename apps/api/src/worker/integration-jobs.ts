// Worker-side jobs of the integration module: the webhook inbox sweep and the store purge (AD-13, AD-20).
import { isEventName, type EventName } from '@slips/contracts';
import { randomBytes } from 'node:crypto';
import type { JobHandler } from '../adapters/telemetry/jobs.js';
import type { EventHandlerRegistry } from '../events/dispatcher.js';
import type { IntegrationService } from '../modules/integration/integration.service.js';
import { Metric, type Telemetry } from '../ports/telemetry.js';
import { z } from 'zod';

export const WEBHOOK_SWEEP_QUEUE = 'integration.webhook.sweep';
export const STORE_PURGE_QUEUE = 'integration.store.purge';
/** Gauge label for webhook_inbox rows that gave up; matches the `integration.webhook*` dead-letter alert. */
export const WEBHOOK_INBOX_DEAD_LETTER = 'integration.webhook.inbox';
export const SWEEP_CRON = '* * * * *';

const PurgeJob = z.object({ v: z.literal(1), trace_id: z.string(), store_id: z.uuid(), install_epoch: z.number().int().min(1) });

export interface JobSender {
  send(queue: string, data: object, options?: Record<string, unknown>): Promise<string | null>;
}

export function integrationJobHandlers(service: IntegrationService, telemetry: Telemetry, boss: JobSender): Record<string, JobHandler> {
  return {
    // Every minute: finish webhooks not handled inline (authorize, retries, parked), then queue purges that are due.
    [WEBHOOK_SWEEP_QUEUE]: async () => {
      await service.inbox.processDue();
      telemetry.gauge(Metric.DeadLetterDepth, await service.inbox.deadLetterCount(), { queue: WEBHOOK_INBOX_DEAD_LETTER });
      for (const due of await service.lifecycle.duePurges()) {
        await boss.send(
          STORE_PURGE_QUEUE,
          { v: 1, trace_id: randomBytes(16).toString('hex'), store_id: due.storeId, install_epoch: due.installEpoch },
          { singletonKey: `${due.storeId}:${due.installEpoch}`, singletonSeconds: 300 },
        );
      }
    },
    [STORE_PURGE_QUEUE]: async (data) => {
      const job = PurgeJob.parse(data);
      const outcome = await service.lifecycle.purge(job.store_id, job.install_epoch);
      telemetry.log.info('store purge job finished', { outcome, install_epoch: job.install_epoch });
    },
  };
}

/** Lifecycle events have no module reacting yet (Epics 2-7 subscribe); a logging handler keeps the dispatcher from failing them. */
export function registerIntegrationEventHandlers(registry: EventHandlerRegistry, telemetry: Telemetry): void {
  const names = ['integration.store.installed', 'integration.store.disconnected', 'integration.store.uninstalled', 'integration.store.reinstalled', 'integration.store.purged'] as const satisfies readonly EventName[];
  for (const name of names) {
    if (!isEventName(name)) continue;
    registry.on(name, `integration.log.${name}`, async (event) => {
      telemetry.log.info('lifecycle event', { event: name, event_id: event.id });
    });
  }
}
