// The `catalog.full-sync` job (Story 2.1): import every product of a store through the CommercePlatform port.
// HTTP calls run outside any transaction; each page is written in its own short store-context transaction that also
// advances `next_page`, so a retry resumes where the last attempt stopped.
import { InvalidAmountError, JobMeta, UnknownCurrencyError, toMinorUnits } from '@slips/contracts';
import { withStoreContext, type CatalogSyncReason } from '@slips/db';
import type { Pool } from 'pg';
import { z } from 'zod';
import { publishEvent, type EventSender } from '../../events/outbox.js';
import { PlatformAuthRejectedError, PlatformUnavailableError, type CanonicalProduct, type CommercePlatform } from '../../ports/commerce-platform.js';
import type { Telemetry } from '../../ports/telemetry.js';
import { StoreDisconnectedError, StoreNotConnectedError } from '../integration/errors.js';
import { availabilityBucket } from './availability.js';
import { CatalogRepository, type CategoryWrite, type ProductWrite } from './catalog.repository.js';

export const CATALOG_FULL_SYNC_QUEUE = 'catalog.full-sync';
/** A `running` run not touched for this long is presumed dead and may be replaced by a new run. */
export const STALE_RUN_MS = 15 * 60_000;
/** Guard against a platform that never reports the last page. */
export const MAX_PAGES = 5_000;

/** A run that wrote a page this recently is alive; a second attempt of the same run waits (retries) instead of joining it. */
export const RUN_HEARTBEAT_MS = 2 * 60_000;

/** Run id = the triggering event id, a time-ordered UUIDv7, so runs can be ordered. */
export const FullSyncJob = JobMeta.extend({ store_id: z.uuid(), run_id: z.uuid() });
export type FullSyncJob = z.infer<typeof FullSyncJob>;

/** The only token source catalog may use: `integration.getAccessToken` (AD-4). Catalog never refreshes tokens. */
export interface AccessTokenSource {
  getAccessToken(storeId: string): Promise<string>;
}

export type SyncOutcome = 'succeeded' | 'already_succeeded' | 'superseded' | { failed: CatalogSyncReason };

/** A failure that retrying will not fix: recorded on the run, and the job ends without a retry. */
class FinalSyncFailure extends Error {
  constructor(readonly reason: CatalogSyncReason, cause: unknown) {
    super(`catalog sync failed: ${reason}`, { cause });
  }
}

/** Retryable: the same run is being processed by another attempt right now. */
export class RunBusyError extends Error {
  constructor() {
    super('catalog sync run is already in progress');
    this.name = 'RunBusyError';
  }
}

const finalReason = (err: unknown): CatalogSyncReason | undefined => {
  if (err instanceof FinalSyncFailure) return err.reason;
  if (err instanceof PlatformAuthRejectedError) return 'auth_rejected';
  if (err instanceof StoreDisconnectedError || err instanceof StoreNotConnectedError) return 'store_inactive';
  if (err instanceof UnknownCurrencyError) return 'unknown_currency';
  if (err instanceof InvalidAmountError) return 'invalid_data';
  return undefined;
};

export class CatalogSync {
  private readonly repo = new CatalogRepository();

  constructor(
    private readonly pool: Pool,
    private readonly platform: CommercePlatform,
    private readonly tokens: AccessTokenSource,
    private readonly telemetry: Telemetry,
    private readonly events: EventSender,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Run (or resume) one full sync. A retryable failure (platform unavailable, unexpected error) keeps the run `running`
   * and rethrows so pg-boss retries per AD-1; only on the job's `finalAttempt` is it marked `failed` (Story 2.3: the
   * merchant never sees a failure that a retry may still fix). Final failures (auth, inactive store, bad data) mark it
   * `failed` with their reason at once and return.
   */
  async run(storeId: string, runId: string, opts: { finalAttempt: boolean }): Promise<SyncOutcome> {
    const begin = await this.begin(storeId, runId).catch(async (err: unknown) => {
      // The last attempt failing before it even started (database error) still ends the run as failed. Busy means
      // another attempt of this run is still importing: that attempt decides the outcome, so leave the run alone.
      if (opts.finalAttempt && !(err instanceof RunBusyError)) {
        await this.markFailed(storeId, runId, 'internal');
        this.telemetry.log.warn('catalog sync failed after its last attempt', { reason: 'internal', run_id: runId });
      }
      throw err;
    });
    if (begin.skip) {
      this.telemetry.log.info('catalog sync skipped', { outcome: begin.skip, run_id: runId });
      return begin.skip;
    }
    return this.importPages(storeId, runId, begin.page, opts);
  }

