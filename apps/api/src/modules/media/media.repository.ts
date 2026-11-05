import type { MediaAssetStatus, MediaFailureReason } from '@slips/contracts';
import { schema, StoreScoped, and, eq, inArray, sql } from '@slips/db';

const { mediaAssets, mediaUploadGrants } = schema;

export type MediaAssetRow = typeof mediaAssets.$inferSelect;
export type MediaUploadGrantRow = typeof mediaUploadGrants.$inferSelect;
export type NewMediaAssetRow = typeof mediaAssets.$inferInsert;
export type NewMediaUploadGrantRow = typeof mediaUploadGrants.$inferInsert;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Data access for the media tables; runs only inside `withStoreContext` (StoreScoped). Only the media module uses it. */
export class MediaRepository extends StoreScoped {
  /** Serialize grant counting for the store until the transaction ends (advisory transaction lock). */
  async lockStoreGrants(): Promise<void> {
    await this.db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`media_upload_grants:${this.storeId}`}, 0))`);
  }

  /**
   * Created time of the `limit`-th most recent grant issued after `since`, or undefined when fewer than `limit` were
   * issued. When defined the store is at its limit, and that grant leaving the window frees one slot.
   */
  async nthRecentGrantSince(since: Date, limit: number): Promise<Date | undefined> {
    const rows = await this.db
      .select({ createdAt: mediaUploadGrants.createdAt })
      .from(mediaUploadGrants)
      .where(and(eq(mediaUploadGrants.storeId, this.storeId), sql`${mediaUploadGrants.createdAt} > ${since.toISOString()}`))
      .orderBy(sql`${mediaUploadGrants.createdAt} desc`)
      .offset(limit - 1)
      .limit(1);
    return rows[0]?.createdAt;
  }

  async insertGrant(row: NewMediaUploadGrantRow): Promise<MediaUploadGrantRow> {
    const [inserted] = await this.db.insert(mediaUploadGrants).values(row).returning();
    return inserted!;
  }

  async findGrant(id: string, opts: { forUpdate?: boolean } = {}): Promise<MediaUploadGrantRow | undefined> {
    if (!UUID_RE.test(id)) return undefined;
    const q = this.db
      .select()
      .from(mediaUploadGrants)
      .where(and(eq(mediaUploadGrants.storeId, this.storeId), eq(mediaUploadGrants.id, id)))
      .limit(1);
    return (await (opts.forUpdate ? q.for('update') : q))[0];
  }

  async markGrantCompleted(id: string, assetId: string): Promise<void> {
    await this.db
      .update(mediaUploadGrants)
      .set({ completedAssetId: assetId })
      .where(and(eq(mediaUploadGrants.storeId, this.storeId), eq(mediaUploadGrants.id, id)));
  }

  async insertAsset(row: NewMediaAssetRow): Promise<MediaAssetRow> {
    const [inserted] = await this.db.insert(mediaAssets).values(row).returning();
    return inserted!;
  }

  async findAsset(id: string, opts: { forUpdate?: boolean } = {}): Promise<MediaAssetRow | undefined> {
    if (!UUID_RE.test(id)) return undefined;
    const q = this.db
      .select()
      .from(mediaAssets)
      .where(and(eq(mediaAssets.storeId, this.storeId), eq(mediaAssets.id, id)))
      .limit(1);
    return (await (opts.forUpdate ? q.for('update') : q))[0];
  }

  /** Inspection outcome (worker only): `scanned` with the clean copy, or `failed` with a reason. */
  async finishInspection(
    id: string,
    outcome: { status: Extract<MediaAssetStatus, 'scanned'>; storageKey: string; sizeBytes: number } | { status: 'failed'; reason: MediaFailureReason },
    now: Date,
  ): Promise<MediaAssetRow> {
    const set =
      outcome.status === 'scanned'
        ? { status: outcome.status, storageKey: outcome.storageKey, sizeBytes: outcome.sizeBytes, failureReason: null, updatedAt: now }
        : { status: outcome.status, failureReason: outcome.reason, updatedAt: now };
    const [row] = await this.db
      .update(mediaAssets)
      .set(set)
      .where(and(eq(mediaAssets.storeId, this.storeId), eq(mediaAssets.id, id)))
      .returning();
    return row!;
  }

  /**
   * Whether another upload still needs the object at `key`. Upload keys are content-addressed per store, so two uploads of
   * the same bytes share one object: another asset still `uploaded`, or an open grant (not completed, not expired).
   */
  async uploadKeyInUse(key: string, except: { assetId?: string; grantId?: string }, now: Date): Promise<boolean> {
    // One statement, one snapshot: a sibling complete (grant closed + asset inserted in one commit) is seen on one side or the other.
    const exceptAsset = except.assetId ?? '00000000-0000-0000-0000-000000000000';
    const exceptGrant = except.grantId ?? '00000000-0000-0000-0000-000000000000';
    const result = await this.db.execute<{ in_use: boolean }>(sql`
      select exists (
        select 1 from media_assets
        where store_id = ${this.storeId} and upload_key = ${key} and status = 'uploaded' and id <> ${exceptAsset}::uuid
      ) or exists (
        select 1 from media_upload_grants
        where store_id = ${this.storeId} and storage_key = ${key} and completed_asset_id is null
          and expires_at > ${now.toISOString()}::timestamptz and id <> ${exceptGrant}::uuid
      ) as in_use`);
    return Boolean(result.rows[0]?.in_use);
  }

  /** The asked ids that are `processed` (the only publishable status). */
  async processedIds(ids: readonly string[]): Promise<string[]> {
    const wanted = [...new Set(ids)].filter((id) => UUID_RE.test(id));
    if (wanted.length === 0) return [];
    const rows = await this.db
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.storeId, this.storeId), inArray(mediaAssets.id, wanted), eq(mediaAssets.status, 'processed')));
    return rows.map((r) => r.id);
  }

  /** Sum of `size_bytes` of the store's assets that are not `failed`. */
  async storedBytes(): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<string>`coalesce(sum(${mediaAssets.sizeBytes}), 0)::text` })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.storeId, this.storeId), sql`${mediaAssets.status} <> 'failed'`));
    return Number(row?.total ?? 0);
  }
}
