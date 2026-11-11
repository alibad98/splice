import type { StoreDataLifecycle } from '../../ports/store-data-lifecycle.js';

const CONTENT_ITEM_EXPORT_COLUMNS =
  'id::text as id, title, format, cta_label, cta_action, cta_url, cta_style, status, archived_from, reactivate_to, auto_publish, first_published_at, deleted_at, created_at, updated_at';

const PRODUCT_LINK_EXPORT_COLUMNS = 'id::text as id, content_id::text as content_id, product_id::text as product_id, slide_id::text as slide_id, created_at';

const SLIDE_EXPORT_COLUMNS =
  'id::text as id, content_id::text as content_id, media_asset_id::text as media_asset_id, kind, position, alt_text, deleted_at, created_at, updated_at';

/** Content data stays through the uninstall grace and is removed in batches by the purge. */
export const contentStoreData: StoreDataLifecycle = {
  module: 'content',
  async restore() {},
  /** The store's content items (tombstoned included), their product links and slides (soft-deleted included). Content holds no tokens and no shopper data. */
  async export({ tx, storeId }) {
    const items = await tx.query(`select ${CONTENT_ITEM_EXPORT_COLUMNS} from content_items where store_id = $1 order by id`, [storeId]);
    const links = await tx.query(`select ${PRODUCT_LINK_EXPORT_COLUMNS} from content_product_links where store_id = $1 order by content_id`, [storeId]);
    const slides = await tx.query(`select ${SLIDE_EXPORT_COLUMNS} from slides where store_id = $1 order by content_id, position, id`, [storeId]);
    const placements = await tx.query('select id::text as id, content_id::text as content_id, type, created_at from placements where store_id = $1 order by content_id, id', [storeId]);
    return { content_items: items.rows, content_product_links: links.rows, slides: slides.rows, placements: placements.rows };
  },
  /** Slides and links go first, then items, one batch per call. */
  async purge({ tx, storeId, batchLimit }) {
    const placements = await tx.query('with doomed as (select id from placements where store_id = $1 limit $2) delete from placements p using doomed where p.id = doomed.id returning p.id', [storeId, batchLimit]);
    if (placements.rows.length >= batchLimit) return { done: false };
    const slides = await tx.query(
      'with doomed as (select id from slides where store_id = $1 limit $2) delete from slides s using doomed where s.id = doomed.id returning s.id',
      [storeId, batchLimit],
    );
    if (slides.rows.length >= batchLimit) return { done: false };
    const links = await tx.query(
      'with doomed as (select id from content_product_links where store_id = $1 limit $2) delete from content_product_links l using doomed where l.id = doomed.id returning l.id',
      [storeId, batchLimit],
    );
    if (links.rows.length >= batchLimit) return { done: false };
    const removed = await tx.query(
      'with doomed as (select id from content_items where store_id = $1 limit $2) delete from content_items c using doomed where c.id = doomed.id returning c.id',
      [storeId, batchLimit],
    );
    if (removed.rows.length >= batchLimit) return { done: false };
    return { done: true };
  },
};
