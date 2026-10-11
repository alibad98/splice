import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppShell } from '../shell/AppShell';
import { I18nProvider } from '../../i18n/provider';
import { getMessages } from '../../i18n/messages';
import { SessionProvider, type InitialSession } from './SessionProvider';

vi.mock('next/navigation', () => ({ usePathname: () => '/', useSearchParams: () => new URLSearchParams('') }));

const info = { v: 1 as const, mode: 'direct' as const, store: { name: 'Demo Store' }, connection: { v: 1 as const, state: 'connected' as const, store_name: 'Demo Store' }, expires_at: '2030-01-01T00:00:00.000Z', csrf_token: 'c', open_in_platform_url: 'https://s.example/embedded/app/a' };

const render = (locale: 'ar' | 'en', initial: InitialSession, framed = false) =>
  renderToStaticMarkup(
    <I18nProvider locale={locale} messages={getMessages(locale)}>
      <SessionProvider apiBase="https://api.example.com" signInHref="https://api.example.com/v1/integrations/salla/install" initial={initial} framed={framed}>
        <AppShell locale={locale} messages={getMessages(locale)} context={{ connection: { state: 'not-connected' } }}>
          <p>secret dashboard body</p>
        </AppShell>
      </SessionProvider>
    </I18nProvider>,
  );

describe('session gate and shell', () => {
  it('signed in (direct): shows the page, the live connection chip, Open in Salla and Sign out', () => {
    const html = render('en', { kind: 'signed-in', info });
    expect(html).toContain('secret dashboard body');
    expect(html).toContain('Connected to Salla');
    expect(html).toContain('Demo Store');
    expect(html).toContain('href="https://s.example/embedded/app/a"');
    expect(html).toContain('Open in Salla');
    expect(html).toContain('Sign out');
  });

  it('not signed in: hides the page and offers Sign in with Salla; the chip is not connected', () => {
    const html = render('en', { kind: 'none' });
    expect(html).not.toContain('secret dashboard body');
    expect(html).toContain('data-testid="sign-in"');
    expect(html).toContain('href="https://api.example.com/v1/integrations/salla/install"');
    expect(html).toContain('Not connected to Salla');
    expect(html).not.toContain('Sign out');
  });

  it('an idle-expired session returns to sign-in with friendly copy, in Arabic too', () => {
    expect(render('en', { kind: 'expired' })).toContain('Your session ended');
    const ar = render('ar', { kind: 'expired' });
    expect(ar).toContain('انتهت جلستك');
    expect(ar).not.toContain('secret dashboard body');
  });

  it('an embedded navigation shows a loading state, not the sign-in card, until the host token is traded', () => {
    const html = render('en', { kind: 'none' }, true);
    expect(html).toContain('Signing you in');
    expect(html).not.toContain('data-testid="sign-in"');
    expect(html).not.toContain('secret dashboard body');
  });
});
