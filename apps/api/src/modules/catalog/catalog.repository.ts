import { PRODUCT_VISIBLE_FIELDS } from '@slips/contracts';
import { schema, StoreScoped, and, eq, isNull, sql, type AvailabilityBucket, type CatalogSyncReason, type StorePlatform } from '@slips/db';

const { products, categories, catalogSyncState } = schema;

/** Product fields a manifest shows (the `catalog.product.updated` `changed` values). */
export type ProductVisibleField = (typeof PRODUCT_VISIBLE_FIELDS)[number];

/** `restored`: a tombstoned product written again by a strictly newer source (Story 2.5); every visible field is `changed`. */
export type ApplyProductResult = { outcome: 'created' | 'updated' | 'restored' | 'stale'; productId: string; changed: ProductVisibleField[] };

export type TombstoneOutcome = 'deleted' | 'already_deleted' | 'stale' | 'unknown';
export interface TombstoneResult {
  externalId: string;
  outcome: TombstoneOutcome;
  /** Absent only for `unknown`. */
  productId?: string;
}

export type SyncStateRow = typeof catalogSyncState.$inferSelect;

export interface ProductWrite {
  platform: StorePlatform;
  externalId: string;
  name: string;
  imageUrl: string | null;
  categoryExternalIds: string[];
  priceMinor: number;
  salePriceMinor: number | null;
  currency: string;
  taxInclusive: boolean;
  stock: number | null;
  availability: AvailabilityBucket;
  hasRequiredOptions: boolean;
  visible: boolean;
  sourceUpdatedAt: Date;
}

export interface CategoryWrite {
  platform: StorePlatform;
  externalId: string;
  name: string;
  sourceUpdatedAt: Date;
}

/** Data access for the catalog tables; runs only inside `withStoreContext` (StoreScoped). */
export class CatalogRepository extends StoreScoped {
  async getSyncState(): Promise<SyncStateRow | undefined> {
    return (await this.db.select().from(catalogSyncState).where(eq(catalogSyncState.storeId, this.storeId)).limit(1))[0];
  }

  /** Lock the store's sync-state row for the rest of the transaction (creates nothing). */
  async lockSyncState(): Promise<SyncStateRow | undefined> {
    return (await this.db.select().from(catalogSyncState).where(eq(catalogSyncState.storeId, this.storeId)).for('update').limit(1))[0];
  }

