// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NuqsTestingAdapter, type OnUrlUpdateFunction } from 'nuqs/adapters/testing';
import { createSerializer } from 'nuqs';
import type { CatalogSyncStatus, ProductListQuery, ProductListResponse, ProductRow } from '@slips/contracts';
import { I18nProvider } from '../../i18n/provider';
import { getMessages } from '../../i18n/messages';
import type { Locale } from '../../i18n/config';
import { queryKeys } from '../../lib/api/query-keys';
import { SYNC_POLL_MS, productsPath } from '../../lib/api/catalog';
import { ProductsView } from './ProductsView';
import { availabilityChip, productPrice } from './format';
import { productParams, toListQuery } from './url-state';

const row = (over: Partial<ProductRow> = {}): ProductRow => ({
  id: crypto.randomUUID(),
  external_id: 'p1',
  name: 'Black abaya',
  image_url: 'https://cdn.example.com/p1.jpg',
  category_name: 'Abayas',
  more_categories: 0,
  price_minor: 15000,
  sale_price_minor: 12000,
  currency: 'SAR',
  tax_inclusive: true,
  availability: 'available',
  has_required_options: false,
  linked_content_count: 0,
  attributed_orders: null,
  ...over,
});
const page = (items: ProductRow[], over: Partial<ProductListResponse> = {}): ProductListResponse => ({ v: 1, items, total: items.length, page: 1, page_size: 10, ...over });
const sync = (status: CatalogSyncStatus['status']): CatalogSyncStatus => ({ v: 1, status, run_id: null, reason: null, last_synced_at: null });
const DEFAULT: ProductListQuery = { sort: 'name', page: 1, page_size: 10 };

/** The signed-in session the data hooks use; null (default) means nothing is fetched and seeded data is shown. */
let session: { client: { apiFetch: (path: string) => Promise<Response> }; state: { status: 'signed-in'; connection: { state: 'connected' } } } | null = null;
vi.mock('../session/SessionProvider', () => ({ useSession: () => session }));

interface Setup {
  locale?: Locale;
  search?: string;
  /** Seeded responses per API query (no session, so nothing is fetched). */
  products?: Array<[ProductListQuery, ProductListResponse | Error]>;
  syncState?: CatalogSyncStatus | Error;
  onUrlUpdate?: OnUrlUpdateFunction;
}

function setup({ locale = 'en', search = '', products = [], syncState, onUrlUpdate }: Setup = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const [query, data] of products) {
    if (data instanceof Error) client.getQueryCache().build(client, { queryKey: queryKeys.catalog.products(query) }).setState({ status: 'error', error: data, fetchStatus: 'idle' });
    else client.setQueryData(queryKeys.catalog.products(query), data);
  }
  if (syncState instanceof Error) client.getQueryCache().build(client, { queryKey: queryKeys.catalog.sync() }).setState({ status: 'error', error: syncState, fetchStatus: 'idle' });
  else if (syncState) client.setQueryData(queryKeys.catalog.sync(), syncState);
  client.setQueryData(queryKeys.catalog.categories(), { v: 1, items: [{ external_id: 'c1', name: 'Abayas' }] });
  return render(
    <I18nProvider locale={locale} messages={getMessages(locale)}>
      <QueryClientProvider client={client}>
        <NuqsTestingAdapter hasMemory searchParams={search} {...(onUrlUpdate ? { onUrlUpdate } : {})}>
          <ProductsView />
        </NuqsTestingAdapter>
      </QueryClientProvider>
    </I18nProvider>,
  );
}

beforeAll(() => {
  // jsdom lacks the pointer-capture and scroll APIs Radix Select uses.
  Object.assign(Element.prototype, {
    hasPointerCapture: () => false,
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
    scrollIntoView: () => undefined,
  });
});

afterEach(() => {
  cleanup();
  session = null;
});

