import { and, eq, schema, StoreScoped, type LifecycleState } from '@slips/db';

const { merchantSessions, stores } = schema;

/** Per-store reads and writes for email/password sign-in. Runs only inside `withStoreContext`. */
export class CredentialsRepository extends StoreScoped {
  async getStore(): Promise<{ name: string; lifecycleState: LifecycleState } | undefined> {
    return (await this.db.select({ name: stores.name, lifecycleState: stores.lifecycleState }).from(stores).where(eq(stores.id, this.storeId)).limit(1))[0];
  }

  /** Invalidate existing direct sessions for this store on password change. */
  async revokeAllDirectSessions(): Promise<void> {
    await this.db.delete(merchantSessions).where(and(eq(merchantSessions.storeId, this.storeId), eq(merchantSessions.mode, 'direct')));
  }
}
