import { Inject, Injectable } from '@nestjs/common';
import {
  CONTENT_TRANSITIONS,
  CTA_STYLES,
  ContentCreateInput,
  ContentFields,
  ContentUpdateInput,
  canTransition,
  slideAltTextOk,
  type ContentAction,
  type ContentStatus,
  type MediaAssetStatus,
  type MediaKind,
  type SlideInput,
} from '@slips/contracts';
import { and, eq, inArray, requireStoreContext, schema } from '@slips/db';
import { publishEvent, uuidv7, type EventSender, type TxQueryable } from '../../events/outbox.js';
import { EVENT_SENDER } from '../../infra.module.js';
import { TELEMETRY, type Telemetry } from '../../ports/telemetry.js';
import { MediaService } from '../media/media.service.js';
import { ContentRepository, type ContentItemRow, type SlideRow } from './content.repository.js';

const { contentItems, contentProductLinks, slides } = schema;

export class InvalidTransitionError extends Error {
  constructor(
    public readonly contentId: string,
    public readonly from: ContentStatus | null,
    /** A lifecycle action, or `edit` for a field change on an archived item. */
    public readonly action: ContentAction | 'edit' | 'retry',
  ) {
    super(`Cannot apply ${action} to content item ${contentId} in status ${from ?? 'none'}`);
    this.name = 'InvalidTransitionError';
  }
}

export class ContentNotFoundError extends Error {
  constructor(public readonly contentId: string) {
    super(`Content item ${contentId} was not found`);
    this.name = 'ContentNotFoundError';
  }
}

/** The patch merged onto the item breaks a field rule (e.g. `open_link` without a URL). */
export class InvalidContentFieldsError extends Error {
  constructor(public readonly contentId: string) {
    super(`The edited fields of content item ${contentId} are not valid`);
    this.name = 'InvalidContentFieldsError';
  }
}

/** A slide names an asset whose kind is unknown (not given by the caller and not already a slide of the item). */
export class SlideAssetUnknownError extends Error {
  constructor(public readonly mediaAssetId: string) {
    super(`Media asset ${mediaAssetId} can not be attached`);
    this.name = 'SlideAssetUnknownError';
  }
}

/** An image slide has no alt text (Story 3.6). */
export class SlideAltTextRequiredError extends Error {
  constructor(public readonly mediaAssetId: string) {
    super(`Image slide ${mediaAssetId} needs alt text`);
    this.name = 'SlideAltTextRequiredError';
  }
}

/** media asset id -> kind (and optionally current status for Story 3.8 processing transitions), as the caller read it from `MediaService`. */
export type SlideAssetInfo = MediaKind | { readonly kind: MediaKind; readonly status?: MediaAssetStatus };
export type SlideAssetKinds = ReadonlyMap<string, SlideAssetInfo>;

const kindOf = (info: SlideAssetInfo | undefined): MediaKind | undefined => (typeof info === 'string' ? info : info?.kind);
const statusOf = (info: SlideAssetInfo | undefined): MediaAssetStatus | undefined => (typeof info === 'string' ? undefined : info?.status);

/** Asset statuses that mean a slide is still being imported, inspected or processed (Story 3.8). */
const IN_FLIGHT_ASSET_STATUSES: readonly MediaAssetStatus[] = ['importing', 'uploaded', 'scanned'];

/** Statuses whose fields cannot be edited (Story 3.3: archived items open read-only). */
const READ_ONLY_STATUSES: readonly ContentStatus[] = ['archived'];

const EDITABLE_FIELDS = ContentFields.keyof().options;
type EditableField = (typeof EDITABLE_FIELDS)[number];

/** Alt text as stored: trimmed, blank as null. */
const normalizeAlt = (alt: string | null | undefined): string | null => {
  const trimmed = alt?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
};

const toSlideInputs = (rows: readonly SlideRow[]): SlideInput[] => rows.map((s) => ({ media_asset_id: s.mediaAssetId, alt_text: s.altText }));
const normalizeSlides = (list: readonly SlideInput[]): SlideInput[] => list.map((s) => ({ media_asset_id: s.media_asset_id, alt_text: normalizeAlt(s.alt_text) }));

