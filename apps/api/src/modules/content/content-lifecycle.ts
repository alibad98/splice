import { Inject, Injectable } from '@nestjs/common';
import {
  CONTENT_TRANSITIONS,
  CTA_STYLES,
  ContentCreateInput,
  ContentFields,
  ContentUpdateInput,
  canTransition,
  type ContentAction,
  type ContentStatus,
} from '@slips/contracts';
import { and, eq, requireStoreContext, schema } from '@slips/db';
import { publishEvent, uuidv7, type EventSender, type TxQueryable } from '../../events/outbox.js';
import { EVENT_SENDER } from '../../infra.module.js';
import { TELEMETRY, type Telemetry } from '../../ports/telemetry.js';
import { ContentRepository, type ContentItemRow } from './content.repository.js';

const { contentItems } = schema;

export class InvalidTransitionError extends Error {
  constructor(
    public readonly contentId: string,
    public readonly from: ContentStatus | null,
    /** A lifecycle action, or `edit` for a field change on an archived item. */
    public readonly action: ContentAction | 'edit',
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

/** Statuses whose fields cannot be edited (Story 3.3: archived items open read-only). */
const READ_ONLY_STATUSES: readonly ContentStatus[] = ['archived'];

const EDITABLE_FIELDS = ContentFields.keyof().options;
type EditableField = (typeof EDITABLE_FIELDS)[number];

const fieldsOf = (row: ContentItemRow): ContentFields => ({
  title: row.title,
  format: row.format,
  cta_label: row.ctaLabel,
  cta_action: row.ctaAction,
  cta_url: row.ctaUrl,
  cta_style: (CTA_STYLES as readonly (string | null)[]).includes(row.ctaStyle) ? (row.ctaStyle as ContentFields['cta_style']) : null,
});

/**
 * The single command service that creates content items and changes their status (Story 3.1).
 * Every transition locks the row (`for update`), validates against `CONTENT_TRANSITIONS`, writes,
 * and emits `content.item.<verb>` through the outbox in the caller's transaction.
 */
@Injectable()
export class ContentLifecycle {
  private readonly repo = new ContentRepository();

  constructor(
    @Inject(EVENT_SENDER) private readonly events: EventSender,
    @Inject(TELEMETRY) private readonly telemetry: Telemetry,
  ) {}

  async create(tx: TxQueryable, storeId: string, input: ContentCreateInput, now: Date = new Date()): Promise<ContentItemRow> {
    const parsed = ContentCreateInput.parse(input);
    const id = uuidv7(now.getTime());
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
        autoPublish: false,
        firstPublishedAt: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await publishEvent(tx, this.events, this.telemetry, 'content.item.created', {
      v: 1,
      store_id: storeId,
      content_id: id,
      from: null,
      to: 'draft',
    });
    return row!;
  }

  /**
   * Change an item's fields (Story 3.3). Locks the live row, refuses archived items (`InvalidTransitionError`), merges the
   * patch, re-checks the field rules on the merged item, writes, and emits `content.item.edited` with the unchanged
   * status in the caller's transaction. Moving the action off `open_link` clears the URL. A patch that changes nothing
   * writes nothing and emits nothing.
   */
  async edit(tx: TxQueryable, storeId: string, contentId: string, patch: ContentUpdateInput, now: Date = new Date()): Promise<ContentItemRow> {
    const parsedPatch = ContentUpdateInput.parse(patch);
    const row = await this.repo.lockById(contentId);
    if (!row) throw new ContentNotFoundError(contentId);
    if (READ_ONLY_STATUSES.includes(row.status)) throw new InvalidTransitionError(contentId, row.status, 'edit');

    const before = fieldsOf(row);
    const merged: ContentFields = { ...before, ...parsedPatch };
    if (merged.cta_action !== 'open_link' && parsedPatch.cta_url === undefined) merged.cta_url = null;
    const checked = ContentCreateInput.safeParse(merged);
    if (!checked.success) throw new InvalidContentFieldsError(contentId);
    const next = { ...checked.data, cta_url: checked.data.cta_url ?? null, cta_style: checked.data.cta_style ?? null };

    const changed = EDITABLE_FIELDS.filter((f: EditableField) => (before[f] ?? null) !== (next[f] ?? null));
    if (changed.length === 0) return row;

    const [updated] = await requireStoreContext()
      .db.update(contentItems)
      .set({
        title: next.title,
        format: next.format,
        ctaLabel: next.cta_label,
        ctaAction: next.cta_action,
        ctaUrl: next.cta_url,
        ctaStyle: next.cta_style,
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
    return updated!;
  }

  async apply(tx: TxQueryable, storeId: string, contentId: string, action: ContentAction, now: Date = new Date()): Promise<ContentItemRow> {
    const row = await this.repo.lockById(contentId);
    if (!row) throw new ContentNotFoundError(contentId);
    if (!canTransition(row.status, action)) {
      throw new InvalidTransitionError(contentId, row.status, action);
    }

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
