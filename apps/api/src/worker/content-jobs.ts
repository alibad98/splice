// Worker-side event handlers of the content module (Story 3.1).
import { CONTENT_EVENT_NAMES, isEventName, type EventName } from '@slips/contracts';
import type { EventHandlerRegistry } from '../events/dispatcher.js';
import type { Telemetry } from '../ports/telemetry.js';

/** Logs every content lifecycle event (the dispatcher requires a handler; publishing in Epic 4 adds its own). */
export function registerContentEventHandlers(registry: EventHandlerRegistry, telemetry: Telemetry): void {
  const names = CONTENT_EVENT_NAMES satisfies readonly EventName[];
  for (const name of names) {
    if (!isEventName(name)) continue;
    registry.on(name, `content.log.${name}`, async (event) => {
      telemetry.log.info('content event', { event: name, event_id: event.id, content_id: event.payload.content_id });
    });
  }
}
