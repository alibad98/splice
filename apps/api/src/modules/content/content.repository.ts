import { TAB_STATUSES, type ContentSort, type ContentStatus, type ContentTabCounts } from '@slips/contracts';
import { schema, StoreScoped, and, eq, inArray, isNull, sql } from '@slips/db';

const { contentItems } = schema;

export type ContentItemRow = typeof contentItems.$inferSelect;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Escape `\`, `%` and `_` so a search term is matched literally by ILIKE (default escape character `\`). */
const escapeLike = (term: string): string => term.replace(/[\\%_]/g, (c) => `\\${c}`);

export interface ContentListFilter {
  statuses: readonly ContentStatus[];
  search?: string | undefined;
  sort: ContentSort;
  limit: number;
  offset: number;
}

const inList = (statuses: readonly ContentStatus[]) =>
  sql.join(
    statuses.map((s) => sql`${s}`),
    sql`, `,
  );

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

  /** One page of live (non-deleted) items in the given statuses, matching the title search, plus their total. */
  async list(filter: ContentListFilter): Promise<{ rows: ContentItemRow[]; total: number }> {
    const conditions = [eq(contentItems.storeId, this.storeId), isNull(contentItems.deletedAt), inArray(contentItems.status, [...filter.statuses])];
    if (filter.search) conditions.push(sql`${contentItems.title} ilike ${`%${escapeLike(filter.search)}%`}`);
    const where = and(...conditions);
    const [{ total } = { total: 0 }] = await this.db.select({ total: sql<number>`count(*)::int` }).from(contentItems).where(where);
    if (total === 0 || filter.offset >= total) return { rows: [], total };
    const dir = filter.sort.startsWith('-') ? sql`desc` : sql`asc`;
    const primary = filter.sort.endsWith('title') ? sql`lower(${contentItems.title}) ${dir}` : sql`${contentItems.updatedAt} ${dir}`;
    const rows = await this.db
      .select()
      .from(contentItems)
      .where(where)
      .orderBy(primary, sql`${contentItems.id} ${dir}`)
      .limit(filter.limit)
      .offset(filter.offset);
    return { rows, total };
  }

  /** Live item counts for every tab in one query; independent of search and page. */
  async countByTab(): Promise<ContentTabCounts> {
    const [row] = await this.db
      .select({
        all: sql<number>`count(*)::int`,
        published: sql<number>`(count(*) filter (where ${contentItems.status} in (${inList(TAB_STATUSES.published)})))::int`,
        scheduled: sql<number>`(count(*) filter (where ${contentItems.status} in (${inList(TAB_STATUSES.scheduled)})))::int`,
        drafts: sql<number>`(count(*) filter (where ${contentItems.status} in (${inList(TAB_STATUSES.drafts)})))::int`,
      })
      .from(contentItems)
      .where(and(eq(contentItems.storeId, this.storeId), isNull(contentItems.deletedAt)));
    return row ?? { all: 0, published: 0, scheduled: 0, drafts: 0 };
  }
}