describe('price and availability formatting', () => {
  it('shows the sale price from minor units, in the store currency, Western digits', () => {
    expect(productPrice({ price_minor: 15000, sale_price_minor: 12000, currency: 'SAR' }, 'en')).toBe('SAR 120');
    expect(productPrice({ price_minor: 15000, sale_price_minor: 12000, currency: 'SAR' }, 'ar')).toMatch(/^120\sر\.س$/);
    expect(productPrice({ price_minor: 1250, sale_price_minor: null, currency: 'SAR' }, 'en')).toBe('SAR 12.50');
    expect(productPrice({ price_minor: 1250, sale_price_minor: null, currency: 'KWD' }, 'en')).toContain('1.250');
    expect(productPrice({ price_minor: 1255, sale_price_minor: null, currency: 'KWD' }, 'en')).toContain('1.255');
    expect(productPrice({ price_minor: 3000, sale_price_minor: null, currency: 'KWD' }, 'en')).toBe('KWD 3');
  });
  it.each([
    ['available', 'success', 'Available', 'متوفر'],
    ['low', 'warning', 'Low stock', 'كمية قليلة'],
    ['out_of_stock', 'danger', 'Out of stock', 'نفد المخزون'],
  ] as const)('maps the stored %s bucket to a %s chip with a text label', (bucket, tone, en, ar) => {
    expect(availabilityChip(bucket, getMessages('en').products.availability)).toEqual({ tone, label: en });
    expect(availabilityChip(bucket, getMessages('ar').products.availability).label).toBe(ar);
  });
});

