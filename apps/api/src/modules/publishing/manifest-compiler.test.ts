import { describe, expect, it } from 'vitest';
import { StoreManifest, type ManifestItem } from '@slips/contracts';
import { compileManifest } from './manifest-compiler.js';

const id = '019a0000-0000-7000-8000-000000000001';
const item: ManifestItem = { id, title: 'Saved', format: 'reel', cta_label: 'View', cta_action: 'open_product', cta_url: null, cta_style: 'ink', product: null, slides: [{ id, media_asset_id: id, kind: 'video', alt_text: null, status: 'scanned', source_url: '/inspected', poster_url: null, renditions: [] }] };

describe('compileManifest', () => {
  it('compiles empty and selected snapshots with resolved URLs without eligibility rules or mutation', () => {
    expect(compileManifest(id, [])).toEqual({ v: 1, store_id: id, items: [] });
    const input = structuredClone(item);
    const output = compileManifest(id, [input]);
    expect(StoreManifest.parse(output)).toEqual({ v: 1, store_id: id, items: [item] });
    expect(input).toEqual(item);
    output.items[0]!.slides[0]!.source_url = '/changed';
    expect(input.slides[0]!.source_url).toBe('/inspected');
  });
});
