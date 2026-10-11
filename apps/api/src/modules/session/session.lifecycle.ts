import type { StoreDataLifecycle } from '../../ports/store-data-lifecycle.js';

/** Sessions end with the install: suspend drops them (an uninstalled store signs nobody in), purge removes any left. */
export const sessionStoreData: StoreDataLifecycle = {
  module: 'session',
  async suspend({ tx, storeId }) {
    await tx.query('delete from merchant_sessions where store_id = $1', [storeId]);
  },
  async purge({ tx, storeId }) {
    await tx.query('delete from merchant_sessions where store_id = $1', [storeId]);
    return { done: true };
  },
};