  /** Claim the run: start it, resume it, or skip it (already done / superseded). Throws `RunBusyError` while another attempt writes. */
  private begin(storeId: string, runId: string): Promise<{ skip?: 'already_succeeded' | 'superseded'; page: number }> {
    return withStoreContext(this.pool, storeId, async (): Promise<{ skip?: 'already_succeeded' | 'superseded'; page: number }> => {
      const at = new Date(this.now());
      const state = await this.repo.lockSyncState();
      const idleMs = state ? at.getTime() - state.updatedAt.getTime() : Infinity;
      if (state && state.runId === runId) {
        if (state.status === 'succeeded') return { skip: 'already_succeeded', page: 0 };
        // A requested run (Story 2.3) starts here, from page 1.
        if (state.status === 'queued') {
          await this.repo.startRun(runId, at);
          return { page: 1 };
        }
        // Another attempt of this run (e.g. pg-boss re-delivered an expired job) is still writing pages. A run whose
        // last attempt ended with a retryable error carries that `reason` and is resumed right away.
        if (state.status === 'running' && state.reason === null && idleMs < RUN_HEARTBEAT_MS) throw new RunBusyError();
        await this.repo.resumeRun(at);
        return { page: state.nextPage };
      }
      // Run ids are event ids (UUIDv7, time-ordered): a retry of an older run never replaces a newer one.
      if (state && state.runId > runId) return { skip: 'superseded', page: 0 };
      // A live run of another id keeps the row; one waiting for its retry (reason set) yields to this newer run.
      if (state && state.status === 'running' && state.reason === null && idleMs < STALE_RUN_MS) return { skip: 'superseded', page: 0 };
      await this.repo.startRun(runId, at);
      return { page: 1 };
    });
  }

  private async importPages(storeId: string, runId: string, firstPage: number, opts: { finalAttempt: boolean }): Promise<SyncOutcome> {
    try {
      let unreportedStock = 0;
      for (let page = firstPage; ; page++) {
        if (page > MAX_PAGES) throw new FinalSyncFailure('invalid_data', new Error(`more than ${MAX_PAGES} pages`));
        const accessToken = await this.tokens.getAccessToken(storeId);
        const result = await this.platform.products.list({ storeId, accessToken }, page);
        const fetchedAt = new Date(this.now());
        const { products, categories, rejected } = this.toWrites(result.items, fetchedAt);
        // The store's own currency is unknown (every product on the page): fail; a few bad products are skipped.
        if (result.items.length > 0 && rejected.unknownCurrency === result.items.length) throw new FinalSyncFailure('unknown_currency', new UnknownCurrencyError(result.items[0]!.currency));
        const skipped = (result.skipped ?? 0) + rejected.unknownCurrency + rejected.invalid;
        if (skipped > 0) this.telemetry.log.warn('catalog sync skipped unreadable products', { page, skipped, run_id: runId });
        unreportedStock += products.filter((p) => p.stock === null).length;
        const stillOurs = await withStoreContext(this.pool, storeId, async () => {
          const state = await this.repo.lockSyncState();
          if (state?.runId !== runId) return false;
          await this.repo.upsertCategories(categories);
          const counts = await this.repo.upsertProducts(products);
          await this.repo.recordPage(page + 1, counts.created, counts.updated, fetchedAt);
          return true;
        });
        if (!stillOurs) {
          this.telemetry.log.info('catalog sync superseded by a newer run', { page, run_id: runId });
          return 'superseded';
        }
        if (!result.hasMore) break;
      }

      const done = await withStoreContext(this.pool, storeId, async (ctx) => {
        const state = await this.repo.lockSyncState();
        if (state?.runId !== runId) return undefined;
        const at = new Date(this.now());
        const row = await this.repo.finishRun(at);
        await publishEvent(ctx, this.events, this.telemetry, 'catalog.sync.completed', {
          v: 1,
          store_id: storeId,
          run_id: runId,
          created: row.createdCount,
          updated: row.updatedCount,
          finished_at: at.toISOString(),
        });
        return row;
      });
      if (!done) return 'superseded';
      this.telemetry.log.info('catalog sync succeeded', { run_id: runId, created: done.createdCount, updated: done.updatedCount, stock_unreported: unreportedStock });
      return 'succeeded';
    } catch (err) {
      const reason = finalReason(err);
      if (reason) {
        await this.markFailed(storeId, runId, reason);
        this.telemetry.log.warn('catalog sync failed', { reason, run_id: runId });
        return { failed: reason };
      }
      const retryable = err instanceof PlatformUnavailableError ? 'platform_unavailable' : 'internal';
      if (opts.finalAttempt) {
        await this.markFailed(storeId, runId, retryable);
        this.telemetry.log.warn('catalog sync failed after its last attempt', { reason: retryable, run_id: runId });
      } else {
        await this.markRetrying(storeId, runId, retryable);
      }
      throw err;
    }
  }

