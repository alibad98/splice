// @vitest-environment jsdom
// Story 2.3: the Products page sync header, the manual sync button and its toasts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import type { CatalogSyncStatus, ProductListResponse, ProductRow } from '@slips/contracts';
import { Toaster, toast } from '@slips/ui';
import { I18nProvider } from '../../i18n/provider';
import { getMessages } from '../../i18n/messages';
import { directionOf, type Locale } from '../../i18n/config';
import { formatDate, formatRelativeTime } from '../../i18n/format';
import { SYNC_POLL_MS } from '../../lib/api/catalog';
import { ProductsView } from './ProductsView';

const NOW = new Date('2026-11-01T12:00:00Z').getTime();
const row = (name: string): ProductRow => ({
  id: crypto.randomUUID(),
  external_id: name,
  name,
  image_url: null,
  category_name: null,
  more_categories: 0,
  price_minor: 1000,
  sale_price_minor: null,
  currency: 'SAR',
  tax_inclusive: true,
  availability: 'available',
  linked_content_count: 0,
  attributed_orders: null,
});
const page = (items: ProductRow[]): ProductListResponse => ({ v: 1, items, total: items.length, page: 1, page_size: 50 });
const status = (s: CatalogSyncStatus['status'], over: Partial<CatalogSyncStatus> = {}): CatalogSyncStatus => ({ v: 1, status: s, run_id: null, reason: null, last_synced_at: null, ...over });
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });

/** A fake API: GET answers come from the mutable `api` object; every request is recorded. */
interface FakeApi {
  sync: CatalogSyncStatus;
  products: ProductRow[];
  post: () => Response;
  calls: Array<{ method: string; path: string }>;
}
let api: FakeApi;
let session: { client: { apiFetch: (path: string, init?: RequestInit) => Promise<Response> }; state: { status: 'signed-in' } } | null = null;
vi.mock('../session/SessionProvider', () => ({ useSession: () => session }));

function setup(locale: Locale = 'en') {
  session = {
    state: { status: 'signed-in' },
    client: {
      apiFetch: async (path: string, init: RequestInit = {}) => {
        const method = init.method ?? 'GET';
        api.calls.push({ method, path });
        if (method === 'POST') return api.post();
        if (path === '/v1/catalog/sync') return json(api.sync);
        if (path === '/v1/products/categories') return json({ v: 1, items: [] });
        return json(page(api.products));
      },
    },
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nProvider locale={locale} messages={getMessages(locale)}>
      <QueryClientProvider client={client}>
        <NuqsTestingAdapter hasMemory>
          <ProductsView />
        </NuqsTestingAdapter>
        <Toaster label={getMessages(locale).toast.region} closeLabel={getMessages(locale).toast.close} dir={directionOf(locale)} />
      </QueryClientProvider>
    </I18nProvider>,
  );
}

const flush = async (ms = 50) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const syncButton = (name = 'Sync products') => screen.getByRole('button', { name });
const posts = () => api.calls.filter((c) => c.method === 'POST');

beforeEach(() => {
  sessionStorage.clear();
  vi.useFakeTimers({ now: NOW });
  api = { sync: status('succeeded', { run_id: crypto.randomUUID(), last_synced_at: new Date(NOW - 5 * 60_000).toISOString() }), products: [row('Abaya')], post: () => json(status('queued', { run_id: crypto.randomUUID() }), { status: 202 }), calls: [] };
});
afterEach(() => {
  cleanup();
  act(() => toast.clear());
  session = null;
  vi.useRealTimers();
});

describe('relative time', () => {
  it('reads minutes, hours and days ago in English and Arabic with Western digits; under a minute is now', () => {
    expect(formatRelativeTime(NOW - 5 * 60_000, 'en', NOW)).toBe('5 minutes ago');
    expect(formatRelativeTime(NOW - 5 * 60_000, 'ar', NOW)).toMatch(/5/);
    expect(formatRelativeTime(NOW - 5 * 60_000, 'ar', NOW)).toMatch(/دقائق/);
    expect(formatRelativeTime(NOW - 3 * 3600_000, 'en', NOW)).toBe('3 hours ago');
    expect(formatRelativeTime(NOW - 24 * 3600_000, 'en', NOW)).toBe('yesterday');
    expect(formatRelativeTime(NOW - 10_000, 'en', NOW)).toBe('just now');
    expect(formatRelativeTime(NOW - 10_000, 'ar', NOW)).toBe('قبل لحظات');
    // Clock skew: a time ahead of this clock is never shown as future.
    expect(formatRelativeTime(NOW + 5 * 60_000, 'en', NOW)).toBe('just now');
  });
});

