// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ContentItem, ContentProductSummary, ProductRow } from '@slips/contracts';
import { DialogHost, dialog, toast, Toaster } from '@slips/ui';
import { I18nProvider } from '../../../i18n/provider';
import { getMessages } from '../../../i18n/messages';
import type { Locale } from '../../../i18n/config';
import { queryKeys } from '../../../lib/api/query-keys';
import { ContentEditor } from './ContentEditor';
import { ContentEditorPage } from './ContentEditorPage';
import { AUTOSAVE_DELAY_MS } from './use-autosave';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

type Call = { method: string; path: string; body: unknown };
type Handler = (call: Call) => Response | Promise<Response>;
let calls: Call[] = [];
let handler: Handler;
let session: { client: { apiFetch: (path: string, init?: RequestInit) => Promise<Response> }; state: Record<string, unknown> } | null = null;
vi.mock('../../session/SessionProvider', () => ({ useSession: () => session }));

const ID = '019a473a-0000-7000-8000-000000000001';
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
  created_at: '2026-11-05T10:00:00.000Z',
  updated_at: '2026-11-05T10:00:00.000Z',
  ...over,
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const problem = (status: number, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ type: 'about:blank', status, ...extra }), { status, headers: { 'content-type': 'application/problem+json' } });

/** Echo server: POST creates, PATCH merges into the last known item. */
function echo(start: ContentItem = item()): Handler {
  let current = start;
  let n = 0;
  return ({ method, body }) => {
    if (method === 'POST') {
      current = { ...item(), ...(body as object), id: ID, status: 'draft', updated_at: `2026-11-05T10:00:0${++n}.000Z` };
      return json(current, 201);
    }
    if (method === 'PATCH') {
      current = { ...current, ...(body as object), updated_at: `2026-11-05T10:01:0${++n}.000Z` };
      return json(current);
    }
    return json(current);
  };
}

let client: QueryClient;

function setup({ locale = 'en', element, domains = ['demo.salla.sa'] }: { locale?: Locale; element: React.ReactElement; domains?: string[] }) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  session = {
    client: {
      apiFetch: async (path, init = {}) => {
        const call = { method: init.method ?? 'GET', path, body: init.body ? JSON.parse(String(init.body)) : undefined };
        calls.push(call);
        return handler(call);
      },
    },
    state: { status: 'signed-in', mode: 'embedded', storeName: 'Demo', storeDomains: domains, connection: { state: 'connected', storeName: 'Demo' } },
  };
  return render(
    <I18nProvider locale={locale} messages={getMessages(locale)}>
      <QueryClientProvider client={client}>
        {element}
        <Toaster label="Notifications" toastLabel="Notification" closeLabel="Close" />
        <DialogHost />
      </QueryClientProvider>
    </I18nProvider>,
  );
}

/** Advance fake time in small steps (flushing promises) until the check passes. */
async function until(check: () => void, steps = 100) {
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
const writes = () => calls.filter((c) => c.method !== 'GET');
const title = () => screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement;
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

async function chooseAction(name: string) {
  const select = screen.getByRole('combobox', { name: 'Button action' });
  select.focus();
  fireEvent.keyDown(select, { key: 'Enter' });
  let option!: HTMLElement;
  await until(() => {
    option = screen.getByRole('option', { name });
  });
  option.focus();
  fireEvent.keyDown(option, { key: 'Enter' });
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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  calls = [];
  handler = echo();
  window.history.replaceState(null, '', '/content/new');
});

afterEach(() => {
  cleanup();
  act(() => toast.clear());
  act(() => dialog.clear());
  vi.useRealTimers();
  session = null;
  push.mockReset();
});

