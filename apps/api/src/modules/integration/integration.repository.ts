import { schema, StoreScoped, and, eq, gt, inArray, type LifecycleState, type StorePlatform } from '@slips/db';

const { stores, merchantAccounts, platformTokens, tokenAccessLog, storeDataJobs } = schema;

export type StoreRow = typeof stores.$inferSelect;
export type JobRow = typeof storeDataJobs.$inferSelect;
export type TokenRow = typeof platformTokens.$inferSelect;

export interface TokenWrite {
  accessTokenEnc: string;
  refreshTokenEnc: string;
  accessExpiresAt: Date;
  scopes: string;
  keyId: string;
}

/** Data access for the integration tables; runs only inside `withStoreContext` (StoreScoped). */
export class IntegrationRepository extends StoreScoped {
  async getStore(): Promise<StoreRow | undefined> {
    return (await this.db.select().from(stores).where(eq(stores.id, this.storeId)).limit(1))[0];
  }

  async insertStore(row: { platform: StorePlatform; platformStoreId: string; name: string; syncedDomains: string[]; at?: Date }): Promise<void> {
    await this.db.insert(stores).values({ id: this.storeId, storeId: this.storeId, platform: row.platform, platformStoreId: row.platformStoreId, name: row.name, syncedDomains: row.syncedDomains, ...(row.at ? { epochStartedAt: row.at } : {}) });
  }

  async refreshStoreDetails(row: { name: string; syncedDomains: string[] }, state?: LifecycleState): Promise<void> {
    await this.db
      .update(stores)
      .set({ name: row.name, syncedDomains: row.syncedDomains, updatedAt: new Date(), ...(state ? { lifecycleState: state } : {}) })
      .where(eq(stores.id, this.storeId));
  }

  /** active -> disconnected only; any other state is left alone. Returns whether the row changed. */
  async markDisconnected(): Promise<boolean> {
    const rows = await this.db
      .update(stores)
      .set({ lifecycleState: 'disconnected', updatedAt: new Date() })
      .where(and(eq(stores.id, this.storeId), eq(stores.lifecycleState, 'active')))
      .returning({ id: stores.id });
    return rows.length > 0;
  }

  async upsertMerchant(row: { platformMerchantId: string; ownerName?: string }): Promise<void> {
    const values = { storeId: this.storeId, platformMerchantId: row.platformMerchantId, ownerName: row.ownerName ?? null };
    await this.db.insert(merchantAccounts).values(values).onConflictDoUpdate({ target: merchantAccounts.storeId, set: { platformMerchantId: values.platformMerchantId, ownerName: values.ownerName } });
  }

  async getTokens(): Promise<TokenRow | undefined> {
    return (await this.db.select().from(platformTokens).where(eq(platformTokens.storeId, this.storeId)).limit(1))[0];
  }

  async upsertTokens(t: TokenWrite): Promise<void> {
    const set = { ...t, updatedAt: new Date() };
    await this.db.insert(platformTokens).values({ storeId: this.storeId, ...t }).onConflictDoUpdate({ target: platformTokens.storeId, set });
  }

  /** Append one token-access record (purpose and outcome only, never a token). */
  async logAccess(purpose: 'install' | 'use' | 'refresh', outcome: 'ok' | 'rejected' | 'error' | 'persist_failed'): Promise<void> {
    await this.db.insert(tokenAccessLog).values({ storeId: this.storeId, purpose, outcome });
  }

  async countRecentAccess(purpose: string, outcome: string, since: Date): Promise<number> {
    const rows = await this.db
      .select({ id: tokenAccessLog.id })
      .from(tokenAccessLog)
      .where(and(eq(tokenAccessLog.storeId, this.storeId), eq(tokenAccessLog.purpose, purpose), eq(tokenAccessLog.outcome, outcome), gt(tokenAccessLog.accessedAt, since)));
    return rows.length;
  }

  /** active|disconnected -> uninstalled for exactly this epoch (guarded write). Returns whether the row changed. */
  async markUninstalled(epoch: number, at: Date, graceEndsAt: Date): Promise<boolean> {
    const rows = await this.db
      .update(stores)
      .set({ lifecycleState: 'uninstalled', uninstalledAt: at, graceEndsAt, updatedAt: at })
      .where(and(eq(stores.id, this.storeId), eq(stores.installEpoch, epoch), inArray(stores.lifecycleState, ['active', 'disconnected'])))
      .returning({ id: stores.id });
    return rows.length > 0;
  }

  /** uninstalled|purged -> active with the next epoch (guarded on the epoch read under the lock). Returns the new epoch, or undefined if the row moved. */
  async markReinstalled(epoch: number, at: Date, details: { name: string; syncedDomains: string[] }): Promise<number | undefined> {
    const rows = await this.db
      .update(stores)
      .set({
        lifecycleState: 'active',
        installEpoch: epoch + 1,
        uninstalledAt: null,
        graceEndsAt: null,
        purgedAt: null,
        epochStartedAt: at,
        updatedAt: at,
        name: details.name,
        syncedDomains: details.syncedDomains,
      })
      .where(and(eq(stores.id, this.storeId), eq(stores.installEpoch, epoch), inArray(stores.lifecycleState, ['uninstalled', 'purged'])))
      .returning({ epoch: stores.installEpoch });
    return rows[0]?.epoch;
  }

  /** uninstalled -> purged for exactly this epoch. The store row stays as a tombstone so the locator and epoch survive; merchant-supplied fields are scrubbed. */
  async markPurged(epoch: number, at: Date): Promise<boolean> {
    const rows = await this.db
      .update(stores)
      .set({ lifecycleState: 'purged', purgedAt: at, name: 'purged', syncedDomains: [], updatedAt: at })
      .where(and(eq(stores.id, this.storeId), eq(stores.installEpoch, epoch), eq(stores.lifecycleState, 'uninstalled')))
      .returning({ id: stores.id });
    return rows.length > 0;
  }

  async deleteTokens(): Promise<void> {
    await this.db.delete(platformTokens).where(eq(platformTokens.storeId, this.storeId));
  }

  async getJob(epoch: number): Promise<JobRow | undefined> {
    return (await this.db.select().from(storeDataJobs).where(and(eq(storeDataJobs.storeId, this.storeId), eq(storeDataJobs.kind, 'purge'), eq(storeDataJobs.installEpoch, epoch))).limit(1))[0];
  }

  async startJob(id: string, epoch: number): Promise<void> {
    await this.db.insert(storeDataJobs).values({ id, storeId: this.storeId, kind: 'purge', installEpoch: epoch }).onConflictDoNothing();
  }

  async progressJob(id: string, completedModules: string[], batches: number): Promise<void> {
    await this.db.update(storeDataJobs).set({ completedModules, batches, updatedAt: new Date() }).where(eq(storeDataJobs.id, id));
  }

  async finishJob(id: string, status: 'completed' | 'aborted', abortReason?: string): Promise<void> {
    await this.db.update(storeDataJobs).set({ status, abortReason: abortReason ?? null, finishedAt: new Date(), updatedAt: new Date() }).where(eq(storeDataJobs.id, id));
  }
}
