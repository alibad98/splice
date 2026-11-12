import type { ObjectStorage } from '../../ports/object-storage.js';
import type { StoreDataLifecycle } from '../../ports/store-data-lifecycle.js';
import { storePrefix } from './media.service.js';

const ASSET_EXPORT_COLUMNS = 'id::text as id, kind, content_type, size_bytes, sha256, storage_key, source_url, status, failure_reason, created_at, updated_at';
const GRANT_EXPORT_COLUMNS = 'id::text as id, kind, content_type, size_bytes, sha256, expires_at, completed_asset_id::text as completed_asset_id, created_at';
const RENDITION_EXPORT_COLUMNS = 'id::text as id, asset_id::text as asset_id, profile, content_type, width, height, size_bytes, sha256, storage_key, created_at';

/**
 * Media data stays through the uninstall grace. The purge removes the store's objects (everything under
 * `stores/{store_id}/`) first, then its rendition rows, then its grant rows, then its asset rows, one batch per call.
 */
export function mediaStoreData(storage: ObjectStorage): StoreDataLifecycle {
  return {
    module: 'media',
    async restore() {},
    /** The store's asset, rendition and upload-grant rows (no file bytes; media holds no tokens and no shopper data). */
    async export({ tx, storeId }) {
      const assets = await tx.query(`select ${ASSET_EXPORT_COLUMNS} from media_assets where store_id = $1 order by id`, [storeId]);
      const grants = await tx.query(`select ${GRANT_EXPORT_COLUMNS} from media_upload_grants where store_id = $1 order by id`, [storeId]);
      const renditions = await tx.query(`select ${RENDITION_EXPORT_COLUMNS} from renditions where store_id = $1 order by id`, [storeId]);
      return { media_assets: assets.rows, media_upload_grants: grants.rows, renditions: renditions.rows };
    },
    async purge({ tx, storeId, batchLimit }) {
      const objects = await storage.deletePrefix(storePrefix(storeId), batchLimit);
      if (!objects.done) return { done: false };
      const renditions = await tx.query(
        'with doomed as (select id from renditions where store_id = $1 limit $2) delete from renditions r using doomed where r.id = doomed.id returning r.id',
        [storeId, batchLimit],
      );
      if (renditions.rows.length >= batchLimit) return { done: false };
      const grants = await tx.query(
        'with doomed as (select id from media_upload_grants where store_id = $1 limit $2) delete from media_upload_grants g using doomed where g.id = doomed.id returning g.id',
        [storeId, batchLimit],
      );
      if (grants.rows.length >= batchLimit) return { done: false };
      const assets = await tx.query(
        'with doomed as (select id from media_assets where store_id = $1 limit $2) delete from media_assets a using doomed where a.id = doomed.id returning a.id',
        [storeId, batchLimit],
      );
      if (assets.rows.length >= batchLimit) return { done: false };
      return { done: true };
    },
  };
}
