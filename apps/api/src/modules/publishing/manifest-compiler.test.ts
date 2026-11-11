import { describe, expect, it } from 'vitest';
import { StoreManifest, type ManifestItem } from '@slips/contracts';
import { compileManifest, type CompileSnapshot } from './manifest-compiler.js';

const id = '019a0000-0000-7000-8000-000000000001';
const item: ManifestItem = { id, title: 'Saved', format: 'reel', cta_label: 'View', cta_action: 'open_product', cta_url: null, cta_style: 'ink', product: null, slides: [{ id, media_asset_id: id, kind: 'video', alt_text: null, status: 'scanned', source_url: '/inspected', poster_url: null, renditions: [] }] };
const uuid = (n: number) => `019a0000-0000-7000-8000-${String(n).padStart(12, '0')}`;

describe('compileManifest', () => {
  it('compiles empty and selected snapshots with resolved URLs without eligibility rules or mutation', () => {
    expect(compileManifest(id, [])).toEqual({ v: 1, store_id: id, placements: [], items: [] });
    const input: CompileSnapshot = { ...structuredClone(item), placements: [] };
    const output = compileManifest(id, [input]);
    expect(StoreManifest.parse(output)).toEqual({ v: 1, store_id: id, placements: [], items: [item] });
    expect(input).toEqual({ ...item, placements: [] });
    output.items[0]!.slides[0]!.source_url = '/changed';
    expect(input.slides[0]!.source_url).toBe('/inspected');
  });

  it('groups placements by type and layout in input order, caps them at ten and keeps null CTAs', () => {
    const snapshots: CompileSnapshot[] = Array.from({ length: 12 }, (_, i) => ({
      ...structuredClone(item), id: uuid(i + 1), format: 'story', cta_label: null, cta_action: null, cta_url: null,
      placements: i === 5 ? [] : [{ type: 'home', layout: 'ring' }],
    }));
    const output = StoreManifest.parse(compileManifest(id, snapshots));
    expect(output.placements).toEqual([{ type: 'home', layout: 'ring', item_ids: [1, 2, 3, 4, 5, 7, 8, 9, 10, 11].map(uuid) }]);
    expect(output.items.map((i) => i.id)).toEqual(snapshots.map((s) => s.id));
    expect(output.items[0]).toMatchObject({ cta_label: null, cta_action: null, cta_url: null });
    expect(output.items[0]).not.toHaveProperty('placements');
  });
});
