// StoreDataLifecycle port (AD-20): every module that holds tenant data registers one, so uninstall, reinstall and
// purge can reach its data without the integration module knowing its tables.
import type { TxQueryable } from '../events/outbox.js';

export interface StoreDataContext {
  storeId: string;
  /** The install epoch the work was started for; a module must not act when the store has moved on. */
  installEpoch: number;
  /** The open store-context transaction: writes commit with the lifecycle bookkeeping. */
  tx: TxQueryable;
}

export interface PurgeContext extends StoreDataContext {
  /** Upper bound on rows to remove in this batch (keeps each transaction short). */
  batchLimit: number;
}

export interface StoreDataLifecycle {
  /** Unique module name; recorded in the purge job as completed once `purge` reports done. */
  readonly module: string;
  /** Uninstall: stop serving this store at once (revoke sessions, ...). Must be idempotent. Data is kept for the grace period. */
  suspend?(ctx: StoreDataContext): Promise<void>;
  /** Reinstall within the grace period: undo `suspend`. Must be idempotent. */
  restore?(ctx: StoreDataContext): Promise<void>;
  /** Data export for the merchant (FR: data portability). Reserved; modules add it as their data lands. */
  export?(ctx: StoreDataContext): Promise<unknown>;
  /** Delete up to `batchLimit` rows of this module's data for the store. Return `done: true` when nothing is left. Idempotent. */
  purge(ctx: PurgeContext): Promise<{ done: boolean }>;
}

export const STORE_DATA_LIFECYCLES = Symbol('STORE_DATA_LIFECYCLES');