describe('Products page', () => {
  it('renders a Card-wrapped table with thumbnail, name, category, price, 0 linked, "—" orders and the chip (English)', () => {
    setup({ products: [[DEFAULT, page([row({ more_categories: 2 }), row({ name: 'Bag', availability: 'out_of_stock', image_url: null, category_name: null })])]] });
    const table = screen.getByRole('table', { name: 'Products' });
    expect(table.closest('[data-slot="card"]')).not.toBeNull();
    for (const h of ['Product', 'Category', 'Price', 'Linked content', 'Attributed orders', 'Availability']) expect(table.textContent).toContain(h);
    expect(table.querySelector('img[loading="lazy"]')?.getAttribute('src')).toBe('https://cdn.example.com/p1.jpg');
    expect(table.textContent).toContain('+2');
    const price = [...table.querySelectorAll('bdi')].find((b) => b.textContent === 'SAR 120');
    expect(price?.className).toContain('tabular-nums');
    expect(table.querySelector('span[dir="auto"]')?.textContent).toBe('Black abaya');
    expect(table.textContent).toContain('—');
    expect(table.textContent).toContain('Available');
    expect(table.textContent).toContain('Out of stock');
    // Small screens get the same rows as cards.
    expect(screen.getByRole('list', { name: 'Products' }).querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByText('1-2 of 2')).toBeTruthy();
  });

  it('renders Arabic labels, the riyal price and Arabic chips', () => {
    setup({ locale: 'ar', products: [[DEFAULT, page([row({ availability: 'low' })])]] });
    const table = screen.getByRole('table', { name: 'المنتجات' });
    expect(table.textContent).toContain('المحتوى المرتبط');
    expect(table.textContent).toMatch(/120\sر\.س/);
    expect(table.textContent).toContain('كمية قليلة');
  });

  it('reads q, category, sort and page from the URL', () => {
    const query: ProductListQuery = { q: 'abaya', category: 'c1', sort: '-price', page: 2, page_size: 10 };
    setup({ search: '?q=abaya&category=c1&sort=-price&page=2', products: [[query, page([row()], { total: 51, page: 2 })]] });
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('abaya');
    expect(screen.getByRole('combobox', { name: 'Category' }).textContent).toContain('Abayas');
    expect(screen.getByRole('columnheader', { name: /Price/ }).getAttribute('aria-sort')).toBe('descending');
    expect(screen.getByText('11-11 of 51')).toBeTruthy();
  });

  it('pushes sort and page changes to the URL (history entries, so Back restores them)', async () => {
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    setup({ products: [[DEFAULT, page([row()], { total: 120 })]], onUrlUpdate });
    fireEvent.click(screen.getByRole('button', { name: /Price/ }));
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect(onUrlUpdate.mock.lastCall![0].queryString).toBe('?sort=price');
    expect(onUrlUpdate.mock.lastCall![0].options.history).toBe('push');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(onUrlUpdate.mock.lastCall![0].queryString).toContain('page=2'));
  });

  it('debounces the search box by 300 ms before writing q to the URL and resets the page', async () => {
    vi.useFakeTimers();
    try {
      const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
      setup({ search: '?page=3', products: [[{ sort: 'name', page: 3, page_size: 10 }, page([row()], { total: 120, page: 3 })]], onUrlUpdate });
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'عباية' } });
      await act(async () => void vi.advanceTimersByTime(250));
      expect(onUrlUpdate).not.toHaveBeenCalled();
      await act(async () => void vi.advanceTimersByTime(100));
      await act(async () => void vi.runOnlyPendingTimers());
      expect(onUrlUpdate).toHaveBeenCalledTimes(1);
      const qs = new URLSearchParams(onUrlUpdate.mock.lastCall![0].queryString);
      expect(qs.get('q')).toBe('عباية');
      expect(qs.has('page')).toBe(false);
      expect(onUrlUpdate.mock.lastCall![0].options.history).toBe('replace');
    } finally {
      vi.useRealTimers();
    }
  });

  it('filtered-empty: a sentence and "Show all" clears q and category', async () => {
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    const query: ProductListQuery = { q: 'zzz', category: 'c1', sort: 'name', page: 1, page_size: 10 };
    setup({ search: '?q=zzz&category=c1', products: [[query, page([])]], onUrlUpdate });
    expect(screen.getByText('No products match these filters.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect(onUrlUpdate.mock.lastCall![0].queryString).toBe('');
  });

  it.each([
    ['running', 'products-syncing', 'Syncing your products...'],
    ['never', 'products-syncing', 'Syncing your products...'],
    ['succeeded', 'products-none', 'Open Salla products'],
    ['failed', 'products-failed', 'We could not bring in your products yet'],
  ] as const)('no products and sync %s: the matching empty state', (status, testId, text) => {
    setup({ products: [[DEFAULT, page([])]], syncState: sync(status) });
    expect(screen.getByTestId(testId).textContent).toContain(text);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('the empty state links to Salla products in a new tab safely', () => {
    setup({ products: [[DEFAULT, page([])]], syncState: sync('succeeded') });
    const link = screen.getByRole('link', { name: 'Open Salla products' });
    expect(link.getAttribute('href')).toBe('https://s.salla.sa/products');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('slow load: nothing for the first 150 ms, then a six-row skeleton (no spinner)', async () => {
    vi.useFakeTimers();
    // jsdom has no matchMedia or ResizeObserver (boneyard uses them for reduced motion and container width).
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }));
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    try {
      setup();
      expect(screen.queryByTestId('products-skeleton')).toBeNull();
      await act(async () => void vi.advanceTimersByTime(160));
      const skeleton = screen.getByTestId('products-skeleton');
      expect(skeleton.getAttribute('aria-busy')).toBe('true');
      expect(skeleton.textContent).toContain('Loading products...');
      // A header bone plus six row bones.
      expect(skeleton.querySelectorAll('[data-boneyard-bone]')).toHaveLength(7);
      expect(screen.queryByRole('table')).toBeNull();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('the sync request fails: inline error with Retry instead of an empty state', () => {
    setup({ products: [[DEFAULT, page([])]], syncState: new Error('down') });
    expect(screen.getByRole('alert').textContent).toContain('We could not load your products');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByTestId('products-syncing')).toBeNull();
  });

  it('after "Show all" the search box is empty', async () => {
    const query: ProductListQuery = { q: 'zzz', sort: 'name', page: 1, page_size: 10 };
    setup({ search: '?q=zzz', products: [[query, page([])], [DEFAULT, page([row()])]] });
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('zzz');
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    await waitFor(() => expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe(''));
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('from ?sort=price, pressing Price sorts descending', async () => {
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    setup({ search: '?sort=price', products: [[{ sort: 'price', page: 1, page_size: 10 }, page([row()])]], onUrlUpdate });
    fireEvent.click(screen.getByRole('button', { name: /Price/ }));
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect(onUrlUpdate.mock.lastCall![0].queryString).toBe('?sort=-price');
  });

  it('choosing a category from ?page=3 sets the category and drops the page', async () => {
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    setup({ search: '?page=3', products: [[{ sort: 'name', page: 3, page_size: 10 }, page([row()], { total: 120, page: 3 })]], onUrlUpdate });
    const combobox = screen.getByRole('combobox', { name: 'Category' });
    combobox.focus();
    fireEvent.keyDown(combobox, { key: 'Enter' });
    const option = await screen.findByRole('option', { name: 'Abayas' });
    option.focus();
    fireEvent.keyDown(option, { key: 'Enter' });
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect(onUrlUpdate.mock.lastCall![0].queryString).toBe('?category=c1');
    expect(onUrlUpdate.mock.lastCall![0].options.history).toBe('push');
  });

  it('shows 10 rows per page by default; choosing 25 writes size=25 and drops the page', async () => {
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    setup({ search: '?page=2', products: [[{ sort: 'name', page: 2, page_size: 10 }, page([row()], { total: 23, page: 2 })]], onUrlUpdate });
    expect(screen.getByText('11-11 of 23')).toBeTruthy();
    const sizeSelect = screen.getByRole('combobox', { name: 'Rows per page' });
    expect(sizeSelect.textContent).toContain('10');
    sizeSelect.focus();
    fireEvent.keyDown(sizeSelect, { key: 'Enter' });
    const option = await screen.findByRole('option', { name: '25' });
    option.focus();
    fireEvent.keyDown(option, { key: 'Enter' });
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect(onUrlUpdate.mock.lastCall![0].queryString).toBe('?size=25');
    expect(onUrlUpdate.mock.lastCall![0].options.history).toBe('push');
  });

  it('Previous from ?page=2 removes the page', async () => {
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    setup({ search: '?page=2', products: [[{ sort: 'name', page: 2, page_size: 10 }, page([row()], { total: 120, page: 2 })]], onUrlUpdate });
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect(onUrlUpdate.mock.lastCall![0].queryString).toBe('');
  });

  it('when the first import finishes, the products appear without a reload', async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      const paths: string[] = [];
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      session = {
        state: { status: 'signed-in', connection: { state: 'connected' } },
        client: {
          apiFetch: async (path: string) => {
            paths.push(path);
            if (path === '/v1/catalog/sync') return json(sync(done ? 'succeeded' : 'running'));
            if (path === '/v1/products/categories') return json({ v: 1, items: [] });
            return json(done ? page([row({ name: 'Imported abaya' })]) : page([]));
          },
        },
      };
      setup();
      await act(async () => void (await vi.advanceTimersByTimeAsync(200)));
      expect(screen.getByTestId('products-syncing')).toBeTruthy();
      done = true;
      await act(async () => void (await vi.advanceTimersByTimeAsync(SYNC_POLL_MS + 100)));
      await act(async () => void (await vi.advanceTimersByTimeAsync(100)));
      expect(screen.getByRole('table').textContent).toContain('Imported abaya');
      expect(paths).toContain('/v1/products/categories');
      expect(paths).toContain('/v1/catalog/sync');
    } finally {
      vi.useRealTimers();
    }
  });

  it('API failure: inline error with Retry; the filters keep working', () => {
    setup({ products: [[DEFAULT, new Error('boom')]] });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('We could not load your products');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByRole('searchbox')).toBeTruthy();
  });
});

describe('URL state and API path', () => {
  it('serializes filters into the URL, leaving defaults out', () => {
    const serialize = createSerializer(productParams, { clearOnDefault: true });
    expect(serialize({ q: 'abaya', category: 'c1', sort: '-price', page: 2 })).toBe('?q=abaya&category=c1&sort=-price&page=2');
    expect(serialize({ q: '', category: '', sort: 'name', page: 1 })).toBe('');
  });
  it('maps URL state to a safe API query and path', () => {
    expect(toListQuery({ q: '  abaya ', category: '', sort: 'name', page: 0 })).toEqual({ q: 'abaya', sort: 'name', page: 1, page_size: 10 });
    expect(toListQuery({ q: 'x'.repeat(150), category: 'c1', sort: 'price', page: 2 }).q).toHaveLength(100);
    expect(productsPath({ q: 'a%b', category: 'c1', sort: '-price', page: 2, page_size: 10 })).toBe('/v1/products?q=a%25b&category=c1&sort=-price&page=2');
    expect(productsPath(DEFAULT)).toBe('/v1/products');
  });
  it('carries the page size: default 10 left out, other allowed sizes sent, anything else falls back to 10', () => {
    const serialize = createSerializer(productParams, { clearOnDefault: true });
    expect(serialize({ size: 25 })).toBe('?size=25');
    expect(serialize({ size: 10 })).toBe('');
    expect(toListQuery({ q: '', category: '', sort: 'name', page: 1, size: 25 }).page_size).toBe(25);
    expect(toListQuery({ q: '', category: '', sort: 'name', page: 1, size: 7 }).page_size).toBe(10);
    expect(productsPath({ sort: 'name', page: 1, page_size: 50 })).toBe('/v1/products?page_size=50');
  });
});
