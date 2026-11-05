import { z } from 'zod';
import { CONTENT_STATUSES, ContentFields } from './content.js';
import { JobMeta } from './job-meta.js';
import { MEDIA_FAILURE_REASONS, MEDIA_KINDS } from './media.js';

/** Modules that may own a domain event (the spine's module list). */
export const EVENT_OWNERS = ['integration', 'catalog', 'content', 'media', 'publishing', 'analytics', 'attribution', 'billing', 'admin'] as const;
export type EventOwner = (typeof EVENT_OWNERS)[number];

/** `<module>.<entity>.<past-verb>`, lowercase snake_case segments. */
export const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export interface EventDefinition<S extends z.ZodType = z.ZodType> {
  /** The module that emits it; the name's first segment must equal it. */
  owner: EventOwner;
  /** v1 payload schema; carries `v: 1`. Additive changes only. */
  schema: S;
}

const defineEvent = <S extends z.ZodType>(owner: EventOwner, schema: S): EventDefinition<S> => ({ owner, schema });

/** Product fields a manifest shows; a change to one of them is announced. */
export const PRODUCT_VISIBLE_FIELDS = ['name', 'image_url', 'price_minor', 'sale_price_minor', 'availability', 'has_required_options', 'visible'] as const;

const contentTransitionPayload = z.object({
  v: z.literal(1),
  store_id: z.uuid(),
  content_id: z.uuid(),
  from: z.enum(CONTENT_STATUSES),
  to: z.enum(CONTENT_STATUSES),
});

