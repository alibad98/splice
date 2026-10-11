import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppShell } from './AppShell';
import { Icon, iconMirrors } from './Icon';
import { isActive } from './NavList';
import { I18nProvider } from '../../i18n/provider';
import { getMessages } from '../../i18n/messages';

vi.mock('next/navigation', () => ({ usePathname: () => '/products', useSearchParams: () => new URLSearchParams('lang=en&x=1') }));

const render = (locale: 'ar' | 'en', connection: { state: 'not-connected' } | { state: 'connected'; storeName: string } = { state: 'not-connected' }) =>
  renderToStaticMarkup(
    <I18nProvider locale={locale} messages={getMessages(locale)}>
      <AppShell locale={locale} messages={getMessages(locale)} context={{ connection }}>
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
  it('keeps ?lang on nav links, the chip and the switch, and does not set title on expanded labels', () => {
    expect(html).toContain('href="/content?lang=en"');
    expect(html).toContain('href="/settings?tab=connection&amp;lang=en"');
    expect(html).toContain('href="/products?x=1&amp;lang=en"');
    expect(html).toMatch(/<a[^>]*title="المنتجات"/); // collapsed (icon-only) nav keeps a title
    expect(html).toMatch(/<nav[^>]*>(?:(?!<\/nav>).)*<span class="">المنتجات<\/span>/s);
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
