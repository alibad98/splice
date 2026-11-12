import { CTA_STYLES, type ContentProductSummary, type CtaStyle, type ManifestRendition, type MediaAssetStatus } from '@slips/contracts';
import type { ProductSummaryRow } from '../catalog/catalog.service.js';
import type { ContentService } from '../content/content.service.js';
import type { CompileSnapshot } from './manifest-compiler.js';

/** The content owner's item snapshot (`getItemSnapshot`; `getStoreManifestCandidates` returns the same shape). */
export type ContentSnapshot = NonNullable<Awaited<ReturnType<ContentService['getItemSnapshot']>>>;

/** Media resolved by the media owner for one asset (preview or published URLs). */
export interface ResolvedMedia {
  status: MediaAssetStatus;
  source_url: string | null;
  poster_url: string | null;
  renditions: ManifestRendition[];
}

export const toProductSummary = (p: ProductSummaryRow): ContentProductSummary => ({
  id: p.id, name: p.name, image_url: p.imageUrl, price_minor: p.priceMinor, sale_price_minor: p.salePriceMinor,
  currency: p.currency, availability: p.availability, has_required_options: p.hasRequiredOptions, deleted: p.deleted,
});

/**
 * One compiler input from owner snapshots: the shared mapping preview and store compiles use. A legacy CTA style
 * outside the presets reads as `null`; an asset the media owner did not resolve reads as `failed` with no URLs.
 */
export function toCompileSnapshot(saved: ContentSnapshot, product: ContentProductSummary | null, media: ReadonlyMap<string, ResolvedMedia>): CompileSnapshot {
  const { item, slides, placements } = saved;
  return {
    id: item.id, title: item.title, format: item.format,
    cta_label: item.ctaLabel, cta_action: item.ctaAction, cta_url: item.ctaUrl,
    cta_style: (CTA_STYLES as readonly (string | null)[]).includes(item.ctaStyle) ? (item.ctaStyle as CtaStyle) : null,
    product,
    slides: slides.map((slide) => {
      const asset = media.get(slide.mediaAssetId);
      return {
        id: slide.id, media_asset_id: slide.mediaAssetId, kind: slide.kind, alt_text: slide.altText,
        status: asset?.status ?? 'failed', source_url: asset?.source_url ?? null, poster_url: asset?.poster_url ?? null,
        renditions: asset?.renditions ?? [],
      };
    }),
    placements: placements.map((p) => ({ type: p.type, layout: p.layout })),
  };
}
