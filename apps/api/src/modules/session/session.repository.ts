import { and, eq, lt, schema, StoreScoped, type SessionMode } from '@slips/db';

const { merchantSessions } = schema;
export type SessionRow = typeof merchantSessions.$inferSelect;

/** Data access for merchant_sessions; runs only inside `withStoreContext` (StoreScoped). */
export class SessionRepository extends StoreScoped {
  async insert(row: { id: string; mode: SessionMode; secretHash: string; expiresAt: Date }): Promise<void> {
    await this.db.insert(merchantSessions).values({ ...row, storeId: this.storeId });
  }

  async get(id: string): Promise<SessionRow | undefined> {
    return (await this.db.select().from(merchantSessions).where(eq(merchantSessions.id, id)).limit(1))[0];
  }

  async touch(id: string, at: Date): Promise<void> {
    await this.db.update(merchantSessions).set({ lastSeenAt: at }).where(eq(merchantSessions.id, id));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(merchantSessions).where(eq(merchantSessions.id, id));
  }

  /** Housekeeping: drop this store's sessions that are past their hard expiry. */
  async deleteExpired(now: Date): Promise<void> {
    await this.db.delete(merchantSessions).where(and(eq(merchantSessions.storeId, this.storeId), lt(merchantSessions.expiresAt, now)));
  }
}