  /**
   * Serialize sync requests of this store for the rest of the transaction, also before its first sync-state row exists
   * (a row lock cannot cover an insert). Transaction-scoped advisory lock, released at commit/rollback.
   */
  async lockSyncRequests(): Promise<void> {
    await this.db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`catalog-sync:${this.storeId}`}, 0))`);
  }

  /** Serialize product writes of this store (webhooks) for the rest of the transaction. */
  async lockProductWrites(): Promise<void> {
    await this.db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`catalog-product:${this.storeId}`}, 0))`);
  }

  /** A run the merchant requested (Story 2.3): `queued` from page 1 until the worker starts it. Keeps `last_synced_at`. */
  async queueRun(runId: string, at: Date): Promise<SyncStateRow> {
    const queued = { runId, status: 'queued' as const, reason: null, nextPage: 1, createdCount: 0, updatedCount: 0, startedAt: at, finishedAt: null, requestedAt: at, updatedAt: at };
    const rows = await this.db
      .insert(catalogSyncState)
      .values({ storeId: this.storeId, ...queued })
      .onConflictDoUpdate({ target: catalogSyncState.storeId, set: queued })
      .returning();
    return rows[0]!;
  }

  /** Begin a new run from page 1 with zero counts. */
  async startRun(runId: string, at: Date): Promise<void> {
    const fresh = { runId, status: 'running' as const, reason: null, nextPage: 1, createdCount: 0, updatedCount: 0, startedAt: at, finishedAt: null, updatedAt: at };
    await this.db
      .insert(catalogSyncState)
      .values({ storeId: this.storeId, ...fresh })
      .onConflictDoUpdate({ target: catalogSyncState.storeId, set: fresh });
  }

  /** Mark the current run running again (a retry resuming from `next_page`). */
  async resumeRun(at: Date): Promise<void> {
    await this.db.update(catalogSyncState).set({ status: 'running', reason: null, updatedAt: at }).where(eq(catalogSyncState.storeId, this.storeId));
  }

  async recordPage(nextPage: number, created: number, updated: number, at: Date): Promise<void> {
    await this.db
      .update(catalogSyncState)
      .set({ nextPage, createdCount: sql`${catalogSyncState.createdCount} + ${created}`, updatedCount: sql`${catalogSyncState.updatedCount} + ${updated}`, updatedAt: at })
      .where(eq(catalogSyncState.storeId, this.storeId));
  }

  async finishRun(at: Date): Promise<SyncStateRow> {
    const rows = await this.db
      .update(catalogSyncState)
      .set({ status: 'succeeded', reason: null, finishedAt: at, lastSyncedAt: at, updatedAt: at })
      .where(eq(catalogSyncState.storeId, this.storeId))
      .returning();
    return rows[0]!;
  }

  /**
   * An attempt ended with a retryable error and pg-boss will retry it: the run stays `running` (the merchant is not told
   * it failed yet); `reason` records the attempt's error and marks the run as waiting, so the retry resumes it at once.
   */
  async awaitRetry(reason: CatalogSyncReason, at: Date): Promise<void> {
    await this.db.update(catalogSyncState).set({ status: 'running', reason, updatedAt: at }).where(eq(catalogSyncState.storeId, this.storeId));
  }

  async failRun(runId: string, reason: CatalogSyncReason, at: Date): Promise<void> {
    await this.db
      .insert(catalogSyncState)
      .values({ storeId: this.storeId, runId, status: 'failed', reason, finishedAt: at, updatedAt: at, startedAt: at })
      .onConflictDoUpdate({ target: catalogSyncState.storeId, set: { status: 'failed', reason, finishedAt: at, updatedAt: at } });
  }

  /** Insert or update by (store, platform, external id), except where the stored name is from a newer source time. */
  async upsertCategories(rows: readonly CategoryWrite[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db
      .insert(categories)
      .values(rows.map((r) => ({ storeId: this.storeId, ...r })))
      .onConflictDoUpdate({
        target: [categories.storeId, categories.platform, categories.externalId],
        set: { name: sql`excluded.name`, sourceUpdatedAt: sql`excluded.source_updated_at`, updatedAt: sql`now()` },
        setWhere: sql`excluded.source_updated_at >= ${categories.sourceUpdatedAt}`,
      });
  }

  /**
   * Insert or update by (store, platform, external id). An existing row is only replaced by a write whose
   * `source_updated_at` is at or after the stored one (a stale write is skipped, never an error). Returns how many rows
   * were created, updated and skipped.
   */
  async upsertProducts(rows: readonly ProductWrite[]): Promise<{ created: number; updated: number; skipped: number }> {
    if (rows.length === 0) return { created: 0, updated: 0, skipped: 0 };
    const result = await this.upsertGuarded(rows);
    const created = result.filter((r) => r.inserted).length;
    return { created, updated: result.length - created, skipped: rows.length - result.length };
  }

  /**
   * Tombstone products by external id (Story 2.5). Call under the store's product lock. A deletion observed at `at`
   * applies to a live row whose `source_updated_at` is at or before `at` (ties go to the deletion) and stamps both
   * `deleted_at` and `source_updated_at` with `at`, so any older update is then rejected by the write guard. Never
   * removes a row. Returns one result per distinct external id.
   */
  async tombstoneProducts(platform: StorePlatform, externalIds: readonly string[], at: Date): Promise<TombstoneResult[]> {
    const ids = [...new Set(externalIds)];
    if (ids.length === 0) return [];
    const existing = await this.db
      .select({ id: products.id, externalId: products.externalId, deletedAt: products.deletedAt, sourceUpdatedAt: products.sourceUpdatedAt })
      .from(products)
      .where(and(eq(products.storeId, this.storeId), eq(products.platform, platform), sql`${products.externalId} = any(${sql.param(ids)}::text[])`))
      .orderBy(products.id)
      .for('update');
    const byExternalId = new Map(existing.map((r) => [r.externalId, r]));
    const results: TombstoneResult[] = [];
    const toDelete: string[] = [];
    for (const externalId of ids) {
      const row = byExternalId.get(externalId);
      if (!row) results.push({ externalId, outcome: 'unknown' });
      else if (row.deletedAt) results.push({ externalId, outcome: 'already_deleted', productId: row.id });
      else if (at.getTime() < row.sourceUpdatedAt.getTime()) results.push({ externalId, outcome: 'stale', productId: row.id });
      else {
        results.push({ externalId, outcome: 'deleted', productId: row.id });
        toDelete.push(row.id);
      }
    }
    if (toDelete.length > 0) {
      await this.db
        .update(products)
        .set({ deletedAt: at, sourceUpdatedAt: at, updatedAt: sql`now()` })
        .where(and(eq(products.storeId, this.storeId), sql`${products.id} = any(${sql.param(toDelete)}::uuid[])`));
    }
    return results;
  }

  /**
   * One product from a webhook (Story 2.4). Call under the store's product lock. Reads the stored visible fields
   * `for update`, applies the guarded upsert, and reports which visible fields changed.
   */
  async applyProduct(row: ProductWrite): Promise<ApplyProductResult> {
    const existing = (
      await this.db
        .select({ id: products.id, name: products.name, imageUrl: products.imageUrl, priceMinor: products.priceMinor, salePriceMinor: products.salePriceMinor, availability: products.availability, hasRequiredOptions: products.hasRequiredOptions, visible: products.visible, sourceUpdatedAt: products.sourceUpdatedAt, deletedAt: products.deletedAt })
        .from(products)
        .where(and(eq(products.storeId, this.storeId), eq(products.platform, row.platform), eq(products.externalId, row.externalId)))
        .for('update')
        .limit(1)
    )[0];
    if (existing && row.sourceUpdatedAt.getTime() < existing.sourceUpdatedAt.getTime()) return { outcome: 'stale', productId: existing.id, changed: [] };
    if (existing?.deletedAt) {
      // A tombstone is revived only by a strictly newer write: a same-time update delivered after the delete loses.
      if (row.sourceUpdatedAt.getTime() <= existing.sourceUpdatedAt.getTime()) return { outcome: 'stale', productId: existing.id, changed: [] };
      const revived = (await this.upsertGuarded([row], { restore: true }))[0];
      if (!revived) return { outcome: 'stale', productId: existing.id, changed: [] };
      return { outcome: 'restored', productId: revived.id, changed: [...PRODUCT_VISIBLE_FIELDS] };
    }
    const written = await this.upsertGuarded([row]);
    const w = written[0];
    // The guard lost a race with a newer write that landed after the read.
    if (!w) return { outcome: 'stale', productId: existing?.id ?? '', changed: [] };
    // No prior read: a created row is ours; one a concurrent sync inserted in between is an update we cannot diff.
    if (!existing) return { outcome: w.inserted ? 'created' : 'updated', productId: w.id, changed: [] };
    const changed: ProductVisibleField[] = [];
    if (existing.name !== row.name) changed.push('name');
    if (existing.imageUrl !== row.imageUrl) changed.push('image_url');
    if (existing.priceMinor !== row.priceMinor) changed.push('price_minor');
    if (existing.salePriceMinor !== row.salePriceMinor) changed.push('sale_price_minor');
    if (existing.availability !== row.availability) changed.push('availability');
    if (existing.hasRequiredOptions !== row.hasRequiredOptions) changed.push('has_required_options');
    if (existing.visible !== row.visible) changed.push('visible');
    return { outcome: 'updated', productId: w.id, changed };
  }

  /**
   * The guarded upsert. Leaves `deleted_at` untouched (the full sync never deletes or revives), except with `restore`,
   * which clears it (a strictly newer webhook write of a tombstoned product, see `applyProduct`).
   */
  private async upsertGuarded(rows: readonly ProductWrite[], opts: { restore?: boolean } = {}): Promise<Array<{ id: string; inserted: boolean }>> {
    return this.db
      .insert(products)
      .values(rows.map((r) => ({ storeId: this.storeId, ...r })))
      .onConflictDoUpdate({
        target: [products.storeId, products.platform, products.externalId],
        setWhere: sql`excluded.source_updated_at >= ${products.sourceUpdatedAt}`,
        set: {
          name: sql`excluded.name`,
          imageUrl: sql`excluded.image_url`,
          categoryExternalIds: sql`excluded.category_external_ids`,
          priceMinor: sql`excluded.price_minor`,
          salePriceMinor: sql`excluded.sale_price_minor`,
          currency: sql`excluded.currency`,
          taxInclusive: sql`excluded.tax_inclusive`,
          stock: sql`excluded.stock`,
          availability: sql`excluded.availability`,
          hasRequiredOptions: sql`excluded.has_required_options`,
          visible: sql`excluded.visible`,
          sourceUpdatedAt: sql`excluded.source_updated_at`,
          updatedAt: sql`now()`,
          ...(opts.restore ? { deletedAt: sql`null` } : {}),
        },
      })
      // xmax = 0 only on a freshly inserted row version. A row skipped by the guard is not returned.
      .returning({ id: products.id, inserted: sql<boolean>`(xmax = 0)` });
  }
}

