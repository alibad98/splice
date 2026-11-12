// Worker-side event handlers of the content module (Stories 3.1, 3.4, 3.8).
import { CONTENT_EVENT_NAMES, isEventName, type EventName, type MediaAssetStatus } from '@slips/contracts';
import type { EventHandlerRegistry } from '../events/dispatcher.js';
import type { ContentLifecycle } from '../modules/content/content-lifecycle.js';
import type { MediaService } from '../modules/media/media.service.js';
import type { Telemetry } from '../ports/telemetry.js';

/**
 * Logs every content lifecycle event (the dispatcher requires a handler; publishing in Epic 4 adds its own), flags
 * content linked to a product deleted in the store (Story 3.4), and synchronizes content item processing status when
 * slide assets are scanned or processed (Story 3.8: `draft -> processing` via `start_processing`, `processing -> draft`
 * via `finish_processing`).
 */
export function registerContentEventHandlers(
  registry: EventHandlerRegistry,
  telemetry: Telemetry,
  lifecycle: ContentLifecycle,
  media?: Pick<MediaService, 'getAssetsByIds'>,
): void {
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
  if (media) {
    for (const name of ['media.asset.scanned', 'media.asset.processed', 'media.asset.failed'] as const) {
      registry.on(name, `content.sync-slide-processing.on.${name}`, async (event, tx) => {
        const { store_id: storeId, asset_id: assetId } = event.payload;
        await lifecycle.syncSlideProcessing(tx, storeId, assetId, async (assetIds) => {
          const summaries = await media.getAssetsByIds(storeId, assetIds);
          return new Map<string, MediaAssetStatus>([...summaries].map(([id, s]) => [id, s.status]));
        });
      });
    }
  }
}
