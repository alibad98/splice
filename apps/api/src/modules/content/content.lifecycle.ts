import type { StoreDataLifecycle } from '../../ports/store-data-lifecycle.js';

const CONTENT_ITEM_EXPORT_COLUMNS =
  'id::text as id, title, format, cta_label, cta_action, cta_url, cta_style, status, archived_from, reactivate_to, auto_publish, first_published_at, deleted_at, created_at, updated_at';

/** Content data stays through the uninstall grace and is removed in batches by the purge. */
export const contentStoreData: StoreDataLifecycle = {
  module: 'content',
  async restore() {},
  /** The store's content items (tombstoned included). Content holds no tokens and no shopper data. */
  async export({ tx, storeId }) {
    const items = await tx.query(`select ${CONTENT_ITEM_EXPORT_COLUMNS} from content_items where store_id = $1 order by id`, [storeId]);
    return { content_items: items.rows };
  },
  async purge({ tx, storeId, batchLimit }) {
    const removed = await tx.query(
      'with doomed as (select id from content_items where store_id = $1 limit $2) delete from content_items c using doomed where c.id = doomed.id returning c.id',
      [storeId, batchLimit],
    );
    if (removed.rows.length >= batchLimit) return { done: false };
    return { done: true };
  },
};
