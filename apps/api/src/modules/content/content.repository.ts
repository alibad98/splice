import { schema, StoreScoped, and, eq, isNull } from '@slips/db';

const { contentItems } = schema;

export type ContentItemRow = typeof contentItems.$inferSelect;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Data access for `content_items` reads and row locks; runs only inside `withStoreContext` (StoreScoped). Status writes go through `ContentLifecycle` only. */
export class ContentRepository extends StoreScoped {
  async findById(id: string): Promise<ContentItemRow | undefined> {
    if (!UUID_RE.test(id)) return undefined;
    return (
      await this.db
        .select()
        .from(contentItems)
        .where(and(eq(contentItems.storeId, this.storeId), eq(contentItems.id, id), isNull(contentItems.deletedAt)))
        .limit(1)
    )[0];
  }

  /** Lock a live content item row (`FOR UPDATE`) for the rest of the transaction. */
  async lockById(id: string): Promise<ContentItemRow | undefined> {
    if (!UUID_RE.test(id)) return undefined;
    return (
      await this.db
        .select()
        .from(contentItems)
        .where(and(eq(contentItems.storeId, this.storeId), eq(contentItems.id, id), isNull(contentItems.deletedAt)))
        .for('update')
        .limit(1)
    )[0];
  }
}
