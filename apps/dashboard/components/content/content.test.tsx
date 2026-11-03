// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NuqsTestingAdapter, type OnUrlUpdateFunction } from 'nuqs/adapters/testing';
import { createSerializer } from 'nuqs';
import { CONTENT_STATUSES, type ContentItem, type ContentListQuery, type ContentListResponse, type ContentStatus } from '@slips/contracts';
import { DialogHost, dialog, toast } from '@slips/ui';
import { I18nProvider } from '../../i18n/provider';
import { getMessages } from '../../i18n/messages';
import type { Locale } from '../../i18n/config';
import { queryKeys } from '../../lib/api/query-keys';
import { contentPath } from '../../lib/api/content';
import { ContentView } from './ContentView';
import { contentParams, toContentQuery } from './url-state';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }) }));

const item = (over: Partial<ContentItem> = {}): ContentItem => ({
  v: 1,
  id: crypto.randomUUID(),
  title: 'Summer sale',
  format: 'story',
  cta_label: 'Buy',
  cta_action: 'add_to_cart',
  cta_url: null,
  cta_style: null,
  status: 'draft',
  archived_from: null,
  reactivate_to: null,
  auto_publish: false,
  first_published_at: null,
  created_at: '2026-11-01T10:00:00.000Z',
  updated_at: '2026-11-01T10:00:00.000Z',
  ...over,
});
const COUNTS = { all: 8, published: 1, scheduled: 1, drafts: 3 };
const page = (items: ContentItem[], over: Partial<ContentListResponse> = {}): ContentListResponse => ({ v: 1, items, total: items.length, page: 1, page_size: 10, counts: COUNTS, ...over });
const DEFAULT: ContentListQuery = { tab: 'all', sort: '-updated', page: 1, page_size: 10 };

type FakeClient = { apiFetch: (path: string, init?: RequestInit) => Promise<Response> };
let session: { client: FakeClient; state: { status: 'signed-in'; connection: { state: 'connected' } } } | null = null;
vi.mock('../session/SessionProvider', () => ({ useSession: () => session }));

interface Setup {
  locale?: Locale;
  search?: string;
  lists?: Array<[ContentListQuery, ContentListResponse | Error]>;
  onUrlUpdate?: OnUrlUpdateFunction;
}

