import { z } from 'zod';
import { ContentFormat, ContentProductSummary, CtaAction, CtaStyle, CONTENT_TITLE_MAX, CTA_LABEL_MAX, SLIDE_ALT_MAX } from './content.js';
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
  cta_label: z.string().min(1).max(CTA_LABEL_MAX),
  cta_action: CtaAction,
  cta_url: z.string().nullable(),
  cta_style: CtaStyle.nullable(),
  product: ContentProductSummary.nullable(),
  slides: z.array(ManifestSlide),
});
export type ManifestItem = z.infer<typeof ManifestItem>;

/** Shared preview/storefront publishing contract. The version and unavailable fields are explicit. */
export const StoreManifest = z.object({ v: z.literal(1), store_id: z.uuid(), items: z.array(ManifestItem) });
export type StoreManifest = z.infer<typeof StoreManifest>;