describe('Content editor: new item', () => {
  it('focuses the title; a format-only change saves nothing; a typed title creates the Draft once after 1 s and swaps the URL without a remount', async () => {
    setup({ element: <ContentEditor /> });
    expect(document.activeElement).toBe(title());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('New story');

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Reel' }), { button: 0 });
    fireEvent.click(screen.getByRole('tab', { name: 'Reel' }));
    await advance(AUTOSAVE_DELAY_MS * 2);
    expect(writes()).toEqual([]);

    const input = title();
    type(input, 'Autumn perfumes');
    await advance(AUTOSAVE_DELAY_MS - 50);
    expect(writes()).toEqual([]);
    await until(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: 'POST',
      path: '/v1/content',
      body: { title: 'Autumn perfumes', format: 'reel', cta_label: 'Add to cart', cta_action: 'add_to_cart', cta_url: null, cta_style: 'ink', product_id: null },
    });
    await until(() => expect(screen.getByRole('status', { name: '' }).textContent).toContain('Saved'));
    expect(window.location.pathname).toBe(`/content/${ID}`);
    expect(title()).toBe(input);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Autumn perfumes');

    // Later edits PATCH the created item.
    type(input, 'Autumn perfumes 2');
    await until(() => expect(writes()).toHaveLength(2));
    expect(writes()[1]).toEqual({ method: 'PATCH', path: `/v1/content/${ID}`, body: { title: 'Autumn perfumes 2' } });
  });

  it('uses the UI language for the default button text', async () => {
    setup({ locale: 'ar', element: <ContentEditor /> });
    type(screen.getByRole('textbox', { name: 'العنوان' }), 'عطور');
    await until(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.body).toMatchObject({ cta_label: 'أضف إلى السلة', format: 'story', cta_action: 'add_to_cart' });
  });

  it('a failed first save shows "Couldn\'t save. Retry", keeps the form, and Retry saves again', async () => {
    handler = () => problem(500);
    setup({ element: <ContentEditor /> });
    type(title(), 'Eid sale');
    await until(() => expect(screen.getByText("Couldn't save.")).toBeTruthy());
    expect(title().value).toBe('Eid sale');
    expect(window.location.pathname).toBe('/content/new');

    handler = echo();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await until(() => expect(writes()).toHaveLength(2));
    expect(writes()[1]!.method).toBe('POST');
    await until(() => expect(screen.queryByText("Couldn't save.")).toBeNull());
  });
});

