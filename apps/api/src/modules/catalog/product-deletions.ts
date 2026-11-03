// Catalog deletion (Story 2.5): the one path that tombstones products the platform deleted. Called by the product
// webhook consumer (a `product.deleted` webhook, or a 404 on the product fetch) and by reconciliation (Story 2.6) for
// products absent from the platform. Soft delete only: `deleted_at` is set, the row is never removed.
import type { StorePlatform } from '@slips/db';
import { publishEvent, type EventSender, type TxQueryable } from '../../events/outbox.js';
import { Metric, type Telemetry } from '../../ports/telemetry.js';
import { CatalogRepository } from './catalog.repository.js';

export interface DeleteProductsInput {
  storeId: string;
  platform: StorePlatform;
  externalIds: readonly string[];
  /** When the deletion was observed (event time, fetch time, or the reconcile listing time). Orders it against updates. */
  observedAt: Date;
  source: 'webhook' | 'reconcile';
}

export interface DeleteProductsResult {
  deleted: number;
  alreadyDeleted: number;
  stale: number;
  unknown: number;
}

const repo = new CatalogRepository();

/**
 * Tombstone the given products in the caller's transaction. The caller runs inside `withStoreContext` for
 * `input.storeId` and holds `lockProductWrites()`. Publishes one `catalog.product.deleted` per product that went from
 * live to deleted, in the same transaction; a repeated, unknown or stale deletion writes and emits nothing.
 */
export async function deleteProducts(tx: TxQueryable, deps: { events: EventSender; telemetry: Telemetry }, input: DeleteProductsInput): Promise<DeleteProductsResult> {
  const results = await repo.tombstoneProducts(input.platform, input.externalIds, input.observedAt);
  const counts: DeleteProductsResult = { deleted: 0, alreadyDeleted: 0, stale: 0, unknown: 0 };
  for (const r of results) {
    if (r.outcome === 'deleted' && r.productId) {
      counts.deleted++;
      await publishEvent(tx, deps.events, deps.telemetry, 'catalog.product.deleted', { v: 1, store_id: input.storeId, product_id: r.productId, external_id: r.externalId });
      deps.telemetry.log.info('product deleted', { store_id: input.storeId, external_id: r.externalId, source: input.source });
    } else if (r.outcome === 'already_deleted') counts.alreadyDeleted++;
    else if (r.outcome === 'stale') counts.stale++;
    else counts.unknown++;
  }
  if (counts.stale > 0) deps.telemetry.counter(Metric.CatalogStaleWrites, { source: input.source }, counts.stale);
  return counts;
}
