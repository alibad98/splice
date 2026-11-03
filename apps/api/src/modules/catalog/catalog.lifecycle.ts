import type { StoreDataLifecycle } from '../../ports/store-data-lifecycle.js';

const PRODUCT_EXPORT_COLUMNS =
  'id::text as id, platform, external_id, name, image_url, category_external_ids, price_minor, sale_price_minor, currency, tax_inclusive, stock, availability, has_required_options, visible, source_updated_at, deleted_at, created_at, updated_at';
const CATEGORY_EXPORT_COLUMNS = 'id::text as id, platform, external_id, name, source_updated_at, created_at, updated_at';

/** Catalog data stays through the uninstall grace (a reinstall resyncs anyway) and is removed in batches by the purge. */
export const catalogStoreData: StoreDataLifecycle = {
  module: 'catalog',
  /**
   * Reinstall within the grace: rows were never touched, so they come back as they are (same product ids). The
   * `integration.store.reinstalled` handler already queues the full sync that brings them up to date.
   */
  async restore() {},
  /** The store's products (tombstoned included) and categories. Catalog holds no tokens and no shopper data. */
  async export({ tx, storeId }) {
    const products = await tx.query(`select ${PRODUCT_EXPORT_COLUMNS} from products where store_id = $1 order by id`, [storeId]);
    const categories = await tx.query(`select ${CATEGORY_EXPORT_COLUMNS} from categories where store_id = $1 order by id`, [storeId]);
    return { products: products.rows, categories: categories.rows };
  },
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
