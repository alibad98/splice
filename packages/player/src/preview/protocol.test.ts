import { describe, it, expect, vi } from 'vitest';
import { manifest } from '../../test/manifest.js';
import {
  exactOrigin,
  isManifest,
  isPreviewUpdate,
  mediaUrl,
} from './protocol.js';
import { mountPreview } from './index.js';
const { update, destroy } = vi.hoisted(() => ({
  update: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock('../viewer/index.js', () => ({
  mountViewer: () => ({ update, destroy }),
}));
const base = 'https://api.example';
describe('preview trust boundary', () => {
  it('accepts contract-shaped drafts and safe media, rejects nested malformed/unsafe state', () => {
    expect(isManifest(manifest(), base)).toBe(true);
    for (const mutate of [
      (m: ReturnType<typeof manifest>) => {
        m.v = 2 as 1;
      },
      (m: ReturnType<typeof manifest>) => {
        m.items[0]!.slides[0]!.renditions[0]!.url = 'javascript:alert(1)';
      },
      (m: ReturnType<typeof manifest>) => {
        m.items[0]!.product!.price_minor = 1.5;
      },
    ]) {
      const m = manifest();
      mutate(m);
      expect(isManifest(m, base)).toBe(false);
    }
    expect(
      isPreviewUpdate(
        {
          v: 1,
          type: 'slips.preview.update',
          locale: 'fr',
          manifest: manifest(),
        },
        base,
      ),
    ).toBe(false);
  });
  it('resolves API paths explicitly and rejects nonmedia schemes/credentials', () => {
    expect(mediaUrl('/v1/media/one', base)).toBe(base + '/v1/media/one');
    expect(mediaUrl('blob:https://editor.example/uuid', base)).toContain(
      'blob:',
    );
    for (const s of [
      'data:image/png;base64,a',
      'javascript:evil()',
      '//evil.test/a',
      'https://user:pass@example.com/a',
      'relative.png',
      'https://example.com/\nsecret',
    ])
      expect(mediaUrl(s, base)).toBeNull();
    expect(() => exactOrigin('*')).toThrow();
    expect(() => exactOrigin(base + '/path')).toThrow();
  });
  it('accepts uppercase HTTP(S) CTA schemes and rejects holes in nested arrays', () => {
    const valid = manifest();
    valid.items[0]!.cta_action = 'open_link';
    valid.items[0]!.cta_url = 'HTTPS://shop.example/item';
    expect(isManifest(valid, base)).toBe(true);
    for (const array of ['items', 'slides', 'renditions'] as const) {
      const m = manifest();
      const values =
        array === 'items'
          ? m.items
          : array === 'slides'
            ? m.items[0]!.slides
            : m.items[0]!.slides[0]!.renditions;
      delete values[0];
      expect(isManifest(m, base)).toBe(false);
    }
  });
  it('accepts a dropped CTA only when label, action and URL are all null', () => {
    const dropped = manifest();
    Object.assign(dropped.items[0]!, {
      cta_label: null,
      cta_action: null,
      cta_url: null,
    });
    expect(isManifest(dropped, base)).toBe(true);
    for (const partial of [
      { cta_label: null },
      { cta_action: null },
      { cta_label: null, cta_action: null, cta_url: 'https://shop.example/a' },
    ]) {
      const m = manifest();
      Object.assign(m.items[0]!, partial);
      expect(isManifest(m, base)).toBe(false);
    }
  });
  it('requires Home Ring placements with at most ten item ids', () => {
    const ids = (n: number) =>
      Array.from(
        { length: n },
        (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`,
      );
    const withPlacements = (placements: unknown) => ({
      ...manifest(),
      placements,
    });
    expect(isManifest(withPlacements([]), base)).toBe(true);
    expect(
      isManifest(
        withPlacements([{ type: 'home', layout: 'ring', item_ids: ids(10) }]),
        base,
      ),
    ).toBe(true);
    const without: Partial<ReturnType<typeof manifest>> = manifest();
    delete without.placements;
    expect(isManifest(without, base)).toBe(false);
    for (const placement of [
      { type: 'home', layout: 'ring', item_ids: ids(11) },
      { type: 'product', layout: 'ring', item_ids: [] },
      { type: 'home', layout: 'bar', item_ids: [] },
      { type: 'home', layout: 'ring', item_ids: ['x'] },
    ])
      expect(isManifest(withPlacements([placement]), base)).toBe(false);
  });
  it('handshakes only with exact parent and removes listener/unmounts on destroy', () => {
    const listeners = new Map<string, (event: MessageEvent) => void>();
    const parent = { postMessage: vi.fn() };
    const win = {
      parent,
      addEventListener: vi.fn((name, fn) => listeners.set(name, fn)),
      removeEventListener: vi.fn((name) => listeners.delete(name)),
    };
    const host = {
      ownerDocument: { defaultView: win },
    } as unknown as HTMLElement;
    const api = mountPreview(host, {
      parentOrigin: 'https://editor.example',
      apiBase: base,
    });
    expect(parent.postMessage).toHaveBeenCalledWith(
      { type: 'slips.preview.ready', v: 1 },
      'https://editor.example',
    );
    const data = {
      type: 'slips.preview.update',
      v: 1,
      locale: 'en',
      manifest: manifest(),
    };
    const send = (origin: string, source: unknown, payload: unknown = data) =>
      listeners.get('message')!({
        origin,
        source,
        data: payload,
      } as MessageEvent);
    send('https://evil.example', parent);
    send('https://editor.example', {});
    send('https://editor.example', parent, { ...data, v: 2 });
    expect(update).not.toHaveBeenCalled();
    send('https://editor.example', parent);
    expect(update).toHaveBeenCalledTimes(1);
    const uncloneable = { ...manifest(), extra: () => undefined };
    expect(api.update(uncloneable)).toBe(false);
    expect(update).toHaveBeenCalledTimes(1);
    expect(api.update({})).toBe(false);
    api.destroy();
    api.destroy();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
    expect(api.update(manifest())).toBe(false);
  });
});
