import { Inject, Injectable } from '@nestjs/common';
import {
  CONTENT_TRANSITIONS,
  ContentCreateInput,
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
    public readonly action: ContentAction,
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
