import { uuidv7, type EventSender } from '../../events/outbox.js';
import type { Telemetry } from '../../ports/telemetry.js';
import { sendManifestDelivery } from './manifest-delivery.js';
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
    await tx.query('delete from manifest_deliveries where store_id = $1', [storeId]);
    await tx.query('delete from store_manifests where store_id = $1', [storeId]);
    return { done: true };
  },
};

/** Cleanup jobs outlive tenant rows. Their payload contains only identity and epoch, never content. */
export function publishingDeliveryStoreData(sender: EventSender, telemetry: Telemetry): StoreDataLifecycle {
  return {
    ...publishingStoreData,
    async purge(ctx) {
      const result = await ctx.tx.query('select platform_store_id, revision from manifest_deliveries where store_id=$1', [ctx.storeId]);
      const row = result.rows[0] as { platform_store_id: string; revision: string } | undefined;
      if (row) await sendManifestDelivery(sender, ctx.tx, {
        v: 1, trace_id: telemetry.context().trace_id ?? uuidv7(), store_id: ctx.storeId, install_epoch: ctx.installEpoch,
        platform_store_id: row.platform_store_id, revision: Number(row.revision), cleanup: true, phase: 'upload', occurred_at: new Date().toISOString(),
      });
      await ctx.tx.query('delete from manifest_deliveries where store_id=$1', [ctx.storeId]);
      return publishingStoreData.purge(ctx);
    },
  };
}
