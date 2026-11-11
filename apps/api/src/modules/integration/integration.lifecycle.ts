import type { StoreDataLifecycle } from '../../ports/store-data-lifecycle.js';

/**
 * The integration module's own data: tokens, the merchant account, the token access log and the store display settings.
 * Registered LAST so every other module is purged first. The `stores` row, locator, purge job and audit trail stay as the
 * tombstone (AD-20).
 */
export const integrationStoreData: StoreDataLifecycle = {
  module: 'integration',
  async suspend({ tx, storeId }) {
    await tx.query('delete from platform_tokens where store_id = $1', [storeId]);
  },
  /** The store's display settings (Story 4.2). Tokens are never exported. */
  async export({ tx, storeId }) {
    const settings = await tx.query('select id::text as id, story_layout, created_at, updated_at from store_settings where store_id = $1 order by id', [storeId]);
    return { store_settings: settings.rows };
  },
  async purge({ tx, storeId }) {
    await tx.query('delete from store_settings where store_id = $1', [storeId]);
    await tx.query('delete from platform_tokens where store_id = $1', [storeId]);
    await tx.query('delete from merchant_accounts where store_id = $1', [storeId]);
    await tx.query('delete from token_access_log where store_id = $1', [storeId]);
    return { done: true };
  },
};
