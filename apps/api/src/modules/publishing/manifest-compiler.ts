import { MANIFEST_PLACEMENT_MAX_ITEMS, type ManifestItem, type ManifestPlacement, type Placement, type StoreManifest } from '@slips/contracts';

/** One selected item as the compiler takes it: the resolved manifest item plus the placements it shows in. */
export interface CompileSnapshot extends ManifestItem {
  placements: readonly Placement[];
}

/**
 * Shared publishing compiler (preview and store manifests). Selection, eligibility, ordering and URL resolution belong
 * to callers. Placements are grouped by type and layout in first-seen order; each lists its items in input order, at
 * most `MANIFEST_PLACEMENT_MAX_ITEMS`. Inputs are copied, never mutated.
 */
export function compileManifest(storeId: string, snapshots: readonly CompileSnapshot[]): StoreManifest {
  const placements: ManifestPlacement[] = [];
  for (const item of snapshots) {
    for (const placement of item.placements) {
      let target = placements.find((p) => p.type === placement.type && p.layout === placement.layout);
      if (!target) placements.push((target = { type: placement.type, layout: placement.layout, item_ids: [] }));
      if (target.item_ids.length < MANIFEST_PLACEMENT_MAX_ITEMS && !target.item_ids.includes(item.id)) target.item_ids.push(item.id);
    }
  }
  return {
    v: 1,
    store_id: storeId,
    placements,
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
