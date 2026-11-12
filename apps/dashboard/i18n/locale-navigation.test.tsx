// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { LocaleNavigationSync } from './LocaleNavigationSync';
import { I18nProvider, useI18n } from './provider';
import { getMessages } from './messages';
import type { Locale } from './config';

const navigation = vi.hoisted(() => ({ params: new URLSearchParams('lang=en'), router: { refresh: vi.fn() } }));
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  useSearchParams: () => navigation.params,
}));

function Label() { return <span>{useI18n().messages.shell.switchTo}</span>; }
const tree = (locale: Locale) => (
  <I18nProvider locale={locale} messages={getMessages(locale)}>
    <LocaleNavigationSync /><Label />
  </I18nProvider>
);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.documentElement.removeAttribute('lang');
  document.documentElement.removeAttribute('dir');
});

describe('language navigation', () => {
  it('refreshes reused layouts after a query-only language change and synchronizes document language and direction', () => {
    navigation.params = new URLSearchParams('lang=en&tab=connection');
    const view = render(tree('en'));
    expect(navigation.router.refresh).not.toHaveBeenCalled();
    expect(document.documentElement.dir).toBe('ltr');

    navigation.params = new URLSearchParams('lang=ar&tab=connection');
    view.rerender(tree('en'));
    expect(navigation.router.refresh).toHaveBeenCalledOnce();
    // The refreshed RSC payload supplies the new server locale without a document reload.
    view.rerender(tree('ar'));
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(view.container.textContent).toBe(getMessages('ar').shell.switchTo);
    expect(navigation.router.refresh).toHaveBeenCalledOnce();

    // Browser Back/Forward can change the language just like the switch.
    navigation.params = new URLSearchParams('lang=en&tab=connection');
    view.rerender(tree('ar'));
    expect(navigation.router.refresh).toHaveBeenCalledTimes(2);
    view.rerender(tree('en'));
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it.each(['', 'lang=invalid'])('does not refresh for missing or invalid language (%s)', query => {
    navigation.params = new URLSearchParams(query);
    render(tree('ar'));
    expect(navigation.router.refresh).not.toHaveBeenCalled();
    expect(document.documentElement.dir).toBe('rtl');
  });
});
