import { TAB_STATUSES, type ContentSort, type ContentStatus, type ContentTabCounts } from '@slips/contracts';
import { schema, StoreScoped, and, eq, inArray, isNull, sql } from '@slips/db';

const { contentItems, contentProductLinks, slides, placements } = schema;

export type ContentItemRow = typeof contentItems.$inferSelect;
export type ContentProductLinkRow = typeof contentProductLinks.$inferSelect;
export type SlideRow = typeof slides.$inferSelect;

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
  async placements(contentIds: readonly string[]) {
    const wanted = [...new Set(contentIds)].filter(id => UUID_RE.test(id));
    if (!wanted.length) return [];
    return this.db.select().from(placements).where(and(eq(placements.storeId, this.storeId), inArray(placements.contentId, wanted)));
  }

  /**
   * Live `published` Stories with a Home placement (Story 4.4 store manifest candidates), newest first publication first,
   * then id. Media and product eligibility are decided by the caller through their owners.
   */
  async publishedHomeStories(): Promise<ContentItemRow[]> {
    return this.db
      .select()
      .from(contentItems)
      .where(
        and(
          eq(contentItems.storeId, this.storeId),
          isNull(contentItems.deletedAt),
          eq(contentItems.status, 'published'),
          eq(contentItems.format, 'story'),
          sql`exists (select 1 from ${placements} where ${placements.storeId} = ${contentItems.storeId} and ${placements.contentId} = ${contentItems.id} and ${placements.type} = 'home')`,
        ),
      )
      .orderBy(sql`${contentItems.firstPublishedAt} desc nulls last`, sql`${contentItems.id} desc`);
  }

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

  /** The link row of one item (Story 3.4), whether or not it currently names a product. */
  async findLink(contentId: string): Promise<ContentProductLinkRow | undefined> {
    return (
      await this.db
        .select()
        .from(contentProductLinks)
        .where(and(eq(contentProductLinks.storeId, this.storeId), eq(contentProductLinks.contentId, contentId)))
        .limit(1)
    )[0];
  }

  /** The live slides of the items, in one read, ordered by item then position (Story 3.6). */
  async liveSlides(contentIds: readonly string[]): Promise<SlideRow[]> {
    const wanted = [...new Set(contentIds)].filter((id) => UUID_RE.test(id));
    if (wanted.length === 0) return [];
    return this.db
      .select()
      .from(slides)
      .where(and(eq(slides.storeId, this.storeId), inArray(slides.contentId, wanted), isNull(slides.deletedAt)))
      .orderBy(slides.contentId, slides.position, slides.id);
  }

  /** Every slide row of one item, soft-deleted ones included (newest first), so a re-added asset revives its slide. */
  async allSlides(contentId: string): Promise<SlideRow[]> {
    if (!UUID_RE.test(contentId)) return [];
    return this.db
      .select()
      .from(slides)
      .where(and(eq(slides.storeId, this.storeId), eq(slides.contentId, contentId)))
      .orderBy(sql`${slides.deletedAt} desc nulls first`, sql`${slides.updatedAt} desc`);
  }

  /** content id -> linked product id, for the items that have one, in one read. */
  async linkedProductIds(contentIds: readonly string[]): Promise<Map<string, string>> {
    if (contentIds.length === 0) return new Map();
    const rows = await this.db
      .select({ contentId: contentProductLinks.contentId, productId: contentProductLinks.productId })
      .from(contentProductLinks)
      .where(and(eq(contentProductLinks.storeId, this.storeId), inArray(contentProductLinks.contentId, [...contentIds])));
    return new Map(rows.flatMap((r) => (r.productId ? [[r.contentId, r.productId] as const] : [])));
  }

  /** Live (non-deleted) items linked to a product, with their status. */
  async liveItemsLinkedTo(productId: string): Promise<Array<{ id: string; status: ContentStatus }>> {
    return this.db
      .select({ id: contentItems.id, status: contentItems.status })
      .from(contentProductLinks)
      .innerJoin(contentItems, and(eq(contentItems.storeId, contentProductLinks.storeId), eq(contentItems.id, contentProductLinks.contentId)))
      .where(and(eq(contentProductLinks.storeId, this.storeId), eq(contentProductLinks.productId, productId), isNull(contentItems.deletedAt)))
      .orderBy(contentItems.id);
  }

  /** Live (non-deleted) items that have a live (non-deleted) slide referencing `mediaAssetId`, with their status (Story 3.8). */
  async liveItemsWithSlideAsset(mediaAssetId: string): Promise<Array<{ id: string; status: ContentStatus }>> {
    if (!UUID_RE.test(mediaAssetId)) return [];
    return this.db
      .select({ id: contentItems.id, status: contentItems.status })
      .from(slides)
      .innerJoin(contentItems, and(eq(contentItems.storeId, slides.storeId), eq(contentItems.id, slides.contentId)))
      .where(and(eq(slides.storeId, this.storeId), eq(slides.mediaAssetId, mediaAssetId), isNull(slides.deletedAt), isNull(contentItems.deletedAt)))
      .orderBy(contentItems.id);
  }

  /** product id -> number of live (non-deleted) items linked to it, in one grouped query; products without links are absent. */
  async linkCountsByProductIds(productIds: readonly string[]): Promise<Map<string, number>> {
    const wanted = [...new Set(productIds)].filter((id) => UUID_RE.test(id));
    if (wanted.length === 0) return new Map();
    const rows = await this.db
      .select({ productId: contentProductLinks.productId, count: sql<number>`count(*)::int` })
      .from(contentProductLinks)
      .innerJoin(contentItems, and(eq(contentItems.storeId, contentProductLinks.storeId), eq(contentItems.id, contentProductLinks.contentId)))
      .where(and(eq(contentProductLinks.storeId, this.storeId), inArray(contentProductLinks.productId, wanted), isNull(contentItems.deletedAt)))
      .groupBy(contentProductLinks.productId);
    return new Map(rows.flatMap((r) => (r.productId ? [[r.productId, r.count] as const] : [])));
  }
}
