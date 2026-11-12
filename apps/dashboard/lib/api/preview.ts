import { StoreManifest } from '@slips/contracts';
import { selectMedia } from '@slips/player/viewer';
import type { SessionClient } from '../session/session-client';
import { apiUrl } from './fetch';

export interface PreparedPreview { manifest: StoreManifest; release(): void }
type OwnedMedia = { url: string; owners: number };
const ownedMedia = new WeakMap<PreparedPreview, Map<string, OwnedMedia>>();
/** Only owned API byte endpoints may receive merchant credentials. */
export function protectedMediaPath(value: string, apiBase: string): string | null {
  const base = new URL(apiBase, window.location.origin);
  const url = new URL(value, base);
  const prefix = base.pathname.replace(/\/$/, '');
  if (url.origin !== base.origin || url.username || url.password || url.search || url.hash) return null;
  const path = url.pathname.slice(prefix.length);
  if (!url.pathname.startsWith(`${prefix}/`) || !/^\/v1\/media\/[0-9a-f-]{36}\/(?:source|poster|renditions\/(?:480p|720p|1080p|poster|web))$/i.test(path)) return null;
  return path;
}
export async function loadPreview(client: SessionClient, id: string, signal: AbortSignal, previous?: PreparedPreview | null): Promise<PreparedPreview> {
  const media = new Map<string, OwnedMedia>();
  const reusable = previous ? ownedMedia.get(previous) : undefined;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    for (const entry of media.values()) if (--entry.owners === 0) URL.revokeObjectURL(entry.url);
    media.clear();
  };
  try {
    const response = await client.apiFetch(`/v1/preview/content/${encodeURIComponent(id)}`, { signal });
    if (!response.ok) throw new Error('Preview request failed');
    const manifest = StoreManifest.parse(await response.json());
    const base = new URL(client.apiBase || '/', window.location.origin).href;
    const resolve = (value: string): string => {
      const url = new URL(apiUrl(value, client.apiBase), window.location.origin);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid media URL');
      return url.href;
    };
    const urls = new Map<string, string>();
    const prepare = async (value: string | null, authenticate = true): Promise<string | null> => {
      if (value === null) return null;
      const key = `${authenticate}:${value}`;
      if (urls.has(key)) return urls.get(key)!;
      const resolved = resolve(value);
      const path = protectedMediaPath(resolved, base);
      let result = resolved;
      if (authenticate && client.hasBearer && path) {
        let entry = media.get(resolved) ?? reusable?.get(resolved);
        if (!media.has(resolved)) {
          if (entry) entry.owners++;
          else {
            const response = await client.apiFetch(path, { signal, redirect: 'error' });
            if (!response.ok) throw new Error('Preview media failed');
            const blob = await response.blob();
            signal.throwIfAborted();
            entry = { url: URL.createObjectURL(blob), owners: 1 };
          }
          media.set(resolved, entry);
        }
        result = entry!.url;
      }
      urls.set(key, result); return result;
    };
    // Sequential preparation prevents allocations outliving a failed sibling request.
    for (const item of manifest.items) {
      if (item.cta_url !== null) {
        const cta = new URL(item.cta_url);
        if (!['http:', 'https:'].includes(cta.protocol) || cta.username || cta.password) throw new Error('Invalid CTA URL');
        item.cta_url = cta.href;
      }
      if (item.product) item.product.image_url = await prepare(item.product.image_url, false);
      for (const slide of item.slides) {
        // Both selection and preparation consume the same canonical API-prefixed URLs.
        if (slide.source_url) slide.source_url = resolve(slide.source_url);
        if (slide.poster_url) slide.poster_url = resolve(slide.poster_url);
        for (const rendition of slide.renditions) rendition.url = resolve(rendition.url);
        const selected = selectMedia(slide, base);
        const used = (url: string | null) => Boolean(url && selected && [selected.src, selected.poster].includes(url));
        slide.source_url = await prepare(slide.source_url, used(slide.source_url));
        slide.poster_url = await prepare(slide.poster_url, used(slide.poster_url));
        for (const rendition of slide.renditions) rendition.url = (await prepare(rendition.url, used(rendition.url)))!;
      }
    }
    signal.throwIfAborted();
    const prepared = { manifest, release };
    ownedMedia.set(prepared, media);
    return prepared;
  } catch (error) { release(); throw error; }
}
