import type { ManifestItem, StoreManifest } from '@slips/contracts';

/** Shared publishing compiler. Selection, eligibility and URL resolution belong to callers. */
export function compileManifest(storeId: string, snapshots: readonly ManifestItem[]): StoreManifest {
  return {
    v: 1,
    store_id: storeId,
    items: snapshots.map((item) => ({
      id: item.id,
      title: item.title,
      format: item.format,
      cta_label: item.cta_label,
      cta_action: item.cta_action,
      cta_url: item.cta_url,
      cta_style: item.cta_style,
      product: item.product ? { ...item.product } : null,
      slides: item.slides.map((slide) => ({ ...slide, renditions: slide.renditions.map((rendition) => ({ ...rendition })) })),
    })),
  };
}