describe('Content editor: draft autosave', () => {
  it('debounces: edits within 1 s of each other send one PATCH with only the changed field', async () => {
    setup({ element: <ContentEditor item={item()} /> });
    const label = screen.getByRole('textbox', { name: 'Button text' });
    type(label, 'Shop');
    await advance(500);
    type(label, 'Shop the look');
    await advance(500);
    expect(writes()).toEqual([]);
    await until(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ method: 'PATCH', path: `/v1/content/${ID}`, body: { cta_label: 'Shop the look' } });
    await advance(AUTOSAVE_DELAY_MS * 2);
    expect(writes()).toHaveLength(1);
  });

  it('quick picks set the button text; the style swatches change the style', async () => {
    setup({ element: <ContentEditor item={item({ cta_label: 'Buy' })} /> });
    fireEvent.click(screen.getByRole('button', { name: 'Shop now' }));
    expect((screen.getByRole('textbox', { name: 'Button text' }) as HTMLInputElement).value).toBe('Shop now');
    expect(screen.getByRole('button', { name: 'Shop now' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Outline' }));
    await until(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.body).toEqual({ cta_label: 'Shop now', cta_style: 'outline' });
  });

  it('open link off the store domain shows the rule on blur and never saves; a subdomain is accepted', async () => {
    setup({ element: <ContentEditor item={item()} /> });
    await chooseAction('Open link');
    const url = screen.getByRole('textbox', { name: 'Link' });
    type(url, 'https://evil.com/x');
    fireEvent.blur(url);
    await until(() => expect(screen.getByText("Use a link on your store's domain: demo.salla.sa")).toBeTruthy());
    expect(url.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(url.getAttribute('aria-describedby')!)!.textContent).toContain('demo.salla.sa');
    await advance(AUTOSAVE_DELAY_MS * 2);
    expect(writes()).toEqual([]);

    type(url, 'https://www.demo.salla.sa/p');
    await until(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.body).toEqual({ cta_action: 'open_link', cta_url: 'https://www.demo.salla.sa/p' });
    expect(url.getAttribute('aria-invalid')).toBeNull();
  });

  it('switching open link back to add to cart clears the URL and saves it as null', async () => {
    setup({ element: <ContentEditor item={item({ cta_action: 'open_link', cta_url: 'https://demo.salla.sa/p' })} /> });
    expect((screen.getByRole('textbox', { name: 'Link' }) as HTMLInputElement).value).toBe('https://demo.salla.sa/p');
    await chooseAction('Add to cart');
    expect(screen.queryByRole('textbox', { name: 'Link' })).toBeNull();
    await until(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.body).toEqual({ cta_action: 'add_to_cart', cta_url: null });
  });

  it('an API 422 cta-url-not-store-domain shows the rule on the field', async () => {
    setup({ element: <ContentEditor item={item()} />, domains: ['demo.salla.sa'] });
    handler = ({ method }) => (method === 'PATCH' ? problem(422, { type: 'cta-url-not-store-domain', code: 'cta_url_not_store_domain' }) : json(item()));
    await chooseAction('Open link');
    type(screen.getByRole('textbox', { name: 'Link' }), 'https://demo.salla.sa/x');
    await until(() => expect(screen.getByText("Use a link on your store's domain: demo.salla.sa")).toBeTruthy());
    expect(screen.getByText("Couldn't save.")).toBeTruthy();
  });

  it('a 409 on save shows an error toast and refetches the item; the editor then shows the archived item read-only', async () => {
    setup({ element: <ContentEditorPage id={ID} /> });
    client.setQueryData(queryKeys.content.item(ID), item());
    await until(() => expect(title().value).toBe('Autumn perfumes'));
    handler = ({ method }) => (method === 'PATCH' ? problem(409, { type: 'invalid-transition', code: 'invalid_transition' }) : json(item({ status: 'archived', archived_from: 'draft', updated_at: '2026-11-05T11:00:00.000Z' })));
    type(title(), 'Changed');
    await until(() => expect(screen.getByText('This item changed somewhere else. We loaded the latest version.')).toBeTruthy());
    await until(() => expect(calls.some((c) => c.method === 'GET' && c.path === `/v1/content/${ID}`)).toBe(true));
    await until(() => expect(screen.getByText(/This item is archived/)).toBeTruthy());
    expect(title().value).toBe('Autumn perfumes');
    expect(title().matches(':disabled')).toBe(true);
  });

  it('a 404 on save (deleted elsewhere) shows the not-found state even though the item is cached', async () => {
    setup({ element: <ContentEditorPage id={ID} /> });
    client.setQueryData(queryKeys.content.item(ID), item());
    await until(() => expect(title().value).toBe('Autumn perfumes'));
    handler = () => problem(404, { code: 'content_not_found' });
    type(title(), 'Changed');
    await until(() => expect(screen.getByTestId('content-not-found')).toBeTruthy());
  });

  it('shows merchant text as escaped text with dir=auto (no XSS)', () => {
    const xss = '<img src=x onerror=alert(1)>';
    const { container } = setup({ element: <ContentEditor item={item({ title: xss })} /> });
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toBe(xss);
    expect(h1.getAttribute('dir')).toBe('auto');
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('preview-frame').textContent).toContain(xss);
  });
});

describe('Content editor: explicit saves, read-only, errors and leaving', () => {
  it('published: no autosave; "Save changes" PATCHes and shows the "Changes saved" toast', async () => {
    setup({ element: <ContentEditor item={item({ status: 'published' })} /> });
    expect(screen.getByText('Published')).toBeTruthy();
    type(title(), 'Live edit');
    await advance(AUTOSAVE_DELAY_MS * 3);
    expect(writes()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await until(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ method: 'PATCH', path: `/v1/content/${ID}`, body: { title: 'Live edit' } });
    await until(() => expect(screen.getByText('Changes saved')).toBeTruthy());
  });

  it('archived: read-only with a note and no save button', () => {
    setup({ element: <ContentEditor item={item({ status: 'archived', archived_from: 'draft' })} /> });
    expect(screen.getByText(/This item is archived/)).toBeTruthy();
    expect(title().matches(':disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: /Save/ })).toBeNull();
  });

  it('submitting with errors shows a focused summary in the active language whose links focus each field', async () => {
    setup({ locale: 'ar', element: <ContentEditor item={item({ status: 'published' })} /> });
    const arTitle = screen.getByRole('textbox', { name: 'العنوان' });
    type(arTitle, '');
    type(screen.getByRole('textbox', { name: 'نص الزر' }), 'x'.repeat(41));
    fireEvent.click(screen.getByRole('button', { name: 'حفظ التغييرات' }));
    await until(() => expect(document.activeElement?.getAttribute('data-slot')).toBe('error-summary'));
    const summary = document.activeElement as HTMLElement;
    expect(summary.getAttribute('role')).toBe('alert');
    expect(summary.textContent).toContain('صحّح هذي عشان تقدر تحفظ');
    const links = Array.from(summary.querySelectorAll('a'));
    expect(links.map((a) => a.textContent)).toEqual(['اكتب عنوانًا', 'خلّ نص الزر 40 حرفًا أو أقل']);
    fireEvent.click(links[1]!);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'نص الزر' }));
    expect(arTitle.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(arTitle.getAttribute('aria-describedby')!)!.textContent).toBe('اكتب عنوانًا');
    expect(writes()).toEqual([]);
  });

  it('asks before leaving through an in-app link with unsaved changes; Leave navigates, and reload is guarded', async () => {
    setup({ element: <ContentEditor item={item({ status: 'published' })} /> });
    const back = screen.getByRole('link', { name: /Back to Videos & Stories/ });

    // Clean: no prompt.
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    type(title(), 'Unsaved');
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    fireEvent.click(back);
    expect(dialog.current()?.title).toBe('Leave without saving?');
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    await until(() => expect(push).toHaveBeenCalledWith('/content'));
  });

  it('below lg the preview toggle shows and hides the preview', () => {
    setup({ element: <ContentEditor item={item()} /> });
    const toggle = screen.getByRole('button', { name: 'Preview' });
    const aside = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(aside.className).toContain('hidden');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(aside.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    expect(document.getElementById('content-editor-form')!.className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(screen.getByText('Live preview arrives soon')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to editing' }));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('Content editor page (/content/[id])', () => {
  it('another store\'s or a deleted id shows the not-found state', async () => {
    handler = () => problem(404, { code: 'content_not_found' });
    setup({ element: <ContentEditorPage id={ID} /> });
    await until(() => expect(screen.getByTestId('content-not-found')).toBeTruthy());
    expect(screen.getByText("We couldn't find this item")).toBeTruthy();
  });

  it('a load failure shows an inline error with Retry', async () => {
    handler = () => problem(500);
    setup({ element: <ContentEditorPage id={ID} /> });
    await until(() => expect(screen.getByTestId('content-load-error')).toBeTruthy(), 400);
    handler = echo();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await until(() => expect(title().value).toBe('Autumn perfumes'));
  });
});

describe('Content editor: product picker (Story 3.4)', () => {
  const P1 = '019a473a-0000-7000-8000-0000000000a1';
  const P2 = '019a473a-0000-7000-8000-0000000000a2';
  const P3 = '019a473a-0000-7000-8000-0000000000a3';
  const row = (id: string, name: string, over: Partial<ProductRow> = {}): ProductRow => ({
    id,
    external_id: id.slice(-2),
    name,
    image_url: null,
    category_name: null,
    more_categories: 0,
    price_minor: 15000,
    sale_price_minor: null,
    currency: 'SAR',
    tax_inclusive: true,
    availability: 'available',
    has_required_options: false,
    linked_content_count: 0,
    attributed_orders: null,
    ...over,
  });
  const CATALOG = [row(P1, 'Oud oil'), row(P2, 'Oud wood', { availability: 'out_of_stock' }), row(P3, 'Musk', { has_required_options: true })];
  const summary = (r: ProductRow, deleted = false): ContentProductSummary => ({
    id: r.id,
    name: r.name,
    image_url: r.image_url,
    price_minor: r.price_minor,
    sale_price_minor: r.sale_price_minor,
    currency: r.currency,
    availability: r.availability,
    has_required_options: r.has_required_options,
    deleted,
  });

  /** Echo server plus `GET /v1/products` search over CATALOG; a PATCHed `product_id` answers with its summary. */
  function catalogServer(start: ContentItem, opts: { failSearch?: () => boolean } = {}): Handler {
    const base = echo(start);
    return async (call) => {
      if (call.method === 'GET' && call.path.startsWith('/v1/products')) {
        if (opts.failSearch?.()) return problem(500);
        const q = new URL(call.path, 'http://x').searchParams.get('q') ?? '';
        const items = CATALOG.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
        return json({ v: 1, items, total: items.length, page: 1, page_size: 10 });
      }
      const res = await base(call);
      if (call.method !== 'PATCH' || !call.body || !('product_id' in (call.body as object))) return res;
      const saved = (await res.json()) as ContentItem & { product_id?: string | null };
      const id = saved.product_id ?? null;
      delete saved.product_id;
      const linked = CATALOG.find((p) => p.id === id);
      return json({ ...saved, product: linked ? summary(linked) : null });
    };
  }
  const picker = () => screen.getByRole('combobox', { name: 'Product' }) as HTMLInputElement;
  const searches = () => calls.filter((c) => c.method === 'GET' && c.path.startsWith('/v1/products'));

  it('keyboard: type, ArrowDown x2, Enter links the second match; focus stays on the input; the Draft autosaves the link', async () => {
    handler = catalogServer(item());
    setup({ element: <ContentEditor item={item()} /> });
    const input = picker();
    input.focus();
    type(input, 'oud');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    await advance(200);
    expect(searches().filter((c) => c.path.includes('q=oud'))).toHaveLength(0);
    await until(() => expect(screen.getAllByRole('option')).toHaveLength(2));
    expect(searches().at(-1)!.path).toBe('/v1/products?q=oud&page_size=10');
    const options = screen.getAllByRole('option');
    expect(options[1]!.textContent).toContain('Oud wood');
    expect(options[1]!.textContent).toContain('Out of stock');
    expect(options[1]!.querySelector('[dir="auto"]')!.textContent).toBe('Oud wood');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(options[1]!.id);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('linked-product').textContent).toContain('Oud wood');

    await until(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ method: 'PATCH', path: `/v1/content/${ID}`, body: { product_id: P2 } });
    await until(() => expect(screen.getByRole('status', { name: '' }).textContent).toContain('Saved'));
    // Out of stock: linked anyway, with the warning.
    expect(screen.getByText('This product is out of stock')).toBeTruthy();
  });

  it('Escape closes the list and keeps the typed text; no match says so', async () => {
    handler = catalogServer(item());
    setup({ element: <ContentEditor item={item()} /> });
    const input = picker();
    input.focus();
    type(input, 'zzz');
    await until(() => expect(screen.getByText('No products match')).toBeTruthy());
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.value).toBe('zzz');
    await advance(AUTOSAVE_DELAY_MS * 2);
    expect(writes()).toEqual([]);
  });

  it('a failed search shows an inline Retry that searches again', async () => {
    let fail = true;
    handler = catalogServer(item(), { failSearch: () => fail });
    setup({ element: <ContentEditor item={item()} /> });
    const input = picker();
    input.focus();
    type(input, 'musk');
    await until(() => expect(screen.getByText("We couldn't load your products.")).toBeTruthy());
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await until(() => expect(screen.getByRole('option', { name: /Musk/ })).toBeTruthy());
  });

  it('a 422 product-not-linkable puts back the saved link, so later edits do not resend the rejected product', async () => {
    const base = catalogServer(item());
    handler = async (call) =>
      call.method === 'PATCH' && call.body && 'product_id' in (call.body as object)
        ? problem(422, { type: 'product-not-linkable', code: 'product_not_linkable' })
        : base(call);
    setup({ element: <ContentEditor item={item()} /> });
    const input = picker();
    input.focus();
    type(input, 'oud');
    await until(() => expect(screen.getAllByRole('option')).toHaveLength(2));
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    await until(() => expect(writes()).toHaveLength(1));
    await until(() => expect(screen.queryByTestId('linked-product')).toBeNull());

    type(title(), 'Autumn perfumes 2');
    await until(() => expect(writes()).toHaveLength(2));
    expect(writes()[1]).toEqual({ method: 'PATCH', path: `/v1/content/${ID}`, body: { title: 'Autumn perfumes 2' } });
  });

  it('Remove unlinks: one PATCH with product_id null', async () => {
    const linked = item({ product: summary(CATALOG[0]!) });
    handler = catalogServer(linked);
    setup({ element: <ContentEditor item={linked} /> });
    expect(screen.getByTestId('linked-product').textContent).toContain('Oud oil');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByTestId('linked-product')).toBeNull();
    expect(document.activeElement).toBe(picker());
    await until(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ method: 'PATCH', path: `/v1/content/${ID}`, body: { product_id: null } });
  });

  it('a product with required options makes the add-to-cart preview read "View options" with a note', async () => {
    const linked = item({ product: summary(CATALOG[2]!) });
    handler = catalogServer(linked);
    setup({ element: <ContentEditor item={linked} /> });
    expect(screen.getByTestId('preview-cta').textContent).toBe('View options');
    expect(screen.getByText(/options shoppers must choose/)).toBeTruthy();
    await chooseAction('Open product');
    await until(() => expect(screen.getByTestId('preview-cta').textContent).toBe('Add to cart'));
  });

  it('a deleted linked product shows the warning with "Pick another product", which opens the picker', async () => {
    const linked = item({ product: summary(CATALOG[0]!, true) });
    handler = catalogServer(linked);
    setup({ element: <ContentEditor item={linked} /> });
    expect(screen.getByText('The linked product was deleted in your store')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pick another product' }));
    expect(document.activeElement).toBe(picker());
    expect(picker().getAttribute('aria-expanded')).toBe('true');
    await until(() => expect(screen.getAllByRole('option')).toHaveLength(3));
  });

  it('published items link through "Save changes", not autosave; Arabic labels the picker', async () => {
    const published = item({ status: 'published' });
    handler = catalogServer(published);
    setup({ locale: 'ar', element: <ContentEditor item={published} /> });
    const input = screen.getByRole('combobox', { name: 'المنتج' }) as HTMLInputElement;
    input.focus();
    type(input, 'Musk');
    await until(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    await advance(AUTOSAVE_DELAY_MS * 2);
    expect(writes()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'حفظ التغييرات' }));
    await until(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.body).toEqual({ product_id: P3 });
  });
});