const fieldsOf = (row: ContentItemRow, productId: string | null, liveSlides: readonly SlideRow[]): ContentFields => ({
  auto_publish: row.autoPublish,
  title: row.title,
  format: row.format,
  cta_label: row.ctaLabel,
  cta_action: row.ctaAction,
  cta_url: row.ctaUrl,
  cta_style: (CTA_STYLES as readonly (string | null)[]).includes(row.ctaStyle) ? (row.ctaStyle as ContentFields['cta_style']) : null,
  product_id: productId,
  slides: toSlideInputs(liveSlides),
});

/**
 * The single command service that creates content items and changes their status (Story 3.1).
 * Every transition locks the row (`for update`), validates against `CONTENT_TRANSITIONS`, writes,
 * and emits `content.item.<verb>` through the outbox in the caller's transaction.
 * It is also the only writer of `content_product_links` (Story 3.4) and `slides` (Story 3.6); callers check the product
 * with the catalog and the slide assets with media first, and pass the asset kinds in.
 */
@Injectable()
export class ContentLifecycle {
  private readonly repo = new ContentRepository();

  constructor(
    @Inject(EVENT_SENDER) private readonly events: EventSender,
    @Inject(TELEMETRY) private readonly telemetry: Telemetry,
    @Inject(MediaService) private readonly media?: MediaService,
  ) {}