export type ProductSortKey = 'name' | '-name' | 'price' | '-price';

export interface ProductListFilter {
  /** Case-insensitive substring of the name; LIKE wildcards are matched literally. */
  search?: string | undefined;
  /** External id of a category the product must be in. */
  category?: string | undefined;
  sort: ProductSortKey;
  limit: number;
  offset: number;
}

export interface ProductListRow {
  id: string;
  externalId: string;
  name: string;
  imageUrl: string | null;
  categoryName: string | null;
  categoryCount: number;
  priceMinor: number;
  salePriceMinor: number | null;
  currency: string;
  taxInclusive: boolean;
  availability: AvailabilityBucket;
}

/** Escape `\`, `%` and `_` so a search term is matched literally by (I)LIKE (default escape character `\`). */
export const escapeLike = (term: string): string => term.replace(/[\\%_]/g, (c) => `\\${c}`);

export class CatalogReadRepository extends StoreScoped {
  private where(filter: Pick<ProductListFilter, 'search' | 'category'>) {
    // Tombstoned products (deleted in the platform, Story 2.5) are never listed.
    const conditions = [eq(products.storeId, this.storeId), eq(products.visible, true), isNull(products.deletedAt)];
    if (filter.search) conditions.push(sql`${products.name} ilike ${`%${escapeLike(filter.search)}%`}`);
    if (filter.category) conditions.push(sql`${products.categoryExternalIds} @> array[${filter.category}]::text[]`);
    return and(...conditions);
  }

