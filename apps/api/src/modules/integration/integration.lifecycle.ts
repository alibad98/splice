import type { StoreDataLifecycle } from '../../ports/store-data-lifecycle.js';

/**
 * The integration module's own data: tokens, the merchant account and the token access log. Registered LAST so every
 * other module is purged first. The `stores` row, locator, purge job and audit trail stay as the tombstone (AD-20).
 */
export const integrationStoreData: StoreDataLifecycle = {
  module: 'integration',
  async suspend({ tx, storeId }) {
    await tx.query('delete from platform_tokens where store_id = $1', [storeId]);
  },
  async purge({ tx, storeId }) {
    await tx.query('delete from platform_tokens where store_id = $1', [storeId]);
    await tx.query('delete from merchant_accounts where store_id = $1', [storeId]);
    await tx.query('delete from token_access_log where store_id = $1', [storeId]);
    return { done: true };
  },
};
