import type { StoreDataLifecycle } from '../../ports/store-data-lifecycle.js';

/**
 * Publishing data (Story 4.4): the compiled store manifest. It is derived from other modules' data, so it is not
 * exported; uninstall leaves it to the compile (an uninstalled store compiles to an empty manifest), and the purge
 * deletes the row.
 */
export const publishingStoreData: StoreDataLifecycle = {
  module: 'publishing',
  async restore() {},
  async export() {
    return undefined;
  },
  async purge({ tx, storeId }) {
    await tx.query('delete from store_manifests where store_id = $1', [storeId]);
    return { done: true };
  },
};
