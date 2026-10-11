import { describe, expect, it } from 'vitest';
import { EVENT_CATALOG, EVENT_NAME_PATTERN, EVENT_OWNERS, EventEnvelope, isEventName, type EventName, type EventPayload } from './events.js';

describe('event catalog', () => {
  it.each(Object.keys(EVENT_CATALOG))('%s is named <module>.<entity>.<past-verb>, owned by its first segment, with a v1 schema', (name) => {
    const def = EVENT_CATALOG[name as EventName];
    expect(name).toMatch(EVENT_NAME_PATTERN);
    expect(EVENT_OWNERS).toContain(def.owner);
    expect(name.split('.')[0]).toBe(def.owner);
    expect(def.schema.safeParse({}).success).toBe(false);
  });

  it('validates a payload against its v1 schema and rejects a wrong version', () => {
    const schema = EVENT_CATALOG['integration.store.installed'].schema;
    const ok: EventPayload<'integration.store.installed'> = { v: 1, store_id: '11111111-1111-4111-8111-111111111111', install_epoch: 1 };
    expect(schema.safeParse(ok).success).toBe(true);
    expect(schema.safeParse({ ...ok, v: 2 }).success).toBe(false);
  });

  it('rejects unknown names at compile time and at runtime', () => {
    // @ts-expect-error not in the catalog
    const bad: EventName = 'integration.store.exploded';
    expect(isEventName(bad)).toBe(false);
    expect(isEventName('integration.store.installed')).toBe(true);
  });

  it('envelope requires a uuid event id and a well-formed name', () => {
    const base = { v: 1, trace_id: 't', event_id: '11111111-1111-4111-8111-111111111111', name: 'a.b.c', occurred_at: new Date().toISOString(), payload: {} };
    expect(EventEnvelope.safeParse(base).success).toBe(true);
    expect(EventEnvelope.safeParse({ ...base, name: 'nope' }).success).toBe(false);
  });
});

describe('integration.store.disconnected', () => {
  it('requires a known reason', () => {
    const schema = EVENT_CATALOG['integration.store.disconnected'].schema;
    const ok = { v: 1, store_id: '11111111-1111-4111-8111-111111111111', install_epoch: 1, reason: 'refresh_rejected' };
    expect(schema.safeParse(ok).success).toBe(true);
    expect(schema.safeParse({ ...ok, reason: 'because' }).success).toBe(false);
  });
});
