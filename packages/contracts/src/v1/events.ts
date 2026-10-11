import { z } from 'zod';
import { JobMeta } from './job-meta.js';

/** Modules that may own a domain event (the spine's module list). */
export const EVENT_OWNERS = ['integration', 'catalog', 'content', 'media', 'publishing', 'analytics', 'attribution', 'billing', 'admin'] as const;
export type EventOwner = (typeof EVENT_OWNERS)[number];

/** `<module>.<entity>.<past-verb>`, lowercase snake_case segments. */
export const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export interface EventDefinition<S extends z.ZodType = z.ZodType> {
  /** The module that emits it; the name's first segment must equal it. */
  owner: EventOwner;
  /** v1 payload schema; carries `v: 1`. Additive changes only. */
  schema: S;
}

const defineEvent = <S extends z.ZodType>(owner: EventOwner, schema: S): EventDefinition<S> => ({ owner, schema });

/** The event catalogue (AD-17). Add events here with their owner; names outside it do not compile. */
export const EVENT_CATALOG = {
  'integration.store.installed': defineEvent(
    'integration',
    z.object({ v: z.literal(1), store_id: z.uuid(), install_epoch: z.number().int().nonnegative() }),
  ),
  'integration.store.disconnected': defineEvent(
    'integration',
    z.object({ v: z.literal(1), store_id: z.uuid(), install_epoch: z.number().int().nonnegative(), reason: z.enum(['refresh_rejected']) }),
  ),
} as const;

export type EventName = keyof typeof EVENT_CATALOG;
export type EventPayload<N extends EventName> = z.infer<(typeof EVENT_CATALOG)[N]['schema']>;

export function isEventName(name: string): name is EventName {
  return Object.hasOwn(EVENT_CATALOG, name);
}

/** The job payload of the event queue: the job envelope plus the event identity and payload. */
export const EventEnvelope = JobMeta.extend({
  event_id: z.uuid(),
  name: z.string().regex(EVENT_NAME_PATTERN),
  occurred_at: z.iso.datetime(),
  payload: z.unknown(),
});
export type EventEnvelope = z.infer<typeof EventEnvelope>;

/** Queue that carries every domain event; consumed only by the worker role. */
export const EVENT_QUEUE = 'events.dispatch';