/** The event catalogue (AD-17). Add events here with their owner; names outside it do not compile. */
export const EVENT_CATALOG = {
  'integration.store.installed': defineEvent(
    'integration',
    z.object({ v: z.literal(1), store_id: z.uuid(), install_epoch: z.number().int().nonnegative() }),
  ),
  'integration.store.disconnected': defineEvent(
    'integration',
    z.object({ v: z.literal(1), store_id: z.uuid(), install_epoch: z.number().int().nonnegative(), reason: z.enum(['refresh_rejected']) }),
  ),
  'integration.store.uninstalled': defineEvent(
    'integration',
    z.object({ v: z.literal(1), store_id: z.uuid(), install_epoch: z.number().int().nonnegative(), grace_ends_at: z.iso.datetime() }),
  ),
  'integration.store.reinstalled': defineEvent(
    'integration',
    z.object({ v: z.literal(1), store_id: z.uuid(), install_epoch: z.number().int().nonnegative() }),
  ),
  /**
   * A `disconnected` store was authorised again (OAuth callback or Easy Mode authorize) and is `active` (Story 2.7).
   * Published only on the disconnected-to-active transition. Consumer: `catalog`, which queues one full sync (run id = event id).
   */
  'integration.store.reconnected': defineEvent(
    'integration',
    z.object({ v: z.literal(1), store_id: z.uuid(), install_epoch: z.number().int().nonnegative() }),
  ),
  'integration.store.purged': defineEvent(
    'integration',
    z.object({ v: z.literal(1), store_id: z.uuid(), install_epoch: z.number().int().nonnegative() }),
  ),
  /** A merchant asked for a sync (Story 2.3); the event id is the run id. The worker turns it into a full-sync job. */
  'catalog.sync.requested': defineEvent('catalog', z.object({ v: z.literal(1), store_id: z.uuid(), run_id: z.uuid() })),
  'catalog.sync.completed': defineEvent(
    'catalog',
    z.object({
      v: z.literal(1),
      store_id: z.uuid(),
      run_id: z.uuid(),
      created: z.number().int().nonnegative(),
      updated: z.number().int().nonnegative(),
      finished_at: z.iso.datetime(),
    }),
  ),
  /** A webhook changed a field a manifest shows (Story 2.4); `changed` names them, the rest is the new visible snapshot. */
  'catalog.product.updated': defineEvent(
    'catalog',
    z.object({
      v: z.literal(1),
      store_id: z.uuid(),
      product_id: z.uuid(),
      external_id: z.string().min(1),
      changed: z.array(z.enum(PRODUCT_VISIBLE_FIELDS)).min(1),
      name: z.string(),
      image_url: z.string().nullable(),
      price_minor: z.number().int().nonnegative(),
      sale_price_minor: z.number().int().nonnegative().nullable(),
      currency: z.string(),
      availability: z.enum(['available', 'low', 'out_of_stock']),
      has_required_options: z.boolean(),
      visible: z.boolean(),
    }),
  ),
  /**
   * A product the platform deleted is now tombstoned (Story 2.5): by a `product.deleted` webhook, a 404 on its fetch, or
   * reconciliation (Story 2.6). Emitted once, on the live-to-deleted transition. Consumers: `content` (Story 3.4, flags
   * linked content "Linked product deleted") and `publishing` (Epic 4, drops it from manifests); they dedupe on the event id.
   * A later recreate of the same external id is announced as `catalog.product.updated` with every visible field changed.
   */
  'catalog.product.deleted': defineEvent('catalog', z.object({ v: z.literal(1), store_id: z.uuid(), product_id: z.uuid(), external_id: z.string().min(1) })),
  /** Content item lifecycle events (Story 3.1). Emitted by `ContentLifecycle` in the same transaction as the status write. */
  'content.item.created': defineEvent(
    'content',
    z.object({ v: z.literal(1), store_id: z.uuid(), content_id: z.uuid(), from: z.enum(CONTENT_STATUSES).nullable(), to: z.enum(CONTENT_STATUSES) }),
  ),
  'content.item.processing_started': defineEvent('content', contentTransitionPayload),
  'content.item.processed': defineEvent('content', contentTransitionPayload),
  'content.item.processing_failed': defineEvent('content', contentTransitionPayload),
  'content.item.published': defineEvent('content', contentTransitionPayload),
  'content.item.scheduled': defineEvent('content', contentTransitionPayload),
  'content.item.ended': defineEvent('content', contentTransitionPayload),
  'content.item.deactivated': defineEvent('content', contentTransitionPayload),
  'content.item.reactivated': defineEvent('content', contentTransitionPayload),
  'content.item.archived': defineEvent('content', contentTransitionPayload),
  'content.item.unarchived': defineEvent('content', contentTransitionPayload),
  'content.item.restored': defineEvent('content', contentTransitionPayload),
  'content.item.deleted': defineEvent(
    'content',
    z.strictObject({ v: z.literal(1), store_id: z.uuid(), content_id: z.uuid(), from: z.enum(CONTENT_STATUSES) }),
  ),
  /**
   * The merchant changed an item's fields (Story 3.3); its status is unchanged and carried as `status`. `changed` names
   * the fields that differ. Consumer: `publishing` (Epic 4) refreshes a published item in the manifest.
   */
  'content.item.edited': defineEvent(
    'content',
    z.strictObject({
      v: z.literal(1),
      store_id: z.uuid(),
      content_id: z.uuid(),
      status: z.enum(CONTENT_STATUSES),
      changed: z.array(ContentFields.keyof()).min(1),
    }),
  ),
  /** An upload was completed and recorded as `uploaded` (Story 3.5). Consumer: the worker queues `media.asset.inspect`. */
  'media.asset.uploaded': defineEvent(
    'media',
    z.strictObject({ v: z.literal(1), store_id: z.uuid(), asset_id: z.uuid(), kind: z.enum(MEDIA_KINDS), content_type: z.string().min(1), size_bytes: z.number().int().positive() }),
  ),
  /** Inspection passed: the clean copy is stored and the malware scan found nothing (`scanned`). Processing (Story 3.8) follows. */
  'media.asset.scanned': defineEvent(
    'media',
    z.strictObject({ v: z.literal(1), store_id: z.uuid(), asset_id: z.uuid(), kind: z.enum(MEDIA_KINDS), size_bytes: z.number().int().positive() }),
  ),
  /** The asset `failed`; `reason` says why. */
  'media.asset.failed': defineEvent('media', z.strictObject({ v: z.literal(1), store_id: z.uuid(), asset_id: z.uuid(), reason: z.enum(MEDIA_FAILURE_REASONS) })),
} as const;

export type EventName = keyof typeof EVENT_CATALOG;
export type EventPayload<N extends EventName> = z.infer<(typeof EVENT_CATALOG)[N]['schema']>;

export function isEventName(name: string): name is EventName {
  return Object.hasOwn(EVENT_CATALOG, name);
}

/** The job payload of the event queue: the job envelope plus the event identity and payload. */
export const EventEnvelope = JobMeta.extend({
  event_id: z.uuid(),
  name: z.string().regex(EVENT_NAME_PATTERN),
  occurred_at: z.iso.datetime(),
  payload: z.unknown(),
});
export type EventEnvelope = z.infer<typeof EventEnvelope>;

/** Queue that carries every domain event; consumed only by the worker role. */
export const EVENT_QUEUE = 'events.dispatch';
