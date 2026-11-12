import { z } from 'zod';
import { ContentFormat, ContentProductSummary, CtaAction, CtaStyle, StoryLayout, CONTENT_TITLE_MAX, CTA_LABEL_MAX, SLIDE_ALT_MAX } from './content.js';
import { MediaAssetStatus, MediaKind, RenditionProfile } from './media.js';

/** A resolved media rendition. URLs are supplied by the publishing destination. */
export const ManifestRendition = z.object({
  profile: RenditionProfile,
  url: z.string().min(1),
  content_type: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type ManifestRendition = z.infer<typeof ManifestRendition>;

export const ManifestSlide = z.object({
  id: z.uuid(),
  media_asset_id: z.uuid(),
  kind: MediaKind,
  alt_text: z.string().max(SLIDE_ALT_MAX).nullable(),
  status: MediaAssetStatus,
  source_url: z.string().min(1).nullable(),
  poster_url: z.string().min(1).nullable(),
  renditions: z.array(ManifestRendition),
});
export type ManifestSlide = z.infer<typeof ManifestSlide>;

export const ManifestItem = z.object({
  id: z.uuid(),
  title: z.string().min(1).max(CONTENT_TITLE_MAX),
  format: ContentFormat,
  /** `null` (with `cta_action` and `cta_url`) when the compile dropped the CTA, e.g. an open link off the store's domains. */
  cta_label: z.string().min(1).max(CTA_LABEL_MAX).nullable(),
  cta_action: CtaAction.nullable(),
  cta_url: z.string().nullable(),
  cta_style: CtaStyle.nullable(),
  product: ContentProductSummary.nullable(),
  slides: z.array(ManifestSlide),
}).refine((i) => (i.cta_label === null) === (i.cta_action === null) && (i.cta_action !== null || i.cta_url === null), {
  message: 'A dropped CTA nulls cta_label, cta_action and cta_url together',
  path: ['cta_action'],
});
export type ManifestItem = z.infer<typeof ManifestItem>;

/** Items one placement lists at most (Story 4.4): the newest by first publication. */
export const MANIFEST_PLACEMENT_MAX_ITEMS = 10;

/** Where items show and how (Story 4.4 pilot: Home with the Ring layout only). `item_ids` are in display order. */
export const ManifestPlacement = z.object({
  type: z.literal('home'),
  layout: StoryLayout,
  item_ids: z.array(z.uuid()).max(MANIFEST_PLACEMENT_MAX_ITEMS),
});
export type ManifestPlacement = z.infer<typeof ManifestPlacement>;

/** Shared preview/storefront publishing contract. The version and unavailable fields are explicit. */
export const StoreManifest = z.object({ v: z.literal(1), store_id: z.uuid(), placements: z.array(ManifestPlacement), items: z.array(ManifestItem) });
export type StoreManifest = z.infer<typeof StoreManifest>;