  /** One page of visible products plus the total that match, read in the caller's store transaction. */
  async listProducts(filter: ProductListFilter): Promise<{ rows: ProductListRow[]; total: number }> {
    const where = this.where(filter);
    const [{ total } = { total: 0 }] = await this.db.select({ total: sql<number>`count(*)::int` }).from(products).where(where);
    if (total === 0 || filter.offset >= total) return { rows: [], total };
    const effectivePrice = sql`coalesce(${products.salePriceMinor}, ${products.priceMinor})`;
    const dir = filter.sort.startsWith('-') ? sql`desc` : sql`asc`;
    const primary = filter.sort.endsWith('price') ? sql`${effectivePrice} ${dir}` : sql`lower(${products.name}) ${dir}`;
    const rows = await this.db
      .select({
        id: products.id,
        externalId: products.externalId,
        name: products.name,
        imageUrl: products.imageUrl,
        categoryName: sql<string | null>`(select c.name from ${categories} c where c.store_id = ${products.storeId} and c.platform = ${products.platform} and c.external_id = ${products.categoryExternalIds}[1] limit 1)`,
        categoryCount: sql<number>`coalesce(cardinality(${products.categoryExternalIds}), 0)::int`,
        priceMinor: products.priceMinor,
        salePriceMinor: products.salePriceMinor,
        currency: products.currency,
        taxInclusive: products.taxInclusive,
        availability: products.availability,
      })
      .from(products)
      .where(where)
      .orderBy(primary, sql`lower(${products.name}) asc`, products.id)
      .limit(filter.limit)
      .offset(filter.offset);
    return { rows, total };
  }

  async listCategories(): Promise<Array<{ externalId: string; name: string }>> {
    return this.db
      .select({ externalId: categories.externalId, name: categories.name })
      .from(categories)
      .where(eq(categories.storeId, this.storeId))
      .orderBy(sql`lower(${categories.name})`, categories.externalId)
      .limit(1000);
  }
}
