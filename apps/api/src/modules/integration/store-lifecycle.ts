// AD-20 store lifecycle: active -> disconnected -> uninstalled (30-day grace) -> purged. Every transition is a guarded
// write under the per-store lifecycle lock, re-reading state and install epoch, so webhook retries, a reinstall and the
// purge job can interleave without clobbering each other.
import { requireStoreContext, withStoreContext, type StoreContext } from '@slips/db';
import type { Pool } from 'pg';
import { publishEvent, uuidv7, type EventSender } from '../../events/outbox.js';
import type { Telemetry } from '../../ports/telemetry.js';
import type { StoreDataLifecycle } from '../../ports/store-data-lifecycle.js';
import { IntegrationRepository } from './integration.repository.js';

export const GRACE_PERIOD_MS = 30 * 24 * 3_600_000;
export const PURGE_BATCH_LIMIT = 500;
/** Salla's clock and ours differ a little; an uninstall this close before the epoch start still counts as belonging to it. */
export const CLOCK_SKEW_MS = 5_000;
const lockKey = (storeId: string): string => `store_lifecycle:${storeId}`;

export type UninstallOutcome = 'uninstalled' | 'noop' | 'stale' | 'unknown_store';
export type PurgeOutcome = 'completed' | 'aborted' | 'not_due' | 'stale' | 'noop';

export async function lockStore(ctx: StoreContext): Promise<void> {
  await ctx.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey(ctx.storeId)]);
}

export async function writeAudit(ctx: StoreContext, platform: string, platformStoreId: string, action: string, installEpoch: number, details: Record<string, unknown> = {}): Promise<void> {
  await ctx.query('insert into lifecycle_audit (id, platform, platform_store_id, action, install_epoch, details) values ($1, $2, $3, $4, $5, $6::jsonb)', [
    uuidv7(),
    platform,
    platformStoreId,
    action,
    installEpoch,
    JSON.stringify(details),
  ]);
}

export class StoreLifecycle {
  private readonly repo = new IntegrationRepository();

  constructor(
    private readonly pool: Pool,
    private readonly telemetry: Telemetry,
    private readonly events: EventSender,
    /** Registered modules in purge order; the integration module's own lifecycle is last. */
    private readonly lifecycles: readonly StoreDataLifecycle[],
    private readonly now: () => number = Date.now,
    private readonly graceMs: number = GRACE_PERIOD_MS,
  ) {}

  /**
   * Uninstall: stop Slips for the store at once. State becomes `uninstalled` with a grace end date, the stored tokens
   * are revoked (deleted; Salla has already revoked its side), each module suspends serving, the purge is scheduled,
   * and `integration.store.uninstalled` is emitted in the same transaction. `eventAt` drops an uninstall that predates
   * the current install epoch (a late retry after a reinstall).
   */
  async uninstall(storeId: string, eventAt?: Date): Promise<UninstallOutcome> {
    return withStoreContext(this.pool, storeId, async (ctx): Promise<UninstallOutcome> => {
      await lockStore(ctx);
      const store = await this.repo.getStore();
      if (!store) return 'unknown_store';
      if (eventAt && eventAt.getTime() < store.epochStartedAt.getTime() - CLOCK_SKEW_MS) return 'stale';
      if (store.lifecycleState === 'uninstalled' || store.lifecycleState === 'purged') return 'noop';
      const at = new Date(this.now());
      const graceEndsAt = new Date(at.getTime() + this.graceMs);
      if (!(await this.repo.markUninstalled(store.installEpoch, at, graceEndsAt))) return 'noop';
      await this.repo.deleteTokens();
      for (const lc of this.lifecycles) await lc.suspend?.({ storeId, installEpoch: store.installEpoch, tx: ctx });
      await ctx.query(
        'insert into store_purge_schedule (id, install_epoch, due_at) values ($1, $2, $3) on conflict (id) do update set install_epoch = excluded.install_epoch, due_at = excluded.due_at',
        [storeId, store.installEpoch, graceEndsAt],
      );
      await writeAudit(ctx, store.platform, store.platformStoreId, 'uninstalled', store.installEpoch, { grace_ends_at: graceEndsAt.toISOString() });
      await publishEvent(ctx, this.events, this.telemetry, 'integration.store.uninstalled', {
        v: 1,
        store_id: storeId,
        install_epoch: store.installEpoch,
        grace_ends_at: graceEndsAt.toISOString(),
      });
      this.telemetry.log.info('store uninstalled', { store_id: storeId, install_epoch: store.installEpoch });
      return 'uninstalled';
    });
  }

  /**
   * Reinstall of an `uninstalled` (restore, `integration.store.reinstalled`) or `purged` (fresh start,
   * `integration.store.installed`) store, inside the caller's store transaction and under its lifecycle lock.
   * The same `stores` row returns to `active` with `install_epoch` + 1; a running purge sees the new epoch and stops.
   * Returns the new epoch, or undefined when the row moved under us.
   */
  async reinstallInTx(ctx: StoreContext, store: { installEpoch: number; lifecycleState: 'uninstalled' | 'purged'; platform: string; platformStoreId: string }, details: { name: string; syncedDomains: string[] }): Promise<number | undefined> {
    const epoch = await this.repo.markReinstalled(store.installEpoch, new Date(this.now()), details);
    if (epoch === undefined) return undefined;
    await ctx.query('delete from store_purge_schedule where id = $1', [ctx.storeId]);
    if (store.lifecycleState === 'uninstalled') for (const lc of this.lifecycles) await lc.restore?.({ storeId: ctx.storeId, installEpoch: epoch, tx: ctx });
    await writeAudit(ctx, store.platform, store.platformStoreId, store.lifecycleState === 'uninstalled' ? 'reinstalled' : 'reinstalled_after_purge', epoch);
    const name = store.lifecycleState === 'uninstalled' ? 'integration.store.reinstalled' : 'integration.store.installed';
    await publishEvent(ctx, this.events, this.telemetry, name, { v: 1, store_id: ctx.storeId, install_epoch: epoch });
    return epoch;
  }

