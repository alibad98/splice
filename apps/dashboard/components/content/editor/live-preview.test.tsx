// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ContentItem, StoreManifest } from '@slips/contracts';
import { I18nProvider } from '../../../i18n/provider';
import { getMessages } from '../../../i18n/messages';
import { LivePreviewPanel } from './LivePreviewPanel';
import { loadPreview } from '../../../lib/api/preview';
import { item, manifestOf, id } from '../../../e2e/fixture';
vi.mock('../../../lib/api/preview', () => ({ loadPreview: vi.fn() }));
const client = {};
vi.mock('../../session/SessionProvider', () => ({ useSession: () => ({ client }) }));
const saved = { id: 'saved' } as ContentItem;
const manifest: StoreManifest = { v: 1, store_id: 'store', placements: [], items: [] };
function tree(item: ContentItem | null = saved, locale: 'en' | 'ar' = 'en') { return <I18nProvider locale={locale} messages={getMessages(locale)}><LivePreviewPanel saved={item} /></I18nProvider>; }
function ready(over: Partial<MessageEventInit> = {}) { const frame = screen.getByTitle('Saved content preview') as HTMLIFrameElement; act(() => window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, source: frame.contentWindow, data: { type: 'slips.preview.ready', v: 1 }, ...over }))); return frame; }
beforeEach(() => { vi.useFakeTimers(); vi.mocked(loadPreview).mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('does not fetch before the first save and keeps its safety note', () => { render(tree(null)); expect(loadPreview).not.toHaveBeenCalled(); expect(screen.getByText('Save your content to start the preview.')).toBeTruthy(); expect(screen.getByText('Preview: no real cart or analytics')).toBeTruthy(); });
it('waits 150ms for skeleton, validates messages and updates the same iframe', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof loadPreview>>) => void;
  vi.mocked(loadPreview).mockReturnValue(new Promise(r => { resolve = r; }));
  const view = render(tree()); const frame = screen.getByTitle('Saved content preview') as HTMLIFrameElement;
  const post = vi.spyOn(frame.contentWindow!, 'postMessage');
  expect(screen.queryByTestId('preview-skeleton')).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(150)); expect(screen.getByTestId('preview-skeleton')).toBeTruthy();
  ready({ origin: 'https://untrusted.example' }); ready({ data: { type: 'slips.preview.ready', v: 2 } }); ready({ source: window });
  await act(async () => resolve({ manifest, release: vi.fn() })); expect(post).not.toHaveBeenCalled();
  ready(); expect(post).toHaveBeenCalledWith(expect.objectContaining({ locale: 'en', manifest }), window.location.origin);
  view.rerender(tree(saved, 'ar')); expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ locale: 'ar' }), window.location.origin);
  expect(screen.getByTitle(getMessages('ar').content.editor.preview.title)).toBe(frame);
});
it('ignores superseded results, releases resources and retries without a save', async () => {
  const oldRelease = vi.fn(), release = vi.fn(); let resolve!: (value: Awaited<ReturnType<typeof loadPreview>>) => void;
  vi.mocked(loadPreview).mockReturnValueOnce(new Promise(r => { resolve = r; })).mockRejectedValueOnce(new Error('network')).mockResolvedValue({ manifest, release });
  const view = render(tree()); ready(); view.rerender(tree({ ...saved, title: 'new' }));
  await act(async () => {}); expect(screen.getByText("Preview didn't load. Try again.")).toBeTruthy();
  await act(async () => resolve({ manifest, release: oldRelease })); expect(oldRelease).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await act(async () => {});
  expect(screen.queryByText("Preview didn't load. Try again.")).toBeNull(); expect(loadPreview).toHaveBeenCalledTimes(3);
  view.unmount(); expect(release).toHaveBeenCalledOnce();
});
it('times out startup and allows recovery', async () => {
  vi.mocked(loadPreview).mockResolvedValue({ manifest, release: vi.fn() }); render(tree());
  await act(() => vi.advanceTimersByTimeAsync(10_000)); expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await act(async () => {}); ready();
  expect(screen.queryByText("Preview didn't load. Try again.")).toBeNull();
  expect(screen.queryByTestId('preview-skeleton')).toBeNull();
});
it.each(['product', 'slide order', 'processing'] as const)('refreshes an observed saved %s change and transfers media ownership', async change => {
  const firstRelease = vi.fn(), nextRelease = vi.fn();
  const slide = { id, media_asset_id: id, kind: 'image' as const, alt_text: 'First slide', status: 'scanned' as const, failure_reason: null, source_url: '/first', poster_url: null };
  const baseline: ContentItem = { ...item, slides: [slide, { ...slide, id: id.replace(/1$/, '2'), alt_text: 'Second slide' }] };
  const snapshot: ContentItem = {
    ...baseline,
    ...(change === 'product' ? { product: { id, name: 'Saved linked product', image_url: null, price_minor: 1200, sale_price_minor: null, currency: 'SAR', availability: 'available', has_required_options: false, deleted: false } } : {}),
    slides: change === 'slide order' ? [...baseline.slides].reverse() : change === 'processing' ? baseline.slides.map(s => ({ ...s, status: 'processed', poster_url: '/new-poster' })) : baseline.slides,
  };
  const toManifest = (value: ContentItem): StoreManifest => ({ ...manifestOf(value), v: 1, items: [{ ...manifestOf(value).items[0]!, slides: value.slides.map(s => ({ ...s, renditions: [] })) }] });
  const first = { manifest: toManifest(baseline), release: firstRelease };
  const nextManifest = toManifest(snapshot);
  const next = { manifest: nextManifest, release: nextRelease };
  vi.mocked(loadPreview).mockResolvedValueOnce(first).mockResolvedValueOnce(next);
  const view = render(tree(baseline)); const frame = ready(); const post = vi.spyOn(frame.contentWindow!, 'postMessage');
  await act(async () => {});
  // Re-rendering without a new saved snapshot represents unsaved/failed form work.
  view.rerender(tree(baseline)); expect(loadPreview).toHaveBeenCalledTimes(1);
  view.rerender(tree(snapshot)); await act(async () => {});
  expect(loadPreview).toHaveBeenLastCalledWith(client, baseline.id, expect.any(AbortSignal), first);
  expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ manifest: nextManifest }), window.location.origin);
  expect(firstRelease).toHaveBeenCalledOnce(); expect(nextRelease).not.toHaveBeenCalled();
  expect(screen.getByTitle('Saved content preview')).toBe(frame);
  view.unmount(); expect(nextRelease).toHaveBeenCalledOnce();
});
