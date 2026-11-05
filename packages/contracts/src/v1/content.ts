import { z } from 'zod';

/** Content item lifecycle statuses (Story 3.1). There is no `ready`: passing processing without auto-publish returns to `draft`. */
export const CONTENT_STATUSES = ['draft', 'processing', 'failed', 'scheduled', 'published', 'ended', 'archived', 'deactivated'] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];
export const ContentStatus = z.enum(CONTENT_STATUSES);

/** Statuses that can be archived (`*` except `processing` and `archived`). */
export const ARCHIVABLE_STATUSES = ['draft', 'failed', 'scheduled', 'published', 'ended', 'deactivated'] as const;
export type ArchivableStatus = (typeof ARCHIVABLE_STATUSES)[number];

/** Statuses an item can be deactivated from and returned to on `reactivate`. */
export const REACTIVATE_STATUSES = ['published', 'scheduled'] as const;
export type ReactivateStatus = (typeof REACTIVATE_STATUSES)[number];

/** Supported shoppable content formats. */
export const CONTENT_FORMATS = ['story', 'reel'] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];
export const ContentFormat = z.enum(CONTENT_FORMATS);

/** Call-to-action actions on a content item. `open_link` requires `cta_url`; other actions forbid it. */
export const CTA_ACTIONS = ['add_to_cart', 'open_product', 'open_link'] as const;
export type CtaAction = (typeof CTA_ACTIONS)[number];
export const CtaAction = z.enum(CTA_ACTIONS);

/** Lifecycle actions that move a content item between statuses. */
export const CONTENT_ACTIONS = [
  'create',
  'start_processing',
  'finish_processing',
  'fail_processing',
  'publish',
  'schedule',
  'go_live',
  'end',
  'deactivate',
  'reactivate',
  'archive',
  'undo_archive',
  'restore',
  'delete',
] as const;
export type ContentAction = (typeof CONTENT_ACTIONS)[number];
export const ContentAction = z.enum(CONTENT_ACTIONS);

/** Domain events emitted by `content` when a content item changes status. */
export const CONTENT_EVENT_NAMES = [
  'content.item.created',
  'content.item.processing_started',
  'content.item.processed',
  'content.item.processing_failed',
  'content.item.published',
  'content.item.scheduled',
  'content.item.ended',
  'content.item.deactivated',
  'content.item.reactivated',
  'content.item.archived',
  'content.item.unarchived',
  'content.item.restored',
  'content.item.deleted',
] as const;
export type ContentEventName = (typeof CONTENT_EVENT_NAMES)[number];

export type ContentTransitionTarget = ContentStatus | 'reactivate_to' | 'archived_from' | 'tombstone';

export interface ContentTransition {
  readonly action: ContentAction;
  readonly from: readonly ContentStatus[];
  readonly to: ContentTransitionTarget;
  readonly event: ContentEventName;
}

/**
 * The authoritative status transition table for content items (Story 3.1).
 * Only `ContentLifecycle` in the `content` module applies transitions.
 */
export const CONTENT_TRANSITIONS: Readonly<Record<ContentAction, ContentTransition>> = {
  create: { action: 'create', from: [], to: 'draft', event: 'content.item.created' },
  start_processing: { action: 'start_processing', from: ['draft', 'failed'], to: 'processing', event: 'content.item.processing_started' },
  finish_processing: { action: 'finish_processing', from: ['processing'], to: 'draft', event: 'content.item.processed' },
  fail_processing: { action: 'fail_processing', from: ['processing'], to: 'failed', event: 'content.item.processing_failed' },
  publish: { action: 'publish', from: ['draft'], to: 'published', event: 'content.item.published' },
  schedule: { action: 'schedule', from: ['draft'], to: 'scheduled', event: 'content.item.scheduled' },
  go_live: { action: 'go_live', from: ['scheduled'], to: 'published', event: 'content.item.published' },
  end: { action: 'end', from: ['published', 'scheduled'], to: 'ended', event: 'content.item.ended' },
  deactivate: { action: 'deactivate', from: REACTIVATE_STATUSES, to: 'deactivated', event: 'content.item.deactivated' },
  reactivate: { action: 'reactivate', from: ['deactivated'], to: 'reactivate_to', event: 'content.item.reactivated' },
  archive: { action: 'archive', from: ARCHIVABLE_STATUSES, to: 'archived', event: 'content.item.archived' },
  undo_archive: { action: 'undo_archive', from: ['archived'], to: 'archived_from', event: 'content.item.unarchived' },
  restore: { action: 'restore', from: ['archived'], to: 'draft', event: 'content.item.restored' },
  delete: { action: 'delete', from: CONTENT_STATUSES, to: 'tombstone', event: 'content.item.deleted' },
} as const;

