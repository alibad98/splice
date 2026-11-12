import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppShell } from './AppShell';
import { Icon, iconMirrors } from './Icon';
import { isActive } from './NavList';
import { I18nProvider } from '../../i18n/provider';
import { getMessages } from '../../i18n/messages';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ConnectionStatus } from '@slips/contracts';
import { SessionProvider } from '../session/SessionProvider';
import { queryKeys } from '../../lib/api/query-keys';

vi.mock('next/navigation', () => ({ usePathname: () => '/products', useSearchParams: () => new URLSearchParams('lang=en&x=1') }));

const render = (locale: 'ar' | 'en', connection: { state: 'not-connected' } | { state: 'connected'; storeName: string } = { state: 'not-connected' }, sidebarOpen = true) =>
  renderToStaticMarkup(
    <I18nProvider locale={locale} messages={getMessages(locale)}>
      <AppShell locale={locale} messages={getMessages(locale)} context={{ connection }} sidebarOpen={sidebarOpen}>
        <p>body</p>
      </AppShell>
    </I18nProvider>,
  );

describe('app shell', () => {
  const html = render('ar');
  it('puts the skip link first and targets main', () => {
    expect(html.indexOf('<a')).toBe(html.indexOf('href="#main-content"') - 3);
    expect(html).toContain('id="main-content"');
  });
  it('shows nav, active pill, settings at the bottom, chip and help', () => {
    for (const label of ['نظرة عامة', 'الفيديوهات والستوريز', 'المنتجات', 'التحليلات', 'الإعدادات']) expect(html).toContain(label);
    expect(html.indexOf('الإعدادات')).toBeGreaterThan(html.indexOf('التحليلات'));
    expect(html).toMatch(/aria-current="page"[^>]*href="\/products\?lang=en"/);
    expect(html).toContain('غير متصل بسلة');
    expect(html).toContain('href="/settings?tab=connection&amp;lang=en"');
    expect(html).toContain('تحتاج مساعدة؟ تواصل مع الدعم');
    expect(html).toContain('معاينة المتجر');
  });
  it('renders connected state and English copy', () => {
    const en = render('en', { state: 'connected', storeName: 'Demo' });
    expect(en).toContain('Connected to Salla');
    expect(en).toContain('Demo');
    expect(en).toContain('Need help? Contact support');
  });
  it('keeps ?lang on nav links, the chip and the switch', () => {
    expect(html).toContain('href="/content?lang=en"');
    expect(html).toContain('href="/settings?tab=connection&amp;lang=en"');
    expect(html).toContain('href="/products?x=1&amp;lang=en"');
  });
  it('pins a collapsible sidebar to the viewport edge and caps only the content', () => {
    // No centred max-width wrapper around the sidebar (the old layout shift on wide screens).
    expect(html).not.toContain('max-w-[1360px]');
    expect(html).toMatch(/data-slot="sidebar-container" class="fixed inset-y-0 start-0/);
    expect(html).toContain('max-w-[1200px]');
    expect(html).toContain('data-state="expanded"');
    expect(html).toContain('aria-label="طيّ القائمة أو توسيعها (Ctrl+B)"');
    // Collapsed (from the cookie) renders the icon rail on the server; labels stay in the DOM so links keep their names.
    const collapsed = render('ar', { state: 'not-connected' }, false);
    expect(collapsed).toContain('data-collapsible="icon"');
    expect(collapsed).toMatch(/<a[^>]*aria-current="page"[^>]*>(?:(?!<\/a>).)*<span>المنتجات<\/span>/s);
  });
  it('mailto support link has no target and the disabled preview is described by a reason', () => {
    expect(html).toMatch(/<a href="mailto:support@slips.app" class=/);
    expect(html).toContain('aria-describedby="preview-reason"');
    expect(html).toContain('id="preview-reason"');
  });
  it('matches active routes', () => {
    expect(isActive('/', '/')).toBe(true);
    expect(isActive('/products/1', '/products')).toBe(true);
    expect(isActive('/products', '/')).toBe(false);
  });
});

describe('icons', () => {
  it('mirrors directional icons in RTL only and never media icons', () => {
    expect(iconMirrors('chevron')).toBe(true);
    expect(iconMirrors('arrow')).toBe(true);
    expect(iconMirrors('play')).toBe(false);
    expect(iconMirrors('pause')).toBe(false);
    expect(renderToStaticMarkup(<Icon name="chevron" />)).toContain('rtl:-scale-x-100');
    expect(renderToStaticMarkup(<Icon name="play" />)).not.toContain('rtl:');
  });
});

describe('disconnected banner (Story 2.7)', () => {
  const INSTALL = 'https://api.example.com/v1/integrations/salla/install';
  const info = (connection: ConnectionStatus) => ({ v: 1 as const, mode: 'direct' as const, store: { name: 'Demo Store', domains: [] }, connection, expires_at: '2030-01-01T00:00:00.000Z', csrf_token: 'c' });
  const renderSignedIn = (locale: 'ar' | 'en', connection: ConnectionStatus, sync: number | 'none' | 'error' = 2) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    if (typeof sync === 'number') client.setQueryData(queryKeys.catalog.sync(), { v: 1, status: 'failed', run_id: null, reason: 'store_inactive', last_synced_at: new Date(Date.now() - sync * 3600_000).toISOString() });
    if (sync === 'error') client.getQueryCache().build(client, { queryKey: queryKeys.catalog.sync() }).setState({ status: 'error', error: new Error('down'), data: undefined });
    return renderToStaticMarkup(
      <I18nProvider locale={locale} messages={getMessages(locale)}>
        <QueryClientProvider client={client}>
          <SessionProvider apiBase="https://api.example.com" signInHref={INSTALL} initial={{ kind: 'signed-in', info: info(connection) }} framed={false}>
            <AppShell locale={locale} messages={getMessages(locale)} context={{ connection: { state: 'not-connected' } }}>
              <p>page body</p>
            </AppShell>
          </SessionProvider>
        </QueryClientProvider>
      </I18nProvider>,
    );
  };
  const banner = (html: string) => html.match(/<div data-slot="banner"[\s\S]*?<\/main>/)?.[0] ?? '';

  it('disconnected (English): danger banner with the copy, the last sync time and Reconnect to the install URL, above the page', () => {
    const html = renderSignedIn('en', { v: 1, state: 'disconnected', store_name: 'Demo Store' });
    expect(html).toContain('data-testid="disconnected-banner"');
    expect(html).toContain('data-tone="danger"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Your Salla connection dropped, so syncing paused. Reconnect to continue.');
    expect(html).toContain('Last synced 2 hours ago');
    expect(banner(html)).toContain(`<a href="${INSTALL}"`);
    expect(banner(html)).toMatch(/>Reconnect<\/a>/);
    expect(html.indexOf('disconnected-banner')).toBeLessThan(html.indexOf('page body'));
    expect(html).toContain('page body');
    // The chip keeps its not-connected look; the store name stays.
    expect(html).toContain('Not connected to Salla');
    expect(html).toContain('Demo Store');
  });

  it('disconnected (Arabic): Arabic copy with Western digits and the Reconnect link; the page still renders', () => {
    const html = renderSignedIn('ar', { v: 1, state: 'disconnected', store_name: 'Demo Store' }, 3);
    expect(html).toContain('انقطع الاتصال بسلة، فتوقفت المزامنة. أعد الربط لتكمل.');
    expect(html).toContain('آخر مزامنة قبل 3 ساعات');
    expect(html).not.toMatch(/[٠-٩]/);
    expect(banner(html)).toContain(`<a href="${INSTALL}"`);
    expect(html).toContain('أعد الربط</a>');
    expect(html).toContain('page body');
  });

  it('no sync time, or the sync status failed to load: the banner shows without a time', () => {
    for (const sync of ['none', 'error'] as const) {
      const html = renderSignedIn('en', { v: 1, state: 'disconnected', store_name: 'Demo Store' }, sync);
      expect(html).toContain('Your Salla connection dropped');
      expect(html).not.toContain('Last synced');
    }
  });

  it('connected or not connected: no banner', () => {
    expect(renderSignedIn('en', { v: 1, state: 'connected', store_name: 'Demo Store' })).not.toContain('disconnected-banner');
    expect(renderSignedIn('en', { v: 1, state: 'not_connected' })).not.toContain('disconnected-banner');
    // Outside a session (tests, /admin) there is nothing to show either.
    expect(render('en')).not.toContain('disconnected-banner');
  });
});
