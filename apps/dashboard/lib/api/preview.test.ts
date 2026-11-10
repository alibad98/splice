// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import type { SessionClient } from '../session/session-client';
import type { StoreManifest } from '@slips/contracts';
import { loadPreview, protectedMediaPath } from './preview';
const id = '019a473a-0000-7000-8000-000000000001';
const path = `/v1/media/${id}/source`;
const manifest = () => ({ v: 1, store_id: id, items: [{ id, title: 'Saved', format: 'story', cta_label: 'Shop', cta_action: 'open_link', cta_url: 'https://shop.example', cta_style: null, product: null, slides: [{ id, media_asset_id: id, kind: 'image', status: 'scanned', alt_text: 'Saved image', source_url: path, poster_url: null, renditions: [] }] }] });
afterEach(() => vi.unstubAllGlobals());
it('restricts authenticated bytes to known endpoints on the configured API', () => {
  expect(protectedMediaPath(path, 'https://api.example')).toBe(path);
  for (const url of ['https://cdn.example'+path, '/v1/session', path+'?redirect=elsewhere', '/v1/media/not-an-id/source']) expect(protectedMediaPath(url, 'https://api.example')).toBeNull();
});
it('prepares embedded protected bytes once and owns blobs until release', async () => {
  const create = vi.fn(() => 'blob:http://localhost/test');
  const revoke = vi.fn();
  vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
  const apiFetch = vi.fn(async (p: string) => p.startsWith('/v1/preview/') ? Response.json(manifest()) : new Response('image'));
  const prepared = await loadPreview({ apiFetch, apiBase: 'https://api.example', hasBearer: true } as unknown as SessionClient, id, new AbortController().signal);
  expect(prepared.manifest.items[0]?.slides[0]?.source_url).toBe('blob:http://localhost/test');
  expect(apiFetch.mock.calls.map(c => c[0])).toEqual([`/v1/preview/content/${id}`, path]);
  expect(revoke).not.toHaveBeenCalled(); prepared.release(); prepared.release(); expect(revoke).toHaveBeenCalledTimes(1);
});
it('keeps CDN and cookie media public without forwarding bearer credentials', async () => {
  const value = manifest(); value.items[0]!.slides[0]!.source_url = 'https://cdn.example/image.jpg';
  const apiFetch = vi.fn(async () => Response.json(value));
  const prepared = await loadPreview({ apiFetch, apiBase: 'https://api.example', hasBearer: true } as unknown as SessionClient, id, new AbortController().signal);
  expect(apiFetch).toHaveBeenCalledTimes(1); expect(prepared.manifest.items[0]?.slides[0]?.source_url).toBe('https://cdn.example/image.jpg');
});
it('rejects invalid responses and cancelled work', async () => {
  const client = { apiFetch: async () => Response.json({ v: 2 }), apiBase: 'https://api.example' } as unknown as SessionClient;
  await expect(loadPreview(client, id, new AbortController().signal)).rejects.toThrow();
  const controller = new AbortController(); controller.abort();
  await expect(loadPreview({ ...client, apiFetch: async () => Response.json(manifest()) } as unknown as SessionClient, id, controller.signal)).rejects.toThrow();
});
it('resolves cookie media without fetching bytes', async () => {
  const apiFetch = vi.fn(async () => Response.json(manifest()));
  const prepared = await loadPreview({ apiFetch, apiBase: 'https://api.example', hasBearer: false } as unknown as SessionClient, id, new AbortController().signal);
  expect(prepared.manifest.items[0]?.slides[0]?.source_url).toBe(`https://api.example${path}`);
  expect(apiFetch).toHaveBeenCalledTimes(1);
});
it('releases partial blob allocations when later media fails', async () => {
  const revoke = vi.fn();
  vi.stubGlobal('URL', class extends URL { static createObjectURL = () => 'blob:http://localhost/partial'; static revokeObjectURL = revoke; });
  const value = manifest(); value.items[0]!.slides.push({ ...value.items[0]!.slides[0]!, source_url: path.replace('/source', '/poster') });
  const apiFetch = vi.fn(async (p: string) => p.startsWith('/v1/preview/') ? Response.json(value) : new Response('bytes', { status: p.endsWith('/poster') ? 500 : 200 }));
  await expect(loadPreview({ apiFetch, apiBase: 'https://api.example', hasBearer: true } as unknown as SessionClient, id, new AbortController().signal)).rejects.toThrow();
  expect(revoke).toHaveBeenCalledWith('blob:http://localhost/partial');
});
it.each(['image', 'video'] as const)('authenticates selected prefixed processed %s bytes and keeps unused URLs public', async kind => {
  const value: StoreManifest = manifest() as StoreManifest;
  const slide = value.items[0]!.slides[0]!;
  Object.assign(slide, { kind, status: 'processed', poster_url: `/v1/media/${id}/poster`, renditions: [
    { profile: kind === 'image' ? 'web' : '720p', url: `/v1/media/${id}/renditions/${kind === 'image' ? 'web' : '720p'}`, content_type: `${kind}/${kind === 'image' ? 'webp' : 'mp4'}`, width: 720, height: 1280 },
    { profile: '480p', url: `/v1/media/${id}/renditions/480p`, content_type: 'video/mp4', width: 480, height: 854 },
  ] });
  let next = 0;
  const revoke = vi.fn();
  vi.stubGlobal('URL', class extends URL { static createObjectURL = () => `blob:http://localhost/${++next}`; static revokeObjectURL = revoke; });
  const apiFetch = vi.fn(async (p: string) => p.startsWith('/v1/preview/') ? Response.json(value) : new Response('bytes'));
  const client = { apiFetch, apiBase: 'https://api.example/merchant', hasBearer: true } as unknown as SessionClient;
  const first = await loadPreview(client, id, new AbortController().signal);
  const result = first.manifest.items[0]!.slides[0]!;
  expect(result.renditions[0]!.url).toMatch(/^blob:/); expect(result.poster_url).toMatch(/^blob:/);
  expect(result.source_url).toBe(`https://api.example/merchant${path}`);
  expect(result.renditions[1]!.url).toBe(`https://api.example/merchant/v1/media/${id}/renditions/480p`);
  expect(apiFetch).toHaveBeenCalledTimes(3);
  value.items[0]!.title = 'Metadata update';
  const second = await loadPreview(client, id, new AbortController().signal, first);
  expect(apiFetch).toHaveBeenCalledTimes(4); expect(second.manifest.items[0]!.title).toBe('Metadata update');
  first.release(); expect(revoke).not.toHaveBeenCalled();
  second.release(); second.release(); expect(revoke).toHaveBeenCalledTimes(2);
  await loadPreview(client, id, new AbortController().signal, second);
  expect(apiFetch).toHaveBeenCalledTimes(7);
});
it.each(['javascript:alert(1)', 'https://user:secret@shop.example/x', 'not a URL'])('rejects unsafe CTA %s', async cta => {
  const value = manifest(); value.items[0]!.cta_url = cta;
  const client = { apiFetch: async () => Response.json(value), apiBase: 'https://api.example' } as unknown as SessionClient;
  await expect(loadPreview(client, id, new AbortController().signal)).rejects.toThrow();
});
it('canonicalizes valid whitespace in CTA paths before the child validates it', async () => {
  const value = manifest(); value.items[0]!.cta_url = 'https://shop.example/a b?q=hello world';
  const client = { apiFetch: async () => Response.json(value), apiBase: 'https://api.example' } as unknown as SessionClient;
  expect((await loadPreview(client, id, new AbortController().signal)).manifest.items[0]!.cta_url).toBe('https://shop.example/a%20b?q=hello%20world');
});
it('a failed refresh releases borrowed ownership without revoking the displayed snapshot', async () => {
  const revoke = vi.fn();
  vi.stubGlobal('URL', class extends URL { static createObjectURL = () => 'blob:http://localhost/current'; static revokeObjectURL = revoke; });
  const value = manifest();
  const apiFetch = vi.fn(async (p: string) => p.startsWith('/v1/preview/') ? Response.json(value) : new Response('bytes', { status: p.endsWith('/poster') ? 500 : 200 }));
  const client = { apiFetch, apiBase: 'https://api.example', hasBearer: true } as unknown as SessionClient;
  const first = await loadPreview(client, id, new AbortController().signal);
  value.items[0]!.slides.push({ ...value.items[0]!.slides[0]!, source_url: path.replace('/source', '/poster') });
  await expect(loadPreview(client, id, new AbortController().signal, first)).rejects.toThrow();
  expect(revoke).not.toHaveBeenCalled();
  first.release(); expect(revoke).toHaveBeenCalledOnce();
});