describe('sync header', () => {
  it('shows "Last synced 5 minutes ago" with the exact store-time on hover/focus, and the Sync products button', async () => {
    setup();
    await flush();
    const time = screen.getByText('Last synced 5 minutes ago');
    expect(time.tagName).toBe('TIME');
    expect(time.getAttribute('tabindex')).toBe('0');
    const tip = document.getElementById(time.getAttribute('aria-describedby')!)!;
    expect(tip.getAttribute('role')).toBe('tooltip');
    expect(tip.textContent).toBe(formatDate(NOW - 5 * 60_000, 'en', { dateStyle: 'medium', timeStyle: 'short' }));
    expect(tip.className).toContain('group-focus-within:block');
    expect(syncButton().getAttribute('aria-busy')).toBeNull();
  });

  it('updates the relative time each minute', async () => {
    setup();
    await flush();
    expect(screen.getByText('Last synced 5 minutes ago')).toBeTruthy();
    await flush(60_000);
    expect(screen.getByText('Last synced 6 minutes ago')).toBeTruthy();
  });

  it('Arabic: the header and button read in Arabic', async () => {
    setup('ar');
    await flush();
    expect(screen.getByTestId('sync-header').textContent).toContain('آخر مزامنة');
    expect(syncButton('زامن المنتجات')).toBeTruthy();
  });

  it('never synced: "Not synced yet"', async () => {
    api.sync = status('never');
    api.products = [];
    setup();
    await flush();
    expect(screen.getByTestId('sync-header').textContent).toContain('Not synced yet');
  });
});

