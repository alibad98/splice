// The `catalog.reconcile` job (Story 2.6): once a day per active store, repair what missed webhooks, offset-paging misses
// in the full sync and unannounced deletions left wrong. Every Salla product page is listed and applied through the same
// guarded write path as webhooks (Story 2.4): products are created, updated (with `catalog.product.updated` for changed
// visible fields), revived when tombstoned but still listed, or counted unchanged. Local live products absent from the
// listing are confirmed one by one with `products.get`; only a "not found" answer tombstones them via `deleteProducts`
// (Story 2.5). HTTP calls run outside any transaction; each page or batch is written in its own short store-context
// transaction under the product lock. A failed attempt is retried from page 1 (the writes are idempotent).
import { createHash } from 'node:crypto';
import { JobMeta } from '@slips/contracts';
import { withStoreContext } from '@slips/db';
import type { Pool } from 'pg';
import { z } from 'zod';
import { publishEvent, uuidv7, type EventSender, type TxQueryable } from '../../events/outbox.js';
import type { CanonicalProduct, CommercePlatform } from '../../ports/commerce-platform.js';
import { Metric, type Telemetry } from '../../ports/telemetry.js';
import { StoreDisconnectedError, StoreNotConnectedError } from '../integration/errors.js';
import { CatalogRepository, type CategoryWrite, type ProductVisibleField, type ProductWrite } from './catalog.repository.js';
import { MAX_PAGES, type AccessTokenSource } from './catalog-sync.js';
import { deleteProducts } from './product-deletions.js';
import { toProductWrites } from './product-writes.js';

export const CATALOG_RECONCILE_QUEUE = 'catalog.reconcile';
export const CATALOG_RECONCILE_SCHEDULE_QUEUE = 'catalog.reconcile.schedule';
/** Daily at 00:00 UTC: the fan-out queues each store's job at its own offset after this. */
export const RECONCILE_CRON = '0 0 * * *';
/** Absent products are confirmed and written in batches of this many (one transaction per batch). */
export const ABSENT_BATCH_SIZE = 100;

export const ReconcileJob = JobMeta.extend({ store_id: z.uuid() });
export type ReconcileJob = z.infer<typeof ReconcileJob>;

/** A fixed per-store start offset (0-3599 s) after the daily cron, so the same store runs 24 h apart and stores spread out. */
export function reconcileOffsetSeconds(storeId: string): number {
  return createHash('sha256').update(storeId).digest().readUInt32BE(0) % 3600;
}

export interface ReconcileCounts {
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
  stale: number;
  skipped: number;
}

export type ReconcileOutcome = { finished: ReconcileCounts } | { skipped: 'disconnected' };

const emptyCounts = (): ReconcileCounts => ({ created: 0, updated: 0, deleted: 0, unchanged: 0, stale: 0, skipped: 0 });
const add = (into: ReconcileCounts, from: ReconcileCounts): void => {
  for (const k of Object.keys(into) as Array<keyof ReconcileCounts>) into[k] += from[k];
};

/** A product to write and when the platform was seen to have it (listing or fetch time). */
interface ObservedWrite {
  write: ProductWrite;
  observedAt: Date;
}

export class CatalogReconcile {
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
   * Reconcile one store. A store that is not connected is skipped (no retry). Any other failure (platform outage,
   * database error) is rethrown so pg-boss retries the job from page 1; the last attempt also logs a warning.
   */
  async run(storeId: string, opts: { finalAttempt: boolean }): Promise<ReconcileOutcome> {
    try {
      const counts = await this.reconcile(storeId);
      const finishedAt = this.now();
      await withStoreContext(this.pool, storeId, async () => this.repo.touchLastSynced(new Date(finishedAt), uuidv7(finishedAt)));
      for (const outcome of ['created', 'updated', 'deleted', 'unchanged'] as const) {
        if (counts[outcome] > 0) this.telemetry.counter(Metric.CatalogReconcileProducts, { outcome }, counts[outcome]);
      }
      this.telemetry.log.info('catalog reconcile finished', { ...counts });
      return { finished: counts };
    } catch (err) {
      if (err instanceof StoreDisconnectedError || err instanceof StoreNotConnectedError) {
        this.telemetry.log.info('catalog reconcile skipped', { reason: 'disconnected' });
        return { skipped: 'disconnected' };
      }
      if (opts.finalAttempt) this.telemetry.log.warn('catalog reconcile failed after its last attempt', { error: err instanceof Error ? err.name : 'unknown' });
      throw err;
    }
  }