function setup({ locale = 'en', search = '', lists = [], onUrlUpdate }: Setup = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  for (const [query, data] of lists) {
    if (data instanceof Error) client.getQueryCache().build(client, { queryKey: queryKeys.content.list(query) }).setState({ status: 'error', error: data, fetchStatus: 'idle' });
    else client.setQueryData(queryKeys.content.list(query), data);
  }
  return render(
    <I18nProvider locale={locale} messages={getMessages(locale)}>
      <QueryClientProvider client={client}>
        <NuqsTestingAdapter hasMemory searchParams={search} {...(onUrlUpdate ? { onUrlUpdate } : {})}>
          <ContentView />
          <DialogHost />
        </NuqsTestingAdapter>
      </QueryClientProvider>
    </I18nProvider>,
  );
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeAll(() => {
  // jsdom lacks the pointer-capture and scroll APIs Radix Select/DropdownMenu use.
  Object.assign(Element.prototype, {
    hasPointerCapture: () => false,
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
    scrollIntoView: () => undefined,
  });
});

afterEach(() => {
  cleanup();
  act(() => toast.clear());
  act(() => dialog.clear());
  session = null;
  push.mockReset();
});

const openRowMenu = async (title: string) => {
  const trigger = screen.getByRole('table').querySelector<HTMLButtonElement>(`button[aria-label="Actions for ${title}"]`)!;
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
  return screen.findByRole('menu');
};

describe('Videos & Stories page', () => {
  it('renders thumb, title (dir=auto), format, "—" placement, chip, "—" views/clicks and the tab counts', () => {
    const a = item({ title: 'Summer sale', format: 'reel', status: 'published' });
    setup({ lists: [[DEFAULT, page([a], { total: 8 })]] });
    const table = screen.getByRole('table', { name: 'Videos & Stories' });
    expect(table.closest('[data-slot="card"]')).not.toBeNull();
    for (const h of ['Title', 'Format', 'Placement', 'Status', 'Views', 'Clicks']) expect(table.textContent).toContain(h);
    const row = table.querySelector(`tr[data-row-id="${a.id}"]`)!;
    expect(row.querySelector('[data-testid="content-thumb"]')?.className).toContain('aspect-9/16');
    const title = within(row as HTMLElement).getByRole('link', { name: 'Summer sale' });
    expect(title.getAttribute('dir')).toBe('auto');
    expect(title.getAttribute('href')).toBe(`/content/${a.id}`);
    const cells = [...row.querySelectorAll('td')].map((c) => c.textContent);
    expect(cells).toEqual(['', 'Summer sale', 'Reel', '—', 'Published', '—', '—', '']);
    for (const [tab, n] of Object.entries(COUNTS)) expect(screen.getByTestId(`count-${tab}`).textContent).toBe(String(n));
    expect(screen.getByRole('tab', { name: /All/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('renders Arabic labels', () => {
    setup({ locale: 'ar', lists: [[DEFAULT, page([item({ status: 'processing' })])]] });
    const table = screen.getByRole('table', { name: 'الفيديوهات والستوريز' });
    expect(table.textContent).toContain('قيد المعالجة');
    expect(table.textContent).toContain('ستوري');
    expect(screen.getByRole('tab', { name: /مسودات/ })).toBeTruthy();
  });

  it('one chip per status per DESIGN.md: processing pulses (static under reduced motion), ended/archived outline without dot, archived icon, failed row tint', () => {
    const items = CONTENT_STATUSES.map((status) => item({ status, title: `Item ${status}` }));
    setup({ lists: [[DEFAULT, page(items)]] });
    const table = screen.getByRole('table');
    const chipOf = (s: ContentStatus) => table.querySelector(`[data-status="${s}"]`)!.closest('[data-slot="status-chip"]')!;
    const labels = getMessages('en').content.statuses;
    for (const s of CONTENT_STATUSES) expect(chipOf(s).textContent).toBe(labels[s]);
    expect(chipOf('draft').getAttribute('data-tone')).toBe('neutral');
    expect(chipOf('processing').getAttribute('data-tone')).toBe('info');
    expect(chipOf('processing').innerHTML).toContain('animate-ping');
    expect(chipOf('processing').innerHTML).toContain('motion-reduce:animate-none');
    expect(chipOf('failed').getAttribute('data-tone')).toBe('danger');
    expect(chipOf('scheduled').getAttribute('data-tone')).toBe('info');
    expect(chipOf('scheduled').innerHTML).not.toContain('animate-ping');
    expect(chipOf('published').getAttribute('data-tone')).toBe('success');
    expect(chipOf('deactivated').getAttribute('data-tone')).toBe('warning');
    for (const s of ['ended', 'archived'] as const) {
      expect(chipOf(s).getAttribute('data-variant')).toBe('outline');
      expect(chipOf(s).innerHTML).not.toContain('rounded-full');
    }
    expect(chipOf('archived').querySelector('[data-icon="archive"]')).not.toBeNull();
    expect(chipOf('ended').querySelector('[data-icon]')).toBeNull();
    const failedRow = table.querySelector(`tr[data-row-id="${items[2]!.id}"]`)!;
    expect(failedRow.className).toContain('bg-destructive/6');
    expect(table.querySelector(`tr[data-row-id="${items[0]!.id}"]`)!.className).not.toContain('bg-destructive/6');
  });

  it('clicking a row, or Enter on the focused row, opens /content/{id}', () => {
    const a = item({ title: 'First' });
    const b = item({ title: 'Second' });
    setup({ lists: [[DEFAULT, page([a, b])]] });
    fireEvent.click(screen.getByRole('table').querySelector(`tr[data-row-id="${a.id}"] td:nth-child(3)`)!);
    expect(push).toHaveBeenLastCalledWith(`/content/${a.id}`);
    const rowB = screen.getByRole('table').querySelector<HTMLTableRowElement>(`tr[data-row-id="${b.id}"]`)!;
    expect(rowB.tabIndex).toBe(0);
    rowB.focus();
    fireEvent.keyDown(rowB, { key: 'Enter' });
    expect(push).toHaveBeenLastCalledWith(`/content/${b.id}`);
    expect(push).toHaveBeenCalledTimes(2);
  });

  it('no content at all: one coach sentence and one amber "Create your first story" link to /content/new', () => {
    setup({ lists: [[DEFAULT, page([], { counts: { all: 0, published: 0, scheduled: 0, drafts: 0 } })]] });
    const empty = screen.getByTestId('content-empty');
    expect(empty.textContent).toContain('Nothing here yet. Start with a short Story for your best seller.');
    const links = within(empty).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]!.textContent).toBe('Create your first story');
    expect(links[0]!.getAttribute('href')).toBe('/content/new');
    expect(links[0]!.className).toContain('bg-accent');
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('empty tab: "No Scheduled items" and "Show all" goes to tab all with q cleared', async () => {
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    const query: ContentListQuery = { tab: 'scheduled', q: 'eid', sort: '-updated', page: 1, page_size: 10 };
    setup({ search: '?tab=scheduled&q=eid', lists: [[query, page([])]], onUrlUpdate });
    expect(screen.getByTestId('content-filtered-empty').textContent).toContain('No Scheduled items');
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect(onUrlUpdate.mock.lastCall![0].queryString).toBe('');
  });

  it('empty search on All: the filtered-empty sentence with "Show all"', () => {
    setup({ search: '?q=zzz', lists: [[{ ...DEFAULT, q: 'zzz' }, page([])]] });
    expect(screen.getByTestId('content-filtered-empty').textContent).toContain('Nothing matches your search.');
    expect(screen.getByRole('button', { name: 'Show all' })).toBeTruthy();
  });

  it('reads tab, q, sort, page and size from the URL', () => {
    const query: ContentListQuery = { tab: 'drafts', q: 'sale', sort: 'title', page: 2, page_size: 25 };
    setup({ search: '?tab=drafts&q=sale&sort=title&page=2&size=25', lists: [[query, page([item()], { total: 26, page: 2, page_size: 25 })]] });
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('sale');
    expect(screen.getByRole('tab', { name: /Drafts/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('columnheader', { name: /Title/ }).getAttribute('aria-sort')).toBe('ascending');
    expect(screen.getByText('26-26 of 26')).toBeTruthy();
  });

  it('changing tab pushes ?tab= and resets the page; sorting by title pushes', async () => {
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    setup({ search: '?page=2', lists: [[{ ...DEFAULT, page: 2 }, page([item()], { total: 20, page: 2 })]], onUrlUpdate });
    const drafts = screen.getByRole('tab', { name: /Drafts/ });
    fireEvent.mouseDown(drafts);
    fireEvent.click(drafts);
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect(onUrlUpdate.mock.lastCall![0].queryString).toBe('?tab=drafts');
    expect(onUrlUpdate.mock.lastCall![0].options.history).toBe('push');
  });

  it('pressing the Title header sorts by title (push)', async () => {
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    setup({ lists: [[DEFAULT, page([item()])]], onUrlUpdate });
    fireEvent.click(screen.getByRole('button', { name: /Title/ }));
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect(onUrlUpdate.mock.lastCall![0].queryString).toBe('?sort=title');
    expect(onUrlUpdate.mock.lastCall![0].options.history).toBe('push');
  });

  it('the Sort by select writes ?sort=-title and drops the page', async () => {
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    setup({ search: '?page=2', lists: [[{ ...DEFAULT, page: 2 }, page([item()], { total: 20, page: 2 })]], onUrlUpdate });
    const select = screen.getByRole('combobox', { name: 'Sort by' });
    select.focus();
    fireEvent.keyDown(select, { key: 'Enter' });
    const option = await screen.findByRole('option', { name: 'Title Z–A' });
    option.focus();
    fireEvent.keyDown(option, { key: 'Enter' });
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect(onUrlUpdate.mock.lastCall![0].queryString).toBe('?sort=-title');
  });

  it('Next writes ?page=2', async () => {
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    setup({ lists: [[DEFAULT, page([item()], { total: 20 })]], onUrlUpdate });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect(onUrlUpdate.mock.lastCall![0].queryString).toBe('?page=2');
  });

  it('the page-size select writes ?size=25 and drops the page', async () => {
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    setup({ search: '?page=2', lists: [[{ ...DEFAULT, page: 2 }, page([item()], { total: 20, page: 2 })]], onUrlUpdate });
    const select = screen.getByRole('combobox', { name: 'Rows per page' });
    select.focus();
    fireEvent.keyDown(select, { key: 'Enter' });
    const option = await screen.findByRole('option', { name: '25' });
    option.focus();
    fireEvent.keyDown(option, { key: 'Enter' });
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect(onUrlUpdate.mock.lastCall![0].queryString).toBe('?size=25');
  });

  it.each([
    ['?page=5', 12, '?page=2'],
    ['?page=3', 4, ''],
  ])('a page past the end (%s, total %i) goes to the last page instead of a false empty state', async (search, total, expected) => {
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    const pageNo = Number(search.split('=')[1]);
    setup({ search, lists: [[{ ...DEFAULT, page: pageNo }, page([], { total, page: pageNo })]], onUrlUpdate });
    expect(screen.queryByTestId('content-filtered-empty')).toBeNull();
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect(onUrlUpdate.mock.lastCall![0].queryString).toBe(expected);
    expect(onUrlUpdate.mock.lastCall![0].options.history).toBe('replace');
  });

  it('debounces the search by 300 ms, writes q with history replace and drops the page', async () => {
    vi.useFakeTimers();
    try {
      const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
      setup({ search: '?page=3', lists: [[{ ...DEFAULT, page: 3 }, page([item()], { total: 30, page: 3 })]], onUrlUpdate });
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'عيد' } });
      await act(async () => void vi.advanceTimersByTime(250));
      expect(onUrlUpdate).not.toHaveBeenCalled();
      await act(async () => void vi.advanceTimersByTime(100));
      await act(async () => void vi.runOnlyPendingTimers());
      expect(onUrlUpdate).toHaveBeenCalledTimes(1);
      const qs = new URLSearchParams(onUrlUpdate.mock.lastCall![0].queryString);
      expect(qs.get('q')).toBe('عيد');
      expect(qs.has('page')).toBe(false);
      expect(onUrlUpdate.mock.lastCall![0].options.history).toBe('replace');
    } finally {
      vi.useRealTimers();
    }
  });

  it('slow load: nothing for the first 150 ms, then a six-row skeleton', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }));
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    try {
      setup();
      expect(screen.queryByTestId('content-skeleton')).toBeNull();
      await act(async () => void vi.advanceTimersByTime(160));
      const skeleton = screen.getByTestId('content-skeleton');
      expect(skeleton.getAttribute('aria-busy')).toBe('true');
      expect(skeleton.querySelectorAll('[data-boneyard-bone]')).toHaveLength(7);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('API failure: inline role=alert with Retry that refetches', async () => {
    const paths: string[] = [];
    session = {
      state: { status: 'signed-in', connection: { state: 'connected' } },
      client: {
        apiFetch: async (path) => {
          paths.push(path);
          return json({ code: 'boom' }, 500);
        },
      },
    };
    setup();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('We could not load your videos and stories');
    const before = paths.length;
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(paths.length).toBeGreaterThan(before));
    expect(paths.every((p) => p === '/v1/content')).toBe(true);
  });

  it('API failure with a table on screen: the stale table stays with the alert above it', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.getQueryCache().build(client, { queryKey: queryKeys.content.list(DEFAULT) }).setState({ status: 'error', data: page([item({ title: 'Kept' })]), error: new Error('down'), fetchStatus: 'idle' });
    render(
      <I18nProvider locale="en" messages={getMessages('en')}>
        <QueryClientProvider client={client}>
          <NuqsTestingAdapter>
            <ContentView />
          </NuqsTestingAdapter>
        </QueryClientProvider>
      </I18nProvider>,
    );
    expect(screen.getByRole('alert').textContent).toContain('We could not load your videos and stories');
    expect(screen.getByRole('table').textContent).toContain('Kept');
  });

  describe('row menu', () => {
    const live = (initial: ContentItem[]) => {
      let items = [...initial];
      const calls: Array<[string, string]> = [];
      session = {
        state: { status: 'signed-in', connection: { state: 'connected' } },
        client: {
          apiFetch: async (path, init) => {
            const method = (init?.method ?? 'GET').toUpperCase();
            calls.push([method, path]);
            const id = path.split('/')[3];
            const found = items.find((i) => i.id === id);
            if (method === 'GET') return json(page(items, { counts: { all: items.length, published: items.filter((i) => i.status === 'published').length, scheduled: 0, drafts: items.filter((i) => i.status === 'draft').length } }));
            if (!found) return json({ code: 'content_not_found' }, 404);
            if (method === 'DELETE') {
              items = items.filter((i) => i.id !== id);
              return new Response(null, { status: 204 });
            }
            if (path.endsWith('/undo-archive')) {
              Object.assign(found, { status: found.archived_from, archived_from: null });
              return json(found);
            }
            if (path.endsWith('/archive')) {
              Object.assign(found, { status: 'archived', archived_from: found.status });
              return json(found);
            }
            return json({}, 400);
          },
        },
      };
      return { calls, drop: (id: string) => void (items = items.filter((i) => i.id !== id)) };
    };

    it('Archive moves the item to archived, counts refresh, and Undo restores the prior status', async () => {
      const a = item({ title: 'Summer sale', status: 'published' });
      const { calls } = live([a]);
      setup();
      await screen.findByRole('table');
      expect(screen.getByTestId('count-published').textContent).toBe('1');
      const menu = await openRowMenu('Summer sale');
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Archive' }));
      await waitFor(() => expect(toast.list().some((t) => t.title === '“Summer sale” archived. Undo available' && t.action?.label === 'Undo')).toBe(true));
      expect(push).not.toHaveBeenCalled();
      expect(calls).toContainEqual(['POST', `/v1/content/${a.id}/archive`]);
      await waitFor(() => expect(screen.getByTestId('count-published').textContent).toBe('0'));
      expect(screen.getByRole('table').textContent).toContain('Archived');
      act(() => toast.list().find((t) => t.action)!.action!.onClick());
      await waitFor(() => expect(calls).toContainEqual(['POST', `/v1/content/${a.id}/undo-archive`]));
      await waitFor(() => expect(screen.getByTestId('count-published').textContent).toBe('1'));
    });

    it('archived rows have no Archive item', async () => {
      live([item({ title: 'Old', status: 'archived', archived_from: 'draft' })]);
      setup();
      await screen.findByRole('table');
      const menu = await openRowMenu('Old');
      expect(within(menu).queryByRole('menuitem', { name: 'Archive' })).toBeNull();
      expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toBeTruthy();
    });

    it('Delete asks in a dialog naming the item, then the row disappears', async () => {
      const a = item({ title: 'Eid perfume' });
      const b = item({ title: 'Keep me' });
      const { calls } = live([a, b]);
      setup();
      await screen.findByRole('table');
      const menu = await openRowMenu('Eid perfume');
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
      const dlg = await screen.findByRole('alertdialog');
      expect(dlg.textContent).toContain('Delete “Eid perfume”?');
      expect(push).not.toHaveBeenCalled();
      expect(calls.some(([m]) => m === 'DELETE')).toBe(false);
      fireEvent.click(within(dlg).getAllByRole('button').find((btn) => btn.textContent === 'Delete')!);
      await waitFor(() => expect(calls).toContainEqual(['DELETE', `/v1/content/${a.id}`]));
      await waitFor(() => expect(screen.getByRole('table').textContent).not.toContain('Eid perfume'));
      expect(screen.getByRole('table').textContent).toContain('Keep me');
    });

    it('a 404 on archive shows an error toast and refetches the list', async () => {
      const a = item({ title: 'Gone' });
      const { calls, drop } = live([a]);
      setup();
      await screen.findByRole('table');
      const menu = await openRowMenu('Gone');
      // Deleted elsewhere in the meantime.
      drop(a.id);
      const gets = calls.filter(([m]) => m === 'GET').length;
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Archive' }));
      await waitFor(() => expect(toast.list().some((t) => t.tone === 'danger')).toBe(true));
      await waitFor(() => expect(calls.filter(([m]) => m === 'GET').length).toBeGreaterThan(gets));
    });

    it('Delete on an item that 404s shows a danger toast and no success toast', async () => {
      const a = item({ title: 'Vanished' });
      const { drop } = live([a]);
      setup();
      await screen.findByRole('table');
      const menu = await openRowMenu('Vanished');
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
      const dlg = await screen.findByRole('alertdialog');
      drop(a.id);
      fireEvent.click(within(dlg).getAllByRole('button').find((btn) => btn.textContent === 'Delete')!);
      await waitFor(() => expect(toast.list().some((t) => t.tone === 'danger' && t.title === getMessages('en').content.delete.failed)).toBe(true));
      expect(toast.list().some((t) => t.tone === 'success')).toBe(false);
    });

    it('archiving two rows quickly keeps an Undo toast for each, naming the item', async () => {
      live([item({ title: 'First', status: 'published' }), item({ title: 'Second', status: 'published' })]);
      setup();
      await screen.findByRole('table');
      fireEvent.click(within(await openRowMenu('First')).getByRole('menuitem', { name: 'Archive' }));
      fireEvent.click(within(await openRowMenu('Second')).getByRole('menuitem', { name: 'Archive' }));
      await waitFor(() => {
        const titles = toast.list().filter((t) => t.action).map((t) => t.title);
        expect(titles).toEqual(expect.arrayContaining(['“First” archived. Undo available', '“Second” archived. Undo available']));
      });
    });
  });
});

describe('URL state and API path', () => {
  it('serializes the URL state, leaving defaults out', () => {
    const serialize = createSerializer(contentParams, { clearOnDefault: true });
    expect(serialize({ tab: 'drafts', q: 'sale', sort: 'title', page: 2, size: 25 })).toBe('?tab=drafts&q=sale&sort=title&page=2&size=25');
    expect(serialize({ tab: 'all', q: '', sort: '-updated', page: 1, size: 10 })).toBe('');
  });
  it('maps URL state to a safe API query and path', () => {
    expect(toContentQuery({ tab: 'all', q: '  eid ', sort: '-updated', page: 0 })).toEqual({ tab: 'all', q: 'eid', sort: '-updated', page: 1, page_size: 10 });
    expect(toContentQuery({ tab: 'all', q: 'x'.repeat(150), sort: '-updated', page: 1 }).q).toHaveLength(100);
    expect(toContentQuery({ tab: 'all', q: '', sort: '-updated', page: 1, size: 7 }).page_size).toBe(10);
    expect(contentPath(DEFAULT)).toBe('/v1/content');
    expect(contentPath({ tab: 'scheduled', q: 'a%b', sort: 'title', page: 2, page_size: 50 })).toBe('/v1/content?tab=scheduled&q=a%25b&sort=title&page=2&page_size=50');
  });
});
