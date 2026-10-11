import { withStoreContext } from '@slips/db';
import { EVENT_CATALOG, EventEnvelope, isEventName, type EventName, type EventPayload } from '@slips/contracts';
import type { Pool } from 'pg';
import type { JobHandler } from '../adapters/telemetry/jobs.js';
import type { TxQueryable } from './outbox.js';

/** Runs inside the delivery transaction, so its writes and the delivery record commit together. */
export type EventHandler<N extends EventName> = (event: { id: string; name: N; payload: EventPayload<N> }, tx: TxQueryable) => Promise<void>;

/** Handlers per event, registered in the worker role only. A handler id is unique and names its ledger row. */
export class EventHandlerRegistry {
  private readonly byEvent = new Map<string, Array<{ id: string; run: EventHandler<never> }>>();
  private readonly ids = new Set<string>();

  on<N extends EventName>(name: N, handlerId: string, handler: EventHandler<N>): this {
    if (!isEventName(name)) throw new Error(`unknown domain event ${String(name)}`);
    if (this.ids.has(handlerId)) throw new Error(`duplicate event handler id ${handlerId}`);
    this.ids.add(handlerId);
    this.byEvent.set(name, [...(this.byEvent.get(name) ?? []), { id: handlerId, run: handler as EventHandler<never> }]);
    return this;
  }

  handlersFor(name: string): ReadonlyArray<{ id: string; run: EventHandler<never> }> {
    return this.byEvent.get(name) ?? [];
  }
}

/**
 * The `events.dispatch` job handler: validate the envelope and payload, then run each handler for the event
 * once. A handler's effect and its `event_deliveries` row commit in one transaction (in the event's store
 * context when it carries a `store_id`), so a redelivery of the same event id skips handlers that already ran.
 * A failing handler fails the job; the retry skips the handlers that succeeded.
 */
export function eventDispatcher(pool: Pool, registry: EventHandlerRegistry): JobHandler {
  return async (data) => {
    const env = EventEnvelope.parse(data);
    if (!isEventName(env.name)) throw new Error(`unknown domain event ${env.name}`);
    const payload: unknown = EVENT_CATALOG[env.name].schema.parse(env.payload);
    const handlers = registry.handlersFor(env.name);
    if (handlers.length === 0) throw new Error(`no handler registered for domain event ${env.name}`);
    const payloadStore = (payload as { store_id?: unknown } | null)?.store_id;
    if (payloadStore !== undefined && payloadStore !== env.store_id) throw new Error(`domain event ${env.name}: envelope store_id does not match payload store_id`);
    // Every handler runs in its own transaction; one failing never starves the others. Only failures re-run on retry.
    const failures: unknown[] = [];
    for (const handler of handlers) {
      const deliver = async (tx: TxQueryable): Promise<void> => {
        const claimed = await tx.query('insert into event_deliveries (event_id, handler) values ($1, $2) on conflict do nothing returning event_id', [env.event_id, handler.id]);
        if (claimed.rows.length === 0) return;
        await handler.run({ id: env.event_id, name: env.name, payload } as never, tx);
      };
      try {
        if (env.store_id) await withStoreContext(pool, env.store_id, deliver);
        else await inTransaction(pool, deliver);
      } catch (err) {
        failures.push(err);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, `${failures.length} handlers failed for domain event ${env.name}`);
  };
}

async function inTransaction(pool: Pool, fn: (tx: TxQueryable) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  let destroy = false;
  try {
    await client.query('BEGIN');
    await fn(client);
    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      destroy = true;
    }
    throw err;
  } finally {
    client.release(destroy);
  }
}