  private async reconcile(storeId: string): Promise<ReconcileCounts> {
    const counts = emptyCounts();
    // Every id the platform listed, readable or not: such a product exists and is never a deletion candidate.
    const seen = new Set<string>();
    for (let page = 1; ; page++) {
      if (page > MAX_PAGES) throw new Error(`catalog reconcile: more than ${MAX_PAGES} pages`);
      const accessToken = await this.tokens.getAccessToken(storeId);
      // Taken before the request: a webhook applied while it was in flight is newer than what the listing shows.
      const fetchedAt = new Date(this.now());
      const result = await this.platform.products.list({ storeId, accessToken }, page);
      for (const item of result.items) seen.add(item.externalId);
      for (const id of result.skippedExternalIds ?? []) seen.add(id);
      const { products, categories, rejected } = toProductWrites(this.platform.platform, result.items, fetchedAt);
      const skipped = (result.skipped ?? 0) + rejected.unknownCurrency + rejected.invalid;
      if (skipped > 0) this.telemetry.log.warn('catalog reconcile skipped unreadable products', { page, skipped });
      counts.skipped += skipped;
      add(counts, await this.write(storeId, categories, products.map((write) => ({ write, observedAt: fetchedAt })), []));
      if (!result.hasMore) break;
    }

    const live = await withStoreContext(this.pool, storeId, async () => this.repo.liveExternalIds(this.platform.platform));
    const candidates = live.filter((id) => !seen.has(id));
    for (let i = 0; i < candidates.length; i += ABSENT_BATCH_SIZE) add(counts, await this.confirmAbsent(storeId, candidates.slice(i, i + ABSENT_BATCH_SIZE)));
    return counts;
  }

  /**
   * Absence alone is weak evidence (offset paging drifts while products change): ask the platform for each candidate.
   * Products it still has are written like listed ones; only a "not found" answer, observed at its own time, deletes.
   */
  private async confirmAbsent(storeId: string, externalIds: readonly string[]): Promise<ReconcileCounts> {
    const found: CanonicalProduct[] = [];
    const foundAt: Date[] = [];
    const gone: Array<{ externalId: string; observedAt: Date }> = [];
    for (const externalId of externalIds) {
      const accessToken = await this.tokens.getAccessToken(storeId);
      // A found product is observed as of the request start (a webhook applied meanwhile is newer); a "not found"
      // answer is observed when it arrives (a deletion is only known once answered).
      const requestedAt = new Date(this.now());
      const product = await this.platform.products.get({ storeId, accessToken }, externalId);
      if (product === null) gone.push({ externalId, observedAt: new Date(this.now()) });
      else {
        found.push(product);
        foundAt.push(requestedAt);
      }
    }
    const writes: ObservedWrite[] = [];
    const categories = new Map<string, CategoryWrite>();
    let skipped = 0;
    found.forEach((product, i) => {
      const observedAt = foundAt[i]!;
      const one = toProductWrites(this.platform.platform, [product], observedAt);
      skipped += one.rejected.unknownCurrency + one.rejected.invalid;
      for (const write of one.products) writes.push({ write, observedAt });
      for (const c of one.categories) categories.set(c.externalId, c);
    });
    if (skipped > 0) this.telemetry.log.warn('catalog reconcile skipped unreadable products', { skipped });
    const counts = await this.write(storeId, [...categories.values()], writes, gone);
    counts.skipped += skipped;
    return counts;
  }

  /** One transaction: categories, then products, then confirmed deletions, under the store's product lock. */
  private async write(storeId: string, categories: readonly CategoryWrite[], writes: readonly ObservedWrite[], gone: ReadonlyArray<{ externalId: string; observedAt: Date }>): Promise<ReconcileCounts> {
    if (categories.length === 0 && writes.length === 0 && gone.length === 0) return emptyCounts();
    let staleWrites = 0;
    const counts = await withStoreContext(this.pool, storeId, async (ctx) => {
      const tally = emptyCounts();
      await this.repo.lockProductWrites();
      // Categories before products: the same lock order as webhooks and the full sync.
      await this.repo.upsertCategories(categories);
      for (const { write, observedAt } of writes) {
        const applied = await this.repo.applyProduct(write, { observedAt });
        if (applied.outcome === 'stale') {
          tally.stale++;
          staleWrites++;
          continue;
        }
        if (applied.outcome === 'created') tally.created++;
        else if (applied.outcome === 'unchanged') tally.unchanged++;
        else tally.updated++;
        if (applied.changed.length > 0) await this.publishUpdated(ctx, storeId, applied.productId, applied.changed, write);
      }
      for (const { externalId, observedAt } of gone) {
        const result = await deleteProducts(ctx, { events: this.events, telemetry: this.telemetry }, { storeId, platform: this.platform.platform, externalIds: [externalId], observedAt, source: 'reconcile' });
        tally.deleted += result.deleted;
        tally.stale += result.stale;
        // A webhook tombstoned it between the listing and this batch: already in the state reconcile wanted.
        tally.unchanged += result.alreadyDeleted;
      }
      return tally;
    });
    // Counted after commit: a rolled-back page counts nothing (deleteProducts counts its own stale skips).
    if (staleWrites > 0) this.telemetry.counter(Metric.CatalogStaleWrites, { source: 'reconcile' }, staleWrites);
    return counts;
  }

  private async publishUpdated(ctx: TxQueryable, storeId: string, productId: string, changed: ProductVisibleField[], write: ProductWrite): Promise<void> {
    await publishEvent(ctx, this.events, this.telemetry, 'catalog.product.updated', {
      v: 1,
      store_id: storeId,
      product_id: productId,
      external_id: write.externalId,
      changed,
      name: write.name,
      image_url: write.imageUrl,
      price_minor: write.priceMinor,
      sale_price_minor: write.salePriceMinor,
      currency: write.currency,
      availability: write.availability,
      has_required_options: write.hasRequiredOptions,
      visible: write.visible,
    });
  }
}
