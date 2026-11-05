// Worker-side event handlers of the content module (Stories 3.1, 3.4).
import { CONTENT_EVENT_NAMES, isEventName, type EventName } from '@slips/contracts';
import type { EventHandlerRegistry } from '../events/dispatcher.js';
import type { ContentLifecycle } from '../modules/content/content-lifecycle.js';
import type { Telemetry } from '../ports/telemetry.js';

/**
 * Logs every content lifecycle event (the dispatcher requires a handler; publishing in Epic 4 adds its own), and flags
 * content linked to a product deleted in the store (Story 3.4): `content.item.edited` (`changed: ['product_id']`) per
 * linked live item, emitted by `ContentLifecycle` in the delivery transaction, so a redelivery never emits twice.
 */
export function registerContentEventHandlers(registry: EventHandlerRegistry, telemetry: Telemetry, lifecycle: ContentLifecycle): void {
  const names = CONTENT_EVENT_NAMES satisfies readonly EventName[];
  for (const name of names) {
    if (!isEventName(name)) continue;
    registry.on(name, `content.log.${name}`, async (event) => {
      telemetry.log.info('content event', { event: name, event_id: event.id, content_id: event.payload.content_id });
    });
  }
  registry.on('catalog.product.deleted', 'content.flag-linked-product-deleted', async (event, tx) => {
    const { store_id: storeId, product_id: productId } = event.payload;
    const notified = await lifecycle.notifyLinkedProductDeleted(tx, storeId, productId);
    if (notified.length > 0) telemetry.log.info('linked product deleted', { event_id: event.id, product_id: productId, items: notified.length });
  });
}