/** True when `action` is legal from `from` (`null` represents a not-yet-created item). */
export function canTransition(from: ContentStatus | null, action: ContentAction): boolean {
  if (from === null) return action === 'create';
  return CONTENT_TRANSITIONS[action].from.includes(from);
}

/** Problem `type` of content lifecycle endpoints when a status transition is not allowed (409). */
export const CONTENT_INVALID_TRANSITION = 'invalid-transition';

/** `POST /v1/content` request body: creates a draft Story or Reel. */
export const ContentCreateInput = z
  .strictObject({
    title: z.string().min(1).max(80),
    format: ContentFormat,
    cta_label: z.string().min(1).max(40),
    cta_action: CtaAction,
    cta_url: z.url({ protocol: /^https?$/ }).max(2048).nullable().optional(),
    cta_style: z.string().min(1).max(40).nullable().optional(),
  })
  .refine((d) => (d.cta_action === 'open_link' ? typeof d.cta_url === 'string' && d.cta_url.length > 0 : d.cta_url == null), {
    message: 'cta_url is required for open_link and forbidden otherwise',
    path: ['cta_url'],
  });
export type ContentCreateInput = z.infer<typeof ContentCreateInput>;

/** One content item returned by the merchant content API. */
export const ContentItem = z.object({
  v: z.literal(1).default(1),
  id: z.uuid(),
  title: z.string().min(1).max(80),
  format: ContentFormat,
  cta_label: z.string().min(1).max(40),
  cta_action: CtaAction,
  cta_url: z.string().nullable(),
  cta_style: z.string().nullable(),
  status: ContentStatus,
  archived_from: ContentStatus.nullable(),
  reactivate_to: ContentStatus.nullable(),
  auto_publish: z.boolean(),
  first_published_at: z.iso.datetime().nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export type ContentItem = z.infer<typeof ContentItem>;

/** Content list tabs (Story 3.2). `all` is every non-deleted status; archived, deactivated and ended appear only there. */
export const CONTENT_TABS = ['all', 'published', 'scheduled', 'drafts'] as const;
export type ContentTab = (typeof CONTENT_TABS)[number];
export const ContentTab = z.enum(CONTENT_TABS);

/** The statuses each tab lists. */
export const TAB_STATUSES: Readonly<Record<ContentTab, readonly ContentStatus[]>> = {
  all: CONTENT_STATUSES,
  published: ['published'],
  scheduled: ['scheduled'],
  drafts: ['draft', 'processing', 'failed'],
} as const;

/** Content list sort keys; a leading `-` sorts descending. `-updated` (most recently changed first) is the default. */
export const CONTENT_SORTS = ['-updated', 'updated', 'title', '-title'] as const;
export type ContentSort = (typeof CONTENT_SORTS)[number];

/** Page sizes the content list offers; the first is the default. */
export const CONTENT_PAGE_SIZES = [10, 25, 50] as const;
export type ContentPageSize = (typeof CONTENT_PAGE_SIZES)[number];
export const CONTENT_PAGE_SIZE: ContentPageSize = CONTENT_PAGE_SIZES[0];
export const isContentPageSize = (n: number): n is ContentPageSize => (CONTENT_PAGE_SIZES as readonly number[]).includes(n);
export const CONTENT_SEARCH_MAX = 100;

/** `GET /v1/content` query string. Unknown keys are ignored; a bad value is a 400 `invalid_query`. */
export const ContentListQuery = z.object({
  tab: ContentTab.default('all'),
  q: z.string().trim().max(CONTENT_SEARCH_MAX).optional(),
  sort: z.enum(CONTENT_SORTS).default('-updated'),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  page_size: z.coerce
    .number()
    .int()
    .refine(isContentPageSize, { message: `page_size must be one of ${CONTENT_PAGE_SIZES.join(', ')}` })
    .default(CONTENT_PAGE_SIZE),
});
export type ContentListQuery = z.infer<typeof ContentListQuery>;
export type ContentListQueryInput = z.input<typeof ContentListQuery>;

/** Per-tab counts; they ignore the search and the page so tab badges stay stable while searching. */
export const ContentTabCounts = z.object({
  all: z.number().int().min(0),
  published: z.number().int().min(0),
  scheduled: z.number().int().min(0),
  drafts: z.number().int().min(0),
});
export type ContentTabCounts = z.infer<typeof ContentTabCounts>;

/** `GET /v1/content` response: one page of the tab plus the counts for every tab. */
export const ContentListResponse = z.object({
  v: z.literal(1).default(1),
  items: z.array(ContentItem),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  page_size: z.number().int().min(1),
  counts: ContentTabCounts,
});
export type ContentListResponse = z.infer<typeof ContentListResponse>;