  /**
   * An authorize event created before the store's uninstall is an out-of-order delivery of the old install, not a
   * reinstall: applying it would resurrect an uninstalled store. Reinstalls carry a later `created_at`.
   */
  async authorizePredatesUninstall(storeId: string, eventAt: Date | undefined): Promise<boolean> {
    if (!eventAt) return false;
    return withStoreContext(this.pool, storeId, async () => {
      const store = await this.repo.getStore();
      return !!store?.uninstalledAt && (store.lifecycleState === 'uninstalled' || store.lifecycleState === 'purged') && eventAt.getTime() < store.uninstalledAt.getTime() - CLOCK_SKEW_MS;
    });
  }

  /** Stores whose grace has ended and whose purge has not completed (the sweep enqueues one purge job each). */
  async duePurges(limit = 100): Promise<Array<{ storeId: string; installEpoch: number }>> {
    const { rows } = await this.pool.query<{ id: string; install_epoch: number }>('select id::text as id, install_epoch from store_purge_schedule where due_at <= $1 order by due_at limit $2', [new Date(this.now()), limit]);
    return rows.map((r) => ({ storeId: r.id, installEpoch: r.install_epoch }));
  }

  /**
   * The one resumable purge job for a store (AD-20). Each batch is its own transaction that takes the per-store lock and
   * re-checks the store's state and install epoch against the job's before calling a module's purge; a reinstall (state
   * `active`, epoch + 1) therefore stops further batches, and work carrying a stale epoch is dropped. Progress is stored
   * per module, so a crashed or re-delivered job continues where it stopped. Ends by marking the store `purged`,
   * writing the audit record and emitting `integration.store.purged`.
   */
  async purge(storeId: string, epoch: number, batchLimit = PURGE_BATCH_LIMIT): Promise<PurgeOutcome> {
    const started = await withStoreContext(this.pool, storeId, async (): Promise<{ kind: 'skip'; outcome: PurgeOutcome } | { kind: 'run'; jobId: string; completed: string[] }> => {
      await lockStore(requireStoreContext());
      const store = await this.repo.getStore();
      if (!store) return { kind: 'skip', outcome: 'noop' };
      if (store.installEpoch !== epoch) return { kind: 'skip', outcome: 'stale' };
      if (store.lifecycleState !== 'uninstalled') return { kind: 'skip', outcome: 'noop' };
      if (store.graceEndsAt && store.graceEndsAt.getTime() > this.now()) return { kind: 'skip', outcome: 'not_due' };
      await this.repo.startJob(uuidv7(), epoch);
      const job = (await this.repo.getJob(epoch))!;
      if (job.status !== 'running') return { kind: 'skip', outcome: 'noop' };
      return { kind: 'run', jobId: job.id, completed: job.completedModules };
    });
    if (started.kind === 'skip') return started.outcome;

    const completed = new Set(started.completed);
    for (const lc of this.lifecycles) {
      if (completed.has(lc.module)) continue;
      for (;;) {
        const step = await withStoreContext(this.pool, storeId, async (ctx): Promise<'more' | 'module_done' | 'aborted'> => {
          await lockStore(ctx);
          const store = await this.repo.getStore();
          const job = (await this.repo.getJob(epoch))!;
          if (!store || store.lifecycleState !== 'uninstalled' || store.installEpoch !== epoch || job.status !== 'running') {
            if (job.status === 'running') await this.repo.finishJob(job.id, 'aborted', store?.installEpoch !== epoch ? 'epoch_changed' : 'state_changed');
            return 'aborted';
          }
          const result = await lc.purge({ storeId, installEpoch: epoch, tx: ctx, batchLimit });
          const modules = result.done ? [...new Set([...job.completedModules, lc.module])] : job.completedModules;
          await this.repo.progressJob(job.id, modules, job.batches + 1);
          return result.done ? 'module_done' : 'more';
        });
        if (step === 'aborted') {
          this.telemetry.log.info('store purge aborted', { store_id: storeId, install_epoch: epoch });
          return 'aborted';
        }
        if (step === 'module_done') break;
      }
    }

    return withStoreContext(this.pool, storeId, async (ctx): Promise<PurgeOutcome> => {
      await lockStore(ctx);
      const store = await this.repo.getStore();
      const job = (await this.repo.getJob(epoch))!;
      if (!store || store.lifecycleState !== 'uninstalled' || store.installEpoch !== epoch || job.status !== 'running') {
        if (job.status === 'running') await this.repo.finishJob(job.id, 'aborted', 'epoch_changed');
        return 'aborted';
      }
      await this.repo.markPurged(epoch, new Date(this.now()));
      await ctx.query('delete from store_purge_schedule where id = $1', [storeId]);
      // Webhooks already received for this store hold only canonical payloads, but they go with it.
      await ctx.query('delete from webhook_inbox where platform = $1 and platform_store_id = $2', [store.platform, store.platformStoreId]);
      await this.repo.finishJob(job.id, 'completed');
      await writeAudit(ctx, store.platform, store.platformStoreId, 'purged', epoch, { modules: this.lifecycles.map((l) => l.module), batches: job.batches });
      await publishEvent(ctx, this.events, this.telemetry, 'integration.store.purged', { v: 1, store_id: storeId, install_epoch: epoch });
      this.telemetry.log.info('store purged', { store_id: storeId, install_epoch: epoch });
      return 'completed';
    });
  }
}
