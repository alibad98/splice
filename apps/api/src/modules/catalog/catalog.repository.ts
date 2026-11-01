import { schema, StoreScoped, and, eq, sql, type AvailabilityBucket, type CatalogSyncReason, type StorePlatform } from '@slips/db';

const { products, categories, catalogSyncState } = schema;

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

  async upsertCategories(rows: readonly CategoryWrite[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db
      .insert(categories)
      .values(rows.map((r) => ({ storeId: this.storeId, ...r })))
      .onConflictDoUpdate({
        target: [categories.storeId, categories.platform, categories.externalId],
        set: { name: sql`excluded.name`, sourceUpdatedAt: sql`excluded.source_updated_at`, updatedAt: sql`now()` },
      });
  }

  /** Insert or update by (store, platform, external id). Returns how many rows were created and how many updated. */
  async upsertProducts(rows: readonly ProductWrite[]): Promise<{ created: number; updated: number }> {
    if (rows.length === 0) return { created: 0, updated: 0 };
    const result = await this.db
      .insert(products)
      .values(rows.map((r) => ({ storeId: this.storeId, ...r })))
      .onConflictDoUpdate({
        target: [products.storeId, products.platform, products.externalId],
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
        },
      })
      // xmax = 0 only on a freshly inserted row version.
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    const created = result.filter((r) => r.inserted).length;
    return { created, updated: result.length - created };
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
    const conditions = [eq(products.storeId, this.storeId), eq(products.visible, true)];
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