  /**
   * Canonical products -> rows: minor units via the contracts money table, availability bucket computed here only.
   * A product with an unknown currency or an unreadable amount is left out and counted, never stored.
   */
  private toWrites(
    items: readonly CanonicalProduct[],
    fetchedAt: Date,
  ): { products: ProductWrite[]; categories: CategoryWrite[]; rejected: { unknownCurrency: number; invalid: number } } {
    const products = new Map<string, ProductWrite>();
    const categories = new Map<string, CategoryWrite>();
    const rejected = { unknownCurrency: 0, invalid: 0 };
    for (const p of items) {
      let priceMinor: number;
      let salePriceMinor: number | null;
      try {
        priceMinor = toMinorUnits(p.price, p.currency);
        salePriceMinor = p.salePrice === null ? null : toMinorUnits(p.salePrice, p.currency);
        if (priceMinor < 0 || (salePriceMinor !== null && salePriceMinor < 0)) throw new InvalidAmountError();
      } catch (err) {
        if (err instanceof UnknownCurrencyError) rejected.unknownCurrency++;
        else if (err instanceof InvalidAmountError) rejected.invalid++;
        else throw err;
        continue;
      }
      // A sale that rounds to the regular price (or above) is no sale.
      if (salePriceMinor !== null && salePriceMinor >= priceMinor) salePriceMinor = null;
      // The last occurrence wins: one upsert statement may not touch a row twice.
      products.set(p.externalId, {
        platform: this.platform.platform,
        externalId: p.externalId,
        name: p.name,
        imageUrl: p.imageUrl,
        categoryExternalIds: [...new Set(p.categories.map((c) => c.externalId))],
        priceMinor,
        salePriceMinor,
        currency: p.currency.toUpperCase(),
        taxInclusive: p.taxInclusive,
        stock: p.stock,
        availability: availabilityBucket(p.stock),
        hasRequiredOptions: p.hasRequiredOptions,
        visible: p.visible,
        sourceUpdatedAt: p.sourceUpdatedAt ?? fetchedAt,
      });
      for (const c of p.categories) categories.set(c.externalId, { platform: this.platform.platform, externalId: c.externalId, name: c.name, sourceUpdatedAt: fetchedAt });
    }
    return { products: [...products.values()], categories: [...categories.values()], rejected };
  }

  /** Keep the run `running` between attempts; record the attempt's error so the retry resumes it immediately. */
  private async markRetrying(storeId: string, runId: string, reason: CatalogSyncReason): Promise<void> {
    try {
      await withStoreContext(this.pool, storeId, async () => {
        const state = await this.repo.lockSyncState();
        if (state?.runId !== runId) return; // a newer run owns the row
        await this.repo.awaitRetry(reason, new Date(this.now()));
      });
    } catch (err) {
      this.telemetry.captureError(err, { component: 'catalog-sync', note: 'could not record the retrying run' });
    }
  }

  private async markFailed(storeId: string, runId: string, reason: CatalogSyncReason): Promise<void> {
    try {
      await withStoreContext(this.pool, storeId, async () => {
        const state = await this.repo.lockSyncState();
        if (state && state.runId !== runId) return; // a newer run owns the row
        if (state?.status === 'succeeded') return; // a stalled attempt failing late never undoes a finished run
        await this.repo.failRun(runId, reason, new Date(this.now()));
      });
    } catch (err) {
      this.telemetry.captureError(err, { component: 'catalog-sync', note: 'could not record the failed run' });
    }
  }
}
