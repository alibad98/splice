import type { MediaAssetStatus, MediaFailureReason, RenditionProfile } from '@slips/contracts';
import { schema, StoreScoped, and, eq, inArray, sql } from '@slips/db';

const { mediaAssets, mediaUploadGrants, renditions } = schema;

export type MediaAssetRow = typeof mediaAssets.$inferSelect;
export type MediaUploadGrantRow = typeof mediaUploadGrants.$inferSelect;
export type RenditionRow = typeof renditions.$inferSelect;
export type NewMediaAssetRow = typeof mediaAssets.$inferInsert;
export type NewMediaUploadGrantRow = typeof mediaUploadGrants.$inferInsert;
export type NewRenditionRow = typeof renditions.$inferInsert;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Data access for the media tables; runs only inside `withStoreContext` (StoreScoped). Only the media module uses it. */
export class MediaRepository extends StoreScoped {
  /** Serialize grant counting for the store until the transaction ends (advisory transaction lock). */
  async lockStoreGrants(): Promise<void> {
    await this.db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`media_upload_grants:${this.storeId}`}, 0))`);
  }

  /**
   * Created time of the `limit`-th most recent upload grant or link import (Story 3.7) issued after `since`, or undefined
   * when fewer than `limit` were issued. When defined the store is at its limit, and that one leaving the window frees a slot.
   */
  async nthRecentIssueSince(since: Date, limit: number): Promise<Date | undefined> {
    const after = since.toISOString();
    const result = await this.db.execute<{ created_at: string | Date }>(sql`
      select created_at from (
        select created_at from media_upload_grants where store_id = ${this.storeId} and created_at > ${after}::timestamptz
        union all
        select created_at from media_assets where store_id = ${this.storeId} and source_url is not null and created_at > ${after}::timestamptz
      ) issued
      order by created_at desc
      offset ${limit - 1} limit 1`);
    const at = result.rows[0]?.created_at;
    return at === undefined ? undefined : new Date(at);
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
   * Import outcome (worker only, Story 3.7): `uploaded` with the fetched file's hash, size, type and upload key (the
   * inspection follows), or `failed` with a reason.
   */
  async finishImport(
    id: string,
    outcome: { status: 'uploaded'; sha256: string; sizeBytes: number; contentType: string; uploadKey: string } | { status: 'failed'; reason: MediaFailureReason },
    now: Date,
  ): Promise<MediaAssetRow> {
    const set =
      outcome.status === 'uploaded'
        ? { status: outcome.status, sha256: outcome.sha256, sizeBytes: outcome.sizeBytes, contentType: outcome.contentType, uploadKey: outcome.uploadKey, failureReason: null, updatedAt: now }
        : { status: outcome.status, failureReason: outcome.reason, updatedAt: now };
    const [row] = await this.db
      .update(mediaAssets)
      .set(set)
      .where(and(eq(mediaAssets.storeId, this.storeId), eq(mediaAssets.id, id), eq(mediaAssets.status, 'importing')))
      .returning();
    if (!row) throw new Error(`media import: asset ${id} is no longer importing`);
    return row;
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

  /** Kind, status, failure reason and import link of the asked ids that are the store's assets, in one read (Stories 3.6, 3.7). */
  async summariesByIds(
    ids: readonly string[],
  ): Promise<Array<{ id: string; kind: MediaAssetRow['kind']; status: MediaAssetStatus; failureReason: string | null; sourceUrl: string | null }>> {
    const wanted = [...new Set(ids)].filter((id) => UUID_RE.test(id));
    if (wanted.length === 0) return [];
    return this.db
      .select({ id: mediaAssets.id, kind: mediaAssets.kind, status: mediaAssets.status, failureReason: mediaAssets.failureReason, sourceUrl: mediaAssets.sourceUrl })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.storeId, this.storeId), inArray(mediaAssets.id, wanted)));
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

  /**
   * Processing outcome (worker only, Story 3.8): `processed` once renditions and poster are stored, or `failed` with
   * `processing_failed`.
   */
  async finishProcessing(
    id: string,
    outcome: { status: Extract<MediaAssetStatus, 'processed'> } | { status: 'failed'; reason: MediaFailureReason },
    now: Date,
  ): Promise<MediaAssetRow> {
    const set =
      outcome.status === 'processed'
        ? { status: outcome.status, failureReason: null, updatedAt: now }
        : { status: outcome.status, failureReason: outcome.reason, updatedAt: now };
    const [row] = await this.db
      .update(mediaAssets)
      .set(set)
      .where(and(eq(mediaAssets.storeId, this.storeId), eq(mediaAssets.id, id)))
      .returning();
    return row!;
  }

  /** Insert rendition rows for an asset (idempotent on `(store_id, asset_id, profile)`). */
  async insertRenditions(rows: readonly NewRenditionRow[]): Promise<RenditionRow[]> {
    if (rows.length === 0) return [];
    return this.db
      .insert(renditions)
      .values([...rows])
      .onConflictDoNothing({ target: [renditions.storeId, renditions.assetId, renditions.profile] })
      .returning();
  }

  /** One stored rendition of `assetId` by profile (`poster`, `web`, `480p`, `720p`, `1080p`). */
  async findRendition(assetId: string, profile: RenditionProfile): Promise<RenditionRow | undefined> {
    if (!UUID_RE.test(assetId)) return undefined;
    const rows = await this.db
      .select()
      .from(renditions)
      .where(and(eq(renditions.storeId, this.storeId), eq(renditions.assetId, assetId), eq(renditions.profile, profile)))
      .limit(1);
    return rows[0];
  }

  /** Sum of `size_bytes` of the store's assets that are not `failed`, plus their stored `renditions` (Story 3.8). */
  async storedBytes(): Promise<number> {
    const result = await this.db.execute<{ total: string }>(sql`
      select (
        coalesce((select sum(size_bytes) from media_assets where store_id = ${this.storeId} and status <> 'failed'), 0) +
        coalesce((
          select sum(r.size_bytes) from renditions r
          join media_assets a on a.id = r.asset_id and a.store_id = r.store_id
          where r.store_id = ${this.storeId} and a.status <> 'failed'
        ), 0)
      )::text as total
    `);
    return Number(result.rows[0]?.total ?? 0);
  }
}
