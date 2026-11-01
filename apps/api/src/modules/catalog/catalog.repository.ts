import { schema, StoreScoped, eq, sql, type AvailabilityBucket, type CatalogSyncReason, type StorePlatform } from '@slips/db';

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