  async create(tx: TxQueryable, storeId: string, input: ContentCreateInput, now: Date = new Date(), assetKinds: SlideAssetKinds = new Map()): Promise<ContentItemRow> {
    const parsed = ContentCreateInput.parse(input);
    const id = uuidv7(now.getTime());
    const slideList = normalizeSlides(parsed.slides ?? []);
    this.checkSlides(slideList, assetKinds, []);
    const [row] = await requireStoreContext()
      .db.insert(contentItems)
      .values({
        id,
        storeId,
        title: parsed.title,
        format: parsed.format,
        ctaLabel: parsed.cta_label,
        ctaAction: parsed.cta_action,
        ctaUrl: parsed.cta_action === 'open_link' ? (parsed.cta_url ?? null) : null,
        ctaStyle: parsed.cta_style ?? null,
        status: 'draft',
        archivedFrom: null,
        reactivateTo: null,
        autoPublish: parsed.auto_publish ?? false,
        firstPublishedAt: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (parsed.product_id) await this.writeLink(storeId, id, parsed.product_id, now);
    if (slideList.length > 0) await this.writeSlides(storeId, id, slideList, now, assetKinds);
    await publishEvent(tx, this.events, this.telemetry, 'content.item.created', {
      v: 1,
      store_id: storeId,
      content_id: id,
      from: null,
      to: 'draft',
    });
    if (this.hasInFlightSlides(slideList, assetKinds)) {
      return this.apply(tx, storeId, id, 'start_processing', now);
    }
    return row!;
  }

  /**
   * Change an item's fields (Story 3.3). Locks the live row, refuses archived items (`InvalidTransitionError`), merges the
   * patch, re-checks the field rules on the merged item, writes, and emits `content.item.edited` with the unchanged
   * status in the caller's transaction. Moving the action off `open_link` clears the URL. A patch that changes nothing
   * writes nothing and emits nothing. `slides` replaces the whole list (Story 3.6); the item's status never changes.
   */
  async edit(
    tx: TxQueryable,
    storeId: string,
    contentId: string,
    patch: ContentUpdateInput,
    now: Date = new Date(),
    assetKinds: SlideAssetKinds = new Map(),
  ): Promise<ContentItemRow> {
    const parsedPatch = ContentUpdateInput.parse(patch);
    const row = await this.repo.lockById(contentId);
    if (!row) throw new ContentNotFoundError(contentId);
    if (READ_ONLY_STATUSES.includes(row.status)) throw new InvalidTransitionError(contentId, row.status, 'edit');

    const link = await this.repo.findLink(contentId);
    const liveSlides = await this.repo.liveSlides([contentId]);
    const before = fieldsOf(row, link?.productId ?? null, liveSlides);
    const merged: ContentFields = { ...before, ...parsedPatch };
    if (parsedPatch.slides !== undefined) merged.slides = normalizeSlides(parsedPatch.slides);
    if (merged.cta_action !== 'open_link' && parsedPatch.cta_url === undefined) merged.cta_url = null;
    const checked = ContentCreateInput.safeParse(merged);
    if (!checked.success) throw new InvalidContentFieldsError(contentId);
    const next = {
      ...checked.data,
      cta_url: checked.data.cta_url ?? null,
      cta_style: checked.data.cta_style ?? null,
      product_id: checked.data.product_id ?? null,
      slides: checked.data.slides ?? [],
    };

    const same = (f: EditableField): boolean =>
      f === 'slides' ? JSON.stringify(before.slides ?? []) === JSON.stringify(next.slides) : (before[f] ?? null) === (next[f] ?? null);
    const changed = EDITABLE_FIELDS.filter((f: EditableField) => !same(f));
    if (changed.length === 0) return row;

    if (changed.includes('slides')) {
      this.checkSlides(next.slides, assetKinds, liveSlides);
      await this.writeSlides(storeId, contentId, next.slides, now, assetKinds);
    }
    if (changed.includes('product_id')) await this.writeLink(storeId, contentId, next.product_id, now);
    const [updated] = await requireStoreContext()
      .db.update(contentItems)
      .set({
        autoPublish: next.auto_publish ?? false,
        title: next.title,
        format: next.format,
        ctaLabel: next.cta_label,
        ctaAction: next.cta_action,
        ctaUrl: next.cta_url,
        // A legacy style outside the presets reads as null; keep it stored unless the patch sets the style.
        ctaStyle: parsedPatch.cta_style === undefined ? row.ctaStyle : next.cta_style,
        updatedAt: now,
      })
      .where(and(eq(contentItems.storeId, storeId), eq(contentItems.id, contentId)))
      .returning();
    await publishEvent(tx, this.events, this.telemetry, 'content.item.edited', {
      v: 1,
      store_id: storeId,
      content_id: contentId,
      status: row.status,
      changed,
    });
    if (changed.includes('slides')) {
      if ((row.status === 'draft' || row.status === 'failed') && !next.slides.some(s => statusOf(assetKinds.get(s.media_asset_id)) === 'failed') && this.hasInFlightSlides(next.slides, assetKinds)) {
        return this.apply(tx, storeId, contentId, 'start_processing', now);
      }
      if ((row.status === 'processing' || row.status === 'failed') && this.allSlidesProcessed(next.slides, assetKinds)) {
        return this.apply(tx, storeId, contentId, 'finish_processing', now);
      }
    }
    return updated!;
  }

  /**
   * The linked product was deleted in the store (Story 3.4, `catalog.product.deleted`): emit `content.item.edited`
   * (`changed: ['product_id']`) for each live item linked to it, so publishing can drop or refresh them. The link rows
   * stay (the item reads as "Linked product deleted"); no item row changes. Runs in the event delivery's transaction, so
   * a redelivered event (already recorded in `event_deliveries`) never emits twice. Returns the notified item ids.
   */
  async notifyLinkedProductDeleted(tx: TxQueryable, storeId: string, productId: string): Promise<string[]> {
    const items = await this.repo.liveItemsLinkedTo(productId);
    for (const item of items) {
      await publishEvent(tx, this.events, this.telemetry, 'content.item.edited', {
        v: 1,
        store_id: storeId,
        content_id: item.id,
        status: item.status,
        changed: ['product_id'],
      });
    }
    return items.map((i) => i.id);
  }

  /**
   * Synchronize the processing status of live items that reference `mediaAssetId` when a media event
   * (`media.asset.scanned` or `media.asset.processed`) fires (Story 3.8):
   * - If an item is `draft` and any of its live slides is in flight (`importing | uploaded | scanned`), apply `start_processing`.
   * - If an item is `processing` and all of its live slides are `processed`, apply `finish_processing`.
   * Concurrently deleted or already-transitioned items are ignored.
   */
  async syncSlideProcessing(
    tx: TxQueryable,
    storeId: string,
    mediaAssetId: string,
    resolveStatuses: (assetIds: readonly string[]) => Promise<ReadonlyMap<string, MediaAssetStatus>>,
    now: Date = new Date(),
  ): Promise<string[]> {
    const candidates = await this.repo.liveItemsWithSlideAsset(mediaAssetId);
    if (candidates.length === 0) return [];

    const transitioned: string[] = [];
    for (const candidate of candidates) {
      const locked = await this.repo.lockById(candidate.id);
      if (!locked || locked.deletedAt !== null) continue;
      const itemSlides = await this.repo.liveSlides([locked.id]);
      if (itemSlides.length === 0) continue;
      const statuses = await resolveStatuses([...new Set(itemSlides.map((s) => s.mediaAssetId))]);
      const anyInFlight = itemSlides.some((s) => {
        const st = statuses.get(s.mediaAssetId);
        return st !== undefined && IN_FLIGHT_ASSET_STATUSES.includes(st);
      });
      const allProcessed = itemSlides.every((s) => statuses.get(s.mediaAssetId) === 'processed');
      try {
        if ((locked.status === 'draft' || locked.status === 'processing') && itemSlides.some(s => statuses.get(s.mediaAssetId) === 'failed')) {
          await this.apply(tx, storeId, locked.id, 'fail_processing', now);
          transitioned.push(locked.id);
        } else if ((locked.status === 'draft' || locked.status === 'failed') && !itemSlides.some(s => statuses.get(s.mediaAssetId) === 'failed') && anyInFlight) {
          await this.apply(tx, storeId, locked.id, 'start_processing', now);
          transitioned.push(locked.id);
        } else if ((locked.status === 'processing' || locked.status === 'failed') && allProcessed) {
          await this.apply(tx, storeId, locked.id, 'finish_processing', now);
          transitioned.push(locked.id);
        }
      } catch (err) {
        if (err instanceof ContentNotFoundError || err instanceof InvalidTransitionError) continue;
        throw err;
      }
    }
    return transitioned;
  }

  async retry(tx: TxQueryable, storeId: string, contentId: string): Promise<ContentItemRow> {
    const row = await this.repo.lockById(contentId);
    if (!row) throw new ContentNotFoundError(contentId);
    if (row.status !== 'failed') throw new InvalidTransitionError(contentId, row.status, 'retry');
    const slides = await this.repo.liveSlides([contentId]);
    const ids = await this.media!.requeueProcessing(tx, storeId, slides.map(s => s.mediaAssetId));
    if (!ids.length) throw new InvalidTransitionError(contentId, row.status, 'retry');
    return this.apply(tx, storeId, contentId, 'start_processing');
  }

  async publishEligibility(_tx: TxQueryable, _storeId: string, _itemId: string): Promise<{ eligible: false; reason: 'no_placement' }> {
    void _tx; void _storeId; void _itemId;
    return { eligible: false, reason: 'no_placement' };
  }

  private hasInFlightSlides(list: readonly SlideInput[], assetKinds: SlideAssetKinds): boolean {
    return list.some((s) => {
      const st = statusOf(assetKinds.get(s.media_asset_id));
      return st !== undefined && IN_FLIGHT_ASSET_STATUSES.includes(st);
    });
  }

  private allSlidesProcessed(list: readonly SlideInput[], assetKinds: SlideAssetKinds): boolean {
    if (list.length === 0) return true;
    return list.every((s) => statusOf(assetKinds.get(s.media_asset_id)) === 'processed');
  }

  /**
   * Every slide's asset kind must be known (given by the caller, or the stored kind of a live slide), and image slides
   * need alt text. Throws before anything is written.
   */
  private checkSlides(list: readonly SlideInput[], assetKinds: SlideAssetKinds, liveSlides: readonly SlideRow[]): void {
    const stored = new Map(liveSlides.map((s) => [s.mediaAssetId, s.kind] as const));
    for (const s of list) {
      const kind = kindOf(assetKinds.get(s.media_asset_id)) ?? stored.get(s.media_asset_id);
      if (!kind) throw new SlideAssetUnknownError(s.media_asset_id);
      if (!slideAltTextOk(kind, s.alt_text)) throw new SlideAltTextRequiredError(s.media_asset_id);
    }
  }

  /**
   * Make the item's live slides exactly `list`, in order (Story 3.6): live slides missing from it are soft-deleted, a
   * soft-deleted slide of a re-added asset is revived, other assets get a new slide; `position` is the list index.
   */
  private async writeSlides(storeId: string, contentId: string, list: readonly SlideInput[], now: Date, assetKinds: SlideAssetKinds): Promise<void> {
    const db = requireStoreContext().db;
    const rows = await this.repo.allSlides(contentId);
    const wanted = new Set(list.map((s) => s.media_asset_id));
    const live = new Map<string, SlideRow>();
    const removed = new Map<string, SlideRow>();
    for (const r of rows) {
      if (r.deletedAt === null) live.set(r.mediaAssetId, r);
      else if (!removed.has(r.mediaAssetId)) removed.set(r.mediaAssetId, r); // newest soft-deleted row per asset
    }

    const doomed = [...live.values()].filter((r) => !wanted.has(r.mediaAssetId)).map((r) => r.id);
    if (doomed.length > 0) {
      await db
        .update(slides)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(slides.storeId, storeId), eq(slides.contentId, contentId), inArray(slides.id, doomed)));
    }

    for (const [position, s] of list.entries()) {
      const current = live.get(s.media_asset_id);
      if (current) {
        if (current.position === position && current.altText === s.alt_text) continue;
        await db
          .update(slides)
          .set({ position, altText: s.alt_text, updatedAt: now })
          .where(and(eq(slides.storeId, storeId), eq(slides.id, current.id)));
        continue;
      }
      const revived = removed.get(s.media_asset_id);
      const kind = kindOf(assetKinds.get(s.media_asset_id)) ?? revived?.kind;
      if (!kind) throw new SlideAssetUnknownError(s.media_asset_id);
      if (revived) {
        await db
          .update(slides)
          .set({ deletedAt: null, position, altText: s.alt_text, kind, updatedAt: now })
          .where(and(eq(slides.storeId, storeId), eq(slides.id, revived.id)));
        continue;
      }
      await db.insert(slides).values({
        id: uuidv7(now.getTime()),
        storeId,
        contentId,
        mediaAssetId: s.media_asset_id,
        kind,
        position,
        altText: s.alt_text,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  /** Point the item's one link row at `productId`, or at nothing (`null`): the row is kept, never hard-deleted. */
  private async writeLink(storeId: string, contentId: string, productId: string | null, now: Date): Promise<void> {
    await requireStoreContext()
      .db.insert(contentProductLinks)
      .values({ id: uuidv7(now.getTime()), storeId, contentId, productId, slideId: null, createdAt: now })
      .onConflictDoUpdate({ target: [contentProductLinks.storeId, contentProductLinks.contentId], set: { productId } });
  }

  async apply(tx: TxQueryable, storeId: string, contentId: string, action: ContentAction, now: Date = new Date()): Promise<ContentItemRow> {
    const row = await this.repo.lockById(contentId);
    if (!row) throw new ContentNotFoundError(contentId);
    if (!canTransition(row.status, action)) {
      throw new InvalidTransitionError(contentId, row.status, action);
    }

    if (action === 'finish_processing' && row.autoPublish) await this.publishEligibility(tx, storeId, contentId);
    const from = row.status;
    if (action === 'delete') {
      const [deleted] = await requireStoreContext()
        .db.update(contentItems)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(contentItems.storeId, storeId), eq(contentItems.id, contentId)))
        .returning();
      await publishEvent(tx, this.events, this.telemetry, 'content.item.deleted', {
        v: 1,
        store_id: storeId,
        content_id: contentId,
        from,
      });
      return deleted!;
    }

    let to: ContentStatus;
    if (action === 'reactivate') {
      if (!row.reactivateTo) throw new InvalidTransitionError(contentId, from, action);
      to = row.reactivateTo;
    } else if (action === 'undo_archive') {
      if (!row.archivedFrom) throw new InvalidTransitionError(contentId, from, action);
      to = row.archivedFrom;
    } else {
      to = CONTENT_TRANSITIONS[action].to as ContentStatus;
    }

    const archivedFrom = action === 'archive' ? from : action === 'undo_archive' || action === 'restore' ? null : row.archivedFrom;
    const reactivateTo = action === 'deactivate' ? from : action === 'reactivate' || action === 'restore' ? null : row.reactivateTo;
    const firstPublishedAt = row.firstPublishedAt ?? (to === 'published' ? now : null);

    const [updated] = await requireStoreContext()
      .db.update(contentItems)
      .set({
        status: to,
        archivedFrom,
        reactivateTo,
        firstPublishedAt,
        updatedAt: now,
      })
      .where(and(eq(contentItems.storeId, storeId), eq(contentItems.id, contentId)))
      .returning();

    const eventName = CONTENT_TRANSITIONS[action].event as Exclude<typeof CONTENT_TRANSITIONS[ContentAction]['event'], 'content.item.created' | 'content.item.deleted'>;
    await publishEvent(tx, this.events, this.telemetry, eventName, {
      v: 1,
      store_id: storeId,
      content_id: contentId,
      from,
      to,
    });
    return updated!;
  }
}
