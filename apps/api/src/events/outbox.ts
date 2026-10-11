import { randomBytes } from 'node:crypto';
import { EVENT_CATALOG, EVENT_QUEUE, type EventEnvelope, type EventName, type EventPayload } from '@slips/contracts';
import { jobMeta } from '../adapters/telemetry/jobs.js';
import type { Telemetry } from '../ports/telemetry.js';

/** Anything with a pg-style `query`: the open transaction of the state change (a store context, a PoolClient). */
export interface TxQueryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

/** The slice of PgBoss used to enqueue; `db` makes the insert run on the caller's transaction. */
export interface EventSender {
  send(queue: string, data: object, options: { id: string; db: { executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }> } }): Promise<string | null>;
}

/** UUIDv7 (time-ordered), the repo's id convention. */
export function uuidv7(now = Date.now()): string {
  const b = randomBytes(16);
  b.writeUIntBE(now, 0, 6);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export interface PublishOptions {
  /** Tenant events carry the store so the worker handler runs in that store's context. */
  storeId?: string;
}

/**
 * Transactional outbox (AD-17): enqueue a domain event on `tx`, the transaction that holds the state
 * change. Commit makes exactly one pg-boss job visible; rollback discards it. The payload is validated
 * against the catalogue and the job id is the event id, so a retried publish cannot enqueue it twice.
 * Returns the event id.
 */
export async function publishEvent<N extends EventName>(
  tx: TxQueryable,
  sender: EventSender,
  telemetry: Telemetry,
  name: N,
  payload: EventPayload<N>,
  options: PublishOptions = {},
): Promise<string> {
  const def = EVENT_CATALOG[name];
  if (!def) throw new Error(`unknown domain event ${String(name)}`);
  const parsed = def.schema.parse(payload);
  const event_id = uuidv7();
  const envelope: EventEnvelope = {
    ...jobMeta(telemetry, options.storeId),
    event_id,
    name,
    occurred_at: new Date().toISOString(),
    payload: parsed,
  };
  await sender.send(EVENT_QUEUE, envelope, { id: event_id, db: { executeSql: (text, values) => tx.query(text, values) } });
  return event_id;
}