describe('Sync products button', () => {
  it('while queued or running: spinner, aria-busy, focusable, clicks and Enter ignored', async () => {
    api.sync = status('running', { run_id: crypto.randomUUID(), last_synced_at: new Date(NOW - 60_000).toISOString() });
    setup();
    await flush();
    const button = syncButton();
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.querySelector('[data-slot="spinner"]')).not.toBeNull();
    button.focus();
    button.click(); // what Enter or Space dispatch on a focused button
    fireEvent.click(button);
    fireEvent.click(button);
    await flush();
    expect(posts()).toHaveLength(0);
    expect(document.activeElement).toBe(button);
  });

  it('a click posts once; double clicks are ignored; the button stays pending until the run ends, then "Products updated" and a refetch', async () => {
    setup();
    await flush();
    const button = syncButton();
    fireEvent.click(button);
    fireEvent.click(button);
    await flush();
    expect(posts()).toEqual([{ method: 'POST', path: '/v1/catalog/sync' }]);
    expect(syncButton().getAttribute('aria-busy')).toBe('true');
    const productCalls = () => api.calls.filter((c) => c.method === 'GET' && c.path === '/v1/products').length;
    const before = productCalls();
    api.sync = status('succeeded', { run_id: crypto.randomUUID(), last_synced_at: new Date(NOW).toISOString() });
    api.products = [row('Abaya'), row('New bag')];
    await flush(SYNC_POLL_MS + 100);
    await flush(100);
    expect(screen.getByText('Products updated')).toBeTruthy();
    expect(productCalls()).toBeGreaterThan(before);
    expect(screen.getByRole('table').textContent).toContain('New bag');
    expect(syncButton().getAttribute('aria-busy')).toBeNull();
    expect(screen.getByText('Last synced just now')).toBeTruthy();
  });

  it('429 from the API: a neutral toast with the Retry-After seconds; nothing else changes', async () => {
    api.post = () => json({ type: 'sync-rate-limited', status: 429, code: 'sync_rate_limited', title: 'x' }, { status: 429, headers: { 'content-type': 'application/problem+json', 'retry-after': '42' } });
    setup();
    await flush();
    fireEvent.click(syncButton());
    await flush();
    expect(screen.getByText('A sync was requested moments ago. Try again in 42 seconds.')).toBeTruthy();
    expect(syncButton().getAttribute('aria-busy')).toBeNull();
  });

  it('a run that fails: one action toast with Retry that never auto-dismisses; the old list stays; Retry posts again', async () => {
    const runId = crypto.randomUUID();
    api.sync = status('running', { run_id: runId, last_synced_at: new Date(NOW - 3600_000).toISOString() });
    setup();
    await flush();
    api.sync = status('failed', { run_id: runId, reason: 'platform_unavailable', last_synced_at: new Date(NOW - 3600_000).toISOString() });
    await flush(SYNC_POLL_MS + 100);
    const message = "We couldn't sync your products. Your current list is still here.";
    expect(screen.getAllByText(message)).toHaveLength(1);
    expect(screen.getByRole('table').textContent).toContain('Abaya');
    await flush(10 * 60_000); // never auto-dismisses
    expect(screen.getAllByText(message)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await flush();
    expect(posts()).toHaveLength(1);
  });

  it('the failure of a run is shown once, even after the page remounts', async () => {
    const runId = crypto.randomUUID();
    api.sync = status('running', { run_id: runId });
    setup();
    await flush();
    api.sync = status('failed', { run_id: runId, reason: 'auth_rejected' });
    await flush(SYNC_POLL_MS + 100);
    expect(toast.list().filter((t) => t.title.startsWith("We couldn't sync"))).toHaveLength(1);
    act(() => toast.clear());
    cleanup();
    api.sync = status('running', { run_id: runId });
    setup();
    await flush();
    api.sync = status('failed', { run_id: runId, reason: 'auth_rejected' });
    await flush(SYNC_POLL_MS + 100);
    expect(toast.list()).toHaveLength(0);
  });

  it('a store on never: pressing Sync products brings the products in without a reload', async () => {
    api.sync = status('never');
    api.products = [];
    const runId = crypto.randomUUID();
    api.post = () => json(status('queued', { run_id: runId }), { status: 202 });
    setup();
    await flush(200);
    expect(screen.getByTestId('products-syncing')).toBeTruthy();
    fireEvent.click(syncButton());
    await flush();
    api.sync = status('succeeded', { run_id: runId, last_synced_at: new Date(NOW).toISOString() });
    api.products = [row('Imported abaya')];
    await flush(SYNC_POLL_MS + 100);
    await flush(100);
    expect(screen.getByRole('table').textContent).toContain('Imported abaya');
    expect(screen.getByText('Products updated')).toBeTruthy();
  });

  it('429 without a readable Retry-After falls back to 60 seconds', async () => {
    api.post = () => json({ type: 'sync-rate-limited', status: 429 }, { status: 429 });
    setup('ar');
    await flush();
    fireEvent.click(syncButton('زامن المنتجات'));
    await flush();
    expect(screen.getByText('طلبنا مزامنة قبل لحظات. جرّب بعد 60 ثانية.')).toBeTruthy();
  });

  it('queued -> failed raises the failure toast', async () => {
    const runId = crypto.randomUUID();
    api.sync = status('queued', { run_id: runId });
    setup();
    await flush();
    api.sync = status('failed', { run_id: runId, reason: 'internal' });
    await flush(SYNC_POLL_MS + 100);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('a page loaded on a run that already failed shows the failure once, and not again after a reload in the same session', async () => {
    const runId = crypto.randomUUID();
    api.sync = status('failed', { run_id: runId, reason: 'auth_rejected', last_synced_at: new Date(NOW - 3600_000).toISOString() });
    setup();
    await flush();
    expect(screen.getAllByText("We couldn't sync your products. Your current list is still here.")).toHaveLength(1);
    cleanup();
    act(() => toast.clear());
    setup();
    await flush();
    expect(toast.list()).toHaveLength(0);
  });

  it('the request itself fails (network): a friendly toast and the button is usable again', async () => {
    api.post = () => {
      throw new TypeError('network');
    };
    setup();
    await flush();
    fireEvent.click(syncButton());
    await flush();
    expect(screen.getByText("We couldn't start the sync. Check your connection and try again.")).toBeTruthy();
    expect(syncButton().getAttribute('aria-busy')).toBeNull();
  });
});
