import { schema, StoreScoped, and, eq, type LifecycleState, type StorePlatform } from '@slips/db';

const { stores, merchantAccounts, platformTokens, tokenAccessLog } = schema;

export type StoreRow = typeof stores.$inferSelect;
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

  async insertStore(row: { platform: StorePlatform; platformStoreId: string; name: string; syncedDomains: string[] }): Promise<void> {
    await this.db.insert(stores).values({ id: this.storeId, storeId: this.storeId, platform: row.platform, platformStoreId: row.platformStoreId, name: row.name, syncedDomains: row.syncedDomains });
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
  async logAccess(purpose: 'install' | 'use' | 'refresh', outcome: 'ok' | 'rejected' | 'error'): Promise<void> {
    await this.db.insert(tokenAccessLog).values({ storeId: this.storeId, purpose, outcome });
  }
}
