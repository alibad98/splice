import type { StoreDataLifecycle } from '../../ports/store-data-lifecycle.js';

/** Catalog data stays through the uninstall grace (a reinstall resyncs anyway) and is removed in batches by the purge. */
export const catalogStoreData: StoreDataLifecycle = {
  module: 'catalog',
  async purge({ tx, storeId, batchLimit }) {
    const removed = await tx.query(
      'with doomed as (select id from products where store_id = $1 limit $2) delete from products p using doomed where p.id = doomed.id returning p.id',
      [storeId, batchLimit],
    );
    if (removed.rows.length >= batchLimit) return { done: false };
    await tx.query('delete from categories where store_id = $1', [storeId]);
    await tx.query('delete from catalog_sync_state where store_id = $1', [storeId]);
    return { done: true };
  },
};
