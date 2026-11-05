// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ContentItem, ContentSlide, MediaAsset } from '@slips/contracts';
import { DialogHost, dialog, toast, Toaster } from '@slips/ui';
import { I18nProvider } from '../../../i18n/provider';
import { getMessages } from '../../../i18n/messages';
import { ContentEditor } from './ContentEditor';
import { mediaMetaReader, type MediaMeta } from './media-precheck';
import { AUTOSAVE_DELAY_MS } from './use-autosave';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

type Call = { method: string; path: string; body: unknown };
type Handler = (call: Call) => Response | Promise<Response>;
let calls: Call[] = [];
let handler: Handler;
let session: { client: { apiFetch: (path: string, init?: RequestInit) => Promise<Response> }; state: Record<string, unknown> } | null = null;
vi.mock('../../session/SessionProvider', () => ({ useSession: () => session }));

const ID = '019a473a-0000-7000-8000-000000000001';
const assetId = (n: number) => `019a473a-0000-7000-8000-0000000001${String(n).padStart(2, '0')}`;
const slideId = (n: number) => `019a473a-0000-7000-8000-0000000002${String(n).padStart(2, '0')}`;
const MB = 1024 * 1024;

const item = (over: Partial<ContentItem> = {}): ContentItem => ({
  v: 1,
  id: ID,
  title: 'Autumn perfumes',
  format: 'story',
  cta_label: 'Add to cart',
  cta_action: 'add_to_cart',
  cta_url: null,
  cta_style: null,
  status: 'draft',
  archived_from: null,
  reactivate_to: null,
  auto_publish: false,
  first_published_at: null,
  product: null,
  slides: [],
  created_at: '2026-11-05T10:00:00.000Z',
  updated_at: '2026-11-05T10:00:00.000Z',
  ...over,
});
const savedSlide = (n: number, over: Partial<ContentSlide> = {}): ContentSlide => ({
  id: slideId(n),
  media_asset_id: assetId(n),
  kind: 'image',
  alt_text: `Photo ${n}`,
  status: 'processed',
  failure_reason: null,
  ...over,
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** Media assets the fake API knows: id -> asset. */
let assets: Map<string, MediaAsset>;
let assetStatusOnGet: MediaAsset['status'] = 'uploaded';
let grantStatus: number;
let grants = 0;

/** Fake API: media uploads and content echo (slides come back with the asset's kind and status). */
function api(start: ContentItem): Handler {
  let current = start;
  let n = 0;
  return ({ method, path, body }) => {
    if (method === 'POST' && path === '/v1/media/uploads') {
      grants += 1;
      if (grantStatus !== 201) return json({ type: 'media-upload-rate-limited', status: grantStatus, code: 'media_upload_rate_limited' }, grantStatus, { 'retry-after': '90' });
      const b = body as { kind: 'image' | 'video'; content_type: string; size_bytes: number };
      const upload = `019a473a-0000-7000-8000-0000000003${String(grants).padStart(2, '0')}`;
      assets.set(assetId(grants), {
        v: 1,
        id: assetId(grants),
        kind: b.kind,
        content_type: b.content_type,
        size_bytes: b.size_bytes,
        status: 'uploaded',
        failure_reason: null,
        created_at: '2026-11-05T10:00:00.000Z',
        updated_at: '2026-11-05T10:00:00.000Z',
      });
      return json({ v: 1, upload_id: upload, url: `https://storage.test/put/${grants}`, method: 'PUT', headers: { 'content-type': b.content_type, 'x-amz-checksum-sha256': 'abc=' }, expires_at: '2026-11-05T10:15:00.000Z' }, 201);
    }
    const complete = /^\/v1\/media\/uploads\/[^/]+-0000000003(\d\d)\/complete$/.exec(path);
    if (method === 'POST' && complete) return json(assets.get(assetId(Number(complete[1])))!);
    const get = /^\/v1\/media\/([^/]+)$/.exec(path);
    if (method === 'GET' && get) {
      const a = assets.get(get[1]!)!;
      const status = assetStatusOnGet;
      return json({ ...a, status, failure_reason: status === 'failed' ? 'type_mismatch' : null });
    }
    if (method === 'PATCH' || method === 'POST') {
      const b = body as Record<string, unknown> & { slides?: Array<{ media_asset_id: string; alt_text: string | null }> };
      const slides = b.slides
        ? b.slides.map((s, i) => ({ id: slideId(50 + i), media_asset_id: s.media_asset_id, kind: assets.get(s.media_asset_id)?.kind ?? 'image', alt_text: s.alt_text, status: 'uploaded' as const, failure_reason: null }))
        : current.slides;
      current = { ...current, ...b, slides, updated_at: `2026-11-05T10:01:0${++n}.000Z` } as ContentItem;
      return json(current, method === 'POST' ? 201 : 200);
    }
    return json(current);
  };
}

/** XMLHttpRequest stand-in: records PUTs; tests drive progress and the answer. */
class FakeXhr {
  static all: FakeXhr[] = [];
  method = '';
  url = '';
  headers: Record<string, string> = {};
  status = 0;
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  aborted = false;
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send() {
    FakeXhr.all.push(this);
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  progress(percent: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded: percent, total: 100 });
  }
  finish(status = 200) {
    this.status = status;
    this.onload?.();
  }
}
const open = () => FakeXhr.all.filter((x) => x.status === 0 && !x.aborted);

/** Dimensions per file name; video entries carry a duration. */
const META: Record<string, MediaMeta | null> = {
  'a.jpg': { width: 1200, height: 1600 },
  'b.jpg': { width: 1080, height: 1920 },
  'c.mp4': { width: 1080, height: 1920, duration: 30 },
  'd.jpg': { width: 1500, height: 2000 },
  'small.jpg': { width: 800, height: 800 },
  'long.mp4': { width: 1080, height: 1920, duration: 95 },
};
const file = (name: string, type: string, size = 1000) => {
  const f = new File(['x'.repeat(16)], name, { type });
  if (size !== 1000) Object.defineProperty(f, 'size', { value: size });
  return f;
};

let client: QueryClient;
function setup(start?: ContentItem) {
  handler = api(start ?? item());
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  session = {
    client: {
      apiFetch: async (path, init = {}) => {
        const call = { method: init.method ?? 'GET', path, body: init.body ? JSON.parse(String(init.body)) : undefined };
        calls.push(call);
        return handler(call);
      },
    },
    state: { status: 'signed-in', mode: 'embedded', storeName: 'Demo', storeDomains: ['demo.salla.sa'], connection: { state: 'connected', storeName: 'Demo' } },
  };
  return render(tree(start));
}

const tree = (current?: ContentItem) => (
  <I18nProvider locale="en" messages={getMessages('en')}>
    <QueryClientProvider client={client}>
      <ContentEditor item={current} />
      <Toaster label="Notifications" toastLabel="Notification" closeLabel="Close" />
      <DialogHost />
    </QueryClientProvider>
  </I18nProvider>
);

async function until(check: () => void, steps = 150) {
  for (let i = 0; ; i++) {
    try {
      check();
      return;
    } catch (err) {
      if (i >= steps) throw err;
      await act(() => vi.advanceTimersByTimeAsync(20));
    }
  }
}
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const writes = (path = `/v1/content/${ID}`) => calls.filter((c) => c.method === 'PATCH' && c.path === path);
const zone = () => document.querySelector('[data-slot="drop-zone"]') as HTMLElement;
const drop = (files: File[]) => act(async () => void fireEvent.drop(zone(), { dataTransfer: { files, types: ['Files'] } }));
const rows = () => Array.from(document.querySelectorAll<HTMLLIElement>('[data-slide-key]'));
const stateOf = (i: number) => rows()[i]!.querySelector('[data-slide-state]')!.textContent;
const announcer = () => document.querySelector('[data-slot="slides-announcer"]')!.textContent;
const altInput = (n: number) => screen.getByRole('textbox', { name: `Alt text for slide ${n}` }) as HTMLInputElement;

beforeAll(() => {
  Object.assign(Element.prototype, { scrollIntoView: () => undefined });
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  calls = [];
  assets = new Map();
  assetStatusOnGet = 'uploaded';
  grantStatus = 201;
  grants = 0;
  FakeXhr.all = [];
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  vi.spyOn(mediaMetaReader, 'read').mockImplementation(async (f) => META[(f as File).name] ?? null);
  if (!URL.createObjectURL) Object.assign(URL, { createObjectURL: () => '', revokeObjectURL: () => undefined });
  vi.spyOn(URL, 'createObjectURL').mockImplementation((f) => `blob:${(f as File).name}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  window.history.replaceState(null, '', `/content/${ID}`);
});

afterEach(() => {
  cleanup();
  act(() => toast.clear());
  act(() => dialog.clear());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  session = null;
});

describe('Slides card (Story 3.6): uploads', () => {
  it('refuses files that break a limit (naming file and limit), uploads at most 3 at once in drop order with progress, and saves the slides in drop order once image alt text is given', async () => {
    setup(item());
    expect(screen.getByRole('button', { name: 'Choose files' })).toBeTruthy();
    await drop([
      file('a.jpg', 'image/jpeg'),
      file('big.png', 'image/png', 12 * MB),
      file('b.jpg', 'image/jpeg'),
      file('c.mp4', 'video/mp4'),
      file('small.jpg', 'image/jpeg'),
      file('long.mp4', 'video/mp4'),
      file('d.jpg', 'image/jpeg'),
    ]);
    await until(() => expect(rows()).toHaveLength(4));
    const alert = screen.getByText("Some files weren't added").closest('[data-slot="alert"]') ?? document.body;
    expect(alert.textContent).toContain('big.png: images can be up to 10 MB');
    expect(alert.textContent).toContain('small.jpg: the shorter side of an image must be at least 1080 px');
    expect(alert.textContent).toContain('long.mp4: videos can be up to 90 seconds');

    // Three PUTs at once, in drop order; the fourth waits.
    await until(() => expect(open()).toHaveLength(3));
    expect(FakeXhr.all.map((x) => x.url)).toEqual(['https://storage.test/put/1', 'https://storage.test/put/2', 'https://storage.test/put/3']);
    expect(FakeXhr.all[0]!.headers).toEqual({ 'content-type': 'image/jpeg', 'x-amz-checksum-sha256': 'abc=' });
    expect(stateOf(3)).toBe('Waiting to upload');
    const grantBodies = calls.filter((c) => c.path === '/v1/media/uploads').map((c) => c.body as { kind: string; sha256: string });
    expect(grantBodies.map((b) => b.kind)).toEqual(['image', 'image', 'video']);
    expect(grantBodies[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);

    act(() => FakeXhr.all[0]!.progress(50));
    expect(stateOf(0)).toBe('Uploading 50%');
    expect(rows()[0]!.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('50');

    // The first finishes: completed, Processing, and its alt field takes focus; the fourth starts.
    await act(async () => FakeXhr.all[0]!.finish());
    await until(() => expect(stateOf(0)).toBe('Processing'));
    expect(document.activeElement).toBe(altInput(1));
    expect(altInput(1).id).toBe(`slide-alt-${assetId(1)}`);
    await until(() => expect(open()).toHaveLength(3));
    expect(FakeXhr.all[3]!.url).toBe('https://storage.test/put/4');

    for (const x of FakeXhr.all.slice(1)) await act(async () => x.finish());
    await until(() => expect(rows().map((_, i) => stateOf(i))).toEqual(['Processing', 'Processing', 'Processing', 'Processing']));

    // Image alt text is required before any save, Drafts included: nothing is sent yet.
    await advance(AUTOSAVE_DELAY_MS * 2);
    expect(writes()).toEqual([]);
    fireEvent.change(altInput(1), { target: { value: 'Amber bottle' } });
    fireEvent.change(altInput(2), { target: { value: 'Gift box' } });
    fireEvent.change(altInput(4), { target: { value: 'Oud set' } });
    await until(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.body).toEqual({
      slides: [
        { media_asset_id: assetId(1), alt_text: 'Amber bottle' },
        { media_asset_id: assetId(2), alt_text: 'Gift box' },
        { media_asset_id: assetId(3), alt_text: null },
        { media_asset_id: assetId(4), alt_text: 'Oud set' },
      ],
    });
  });

  it('a throttled upload shows the wait and Retry uploads the held file again', async () => {
    grantStatus = 429;
    setup(item());
    await drop([file('a.jpg', 'image/jpeg')]);
    await until(() => expect(stateOf(0)).toBe('Failed'));
    expect(rows()[0]!.textContent).toContain('Too many uploads right now. Try again in 2 min.');
    grantStatus = 201;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await until(() => expect(open()).toHaveLength(1));
    expect(grants).toBe(2);
    await act(async () => FakeXhr.all[0]!.finish());
    await until(() => expect(stateOf(0)).toBe('Processing'));
  });

  it('an unsaved asset that fails inspection stays a local Failed row with Retry and is never saved', async () => {
    assetStatusOnGet = 'failed';
    setup(item());
    await drop([file('c.mp4', 'video/mp4')]);
    await until(() => expect(open()).toHaveLength(1));
    await act(async () => FakeXhr.all[0]!.finish());
    await until(() => expect(stateOf(0)).toBe('Failed'));
    expect(rows()[0]!.textContent).toContain("The file isn't the type its name says.");
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    await advance(AUTOSAVE_DELAY_MS * 3);
    expect(writes()).toEqual([]);
  });

  it('a newer item version from a refetch keeps the rows still uploading after its slides', async () => {
    const view = setup(item({ status: 'published', slides: [savedSlide(1)] }));
    await drop([file('c.mp4', 'video/mp4')]);
    await until(() => expect(open()).toHaveLength(1));
    expect(rows()).toHaveLength(2);
    view.rerender(tree(item({ status: 'published', title: 'Changed elsewhere', slides: [savedSlide(1)], updated_at: '2026-11-05T11:00:00.000Z' })));
    await until(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Changed elsewhere'));
    expect(rows()).toHaveLength(2);
    await act(async () => FakeXhr.all[0]!.finish());
    await until(() => expect(stateOf(1)).toBe('Processing'));
  });

  it('a new item: files dropped before the title upload at once and their slides go with the first create', async () => {
    window.history.replaceState(null, '', '/content/new');
    setup();
    await drop([file('c.mp4', 'video/mp4')]);
    await until(() => expect(open()).toHaveLength(1));
    await act(async () => FakeXhr.all[0]!.finish());
    await until(() => expect(stateOf(0)).toBe('Processing'));
    await advance(AUTOSAVE_DELAY_MS * 2);
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/v1/content')).toEqual([]);
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'New drop' } });
    await advance(AUTOSAVE_DELAY_MS + 50);
    await until(() => expect(calls.filter((c) => c.method === 'POST' && c.path === '/v1/content')).toHaveLength(1));
    const created = calls.find((c) => c.method === 'POST' && c.path === '/v1/content')!.body as { title: string; slides: unknown };
    expect(created.title).toBe('New drop');
    expect(created.slides).toEqual([{ media_asset_id: assetId(1), alt_text: null }]);
  });

  it('refuses files past 10 slides and says why; the zone is disabled when full', async () => {
    setup(item({ slides: Array.from({ length: 9 }, (_, i) => savedSlide(i + 1)) }));
    await drop([file('a.jpg', 'image/jpeg'), file('b.jpg', 'image/jpeg')]);
    await until(() => expect(rows()).toHaveLength(10));
    expect(screen.getByText('b.jpg: an item can have up to 10 slides')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Choose files' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('This item has 10 slides, the most it can have. Remove one to add another.')).toBeTruthy();
  });
});

describe('Slides card (Story 3.6): order, alt text and states', () => {
  it('Move later/earlier reorders, announces "Slide n of m" and keeps focus on the moved slide (the other button at an end); drag reorders too', async () => {
    setup(item({ slides: [savedSlide(1), savedSlide(2), savedSlide(3, { kind: 'video', alt_text: null })] }));
    const keys = () => rows().map((r) => r.dataset.slideKey);
    expect(keys()).toEqual([slideId(1), slideId(2), slideId(3)]);
    expect((screen.getByRole('button', { name: 'Move slide 1 earlier' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Move slide 3 later' }) as HTMLButtonElement).disabled).toBe(true);

    const later = screen.getByRole('button', { name: 'Move slide 1 later' });
    later.focus();
    fireEvent.click(later);
    expect(keys()).toEqual([slideId(2), slideId(1), slideId(3)]);
    await until(() => expect(announcer()).toBe('Slide 2 of 3'));
    expect(document.activeElement?.closest('li')?.dataset.slideKey).toBe(slideId(1));
    expect(document.activeElement?.getAttribute('data-move')).toBe('later');

    // Moving it to the end disables Move later, so focus goes to Move earlier on the same slide.
    fireEvent.click(document.activeElement as HTMLElement);
    expect(keys()).toEqual([slideId(2), slideId(3), slideId(1)]);
    await until(() => expect(announcer()).toBe('Slide 3 of 3'));
    expect(document.activeElement?.closest('li')?.dataset.slideKey).toBe(slideId(1));
    expect(document.activeElement?.getAttribute('data-move')).toBe('earlier');

    // Drag the last slide onto the first.
    const [first, , last] = rows();
    const dt = { setData: vi.fn(), effectAllowed: '', dropEffect: '', types: ['text/plain'] };
    fireEvent.dragStart(last!, { dataTransfer: dt });
    fireEvent.dragOver(first!, { dataTransfer: dt });
    fireEvent.drop(first!, { dataTransfer: dt });
    expect(keys()).toEqual([slideId(1), slideId(2), slideId(3)]);
    await until(() => expect(announcer()).toBe('Slide 1 of 3'));

    // A Draft autosaves the final order.
    fireEvent.click(screen.getByRole('button', { name: 'Move slide 2 earlier' }));
    await until(() => expect(writes().length).toBeGreaterThan(0));
    expect((writes().at(-1)!.body as { slides: Array<{ media_asset_id: string }> }).slides.map((s) => s.media_asset_id)).toEqual([assetId(2), assetId(1), assetId(3)]);
  });

  it('remove takes the slide out, announces it and the next save leaves it out', async () => {
    setup(item({ status: 'published', slides: [savedSlide(1), savedSlide(2)] }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove slide 1' }));
    expect(rows().map((r) => r.dataset.slideKey)).toEqual([slideId(2)]);
    await until(() => expect(announcer()).toBe('Slide removed'));
    expect(document.activeElement?.getAttribute('data-remove')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await until(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.body).toEqual({ slides: [{ media_asset_id: assetId(2), alt_text: 'Photo 2' }] });
  });

  it('an image slide without alt text blocks "Save changes": inline error and a summary link to the field', async () => {
    setup(item({ status: 'published', slides: [savedSlide(1, { alt_text: null })] }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Autumn oud' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await until(() => expect(screen.getByRole('link', { name: 'Describe the image in slide 1' })).toBeTruthy());
    expect(screen.getByRole('link', { name: 'Describe the image in slide 1' }).getAttribute('href')).toBe(`#slide-alt-${assetId(1)}`);
    expect(altInput(1).getAttribute('aria-invalid')).toBe('true');
    expect(writes()).toEqual([]);
    fireEvent.change(altInput(1), { target: { value: 'Amber bottle' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await until(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.body).toEqual({ title: 'Autumn oud', slides: [{ media_asset_id: assetId(1), alt_text: 'Amber bottle' }] });
  });

  it('after a reload: kind icon thumbs, Processing / Failed with the friendly reason (no file to retry); archived items are read-only', async () => {
    const { unmount } = setup(
      item({
        slides: [savedSlide(1, { status: 'scanned' }), savedSlide(2, { kind: 'video', alt_text: null, status: 'failed', failure_reason: 'type_mismatch' })],
      }),
    );
    expect(stateOf(0)).toBe('Processing');
    expect(stateOf(1)).toBe('Failed');
    expect(rows()[1]!.textContent).toContain("The file isn't the type its name says. Add the file again to retry.");
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(rows()[0]!.querySelector('[data-icon="image"]')).not.toBeNull();
    expect(rows()[1]!.querySelector('[data-icon="video"]')).not.toBeNull();
    unmount();

    setup(item({ status: 'archived', archived_from: 'draft', slides: [savedSlide(1), savedSlide(2)] }));
    expect((screen.getByRole('button', { name: 'Choose files' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Move slide 1 later' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Remove slide 2' }) as HTMLButtonElement).disabled).toBe(true);
    expect(rows()[0]!.getAttribute('draggable')).toBe('false');
  });
});
