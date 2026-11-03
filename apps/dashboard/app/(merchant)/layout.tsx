import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { DialogHost, SIDEBAR_COOKIE, sidebarOpenFromCookie, Toaster } from '@slips/ui';
import { AppShell } from '../../components/shell/AppShell';
import { SessionProvider } from '../../components/session/SessionProvider';
import { DataProviders } from '../../components/providers/DataProviders';
import { directionOf, withLang } from '../../i18n/config';
import { getMessages } from '../../i18n/messages';
import { getLocale } from '../../i18n/server';
import { getShellContext } from '../../lib/shell-context';
import { publicApiUrl } from '../../lib/session/server';

export default async function MerchantLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const context = await getShellContext();

  // If a direct-link (unframed) navigation has no active merchant session, send them to the auth layout
  if (!context.framed && context.session?.kind !== 'signed-in') {
    redirect(withLang('/login', locale));
  }

  const apiBase = publicApiUrl();
  const messages = getMessages(locale);
  const sidebarOpen = sidebarOpenFromCookie((await cookies()).get(SIDEBAR_COOKIE)?.value);
  return (
    <SessionProvider
      apiBase={apiBase}
      signInHref={`${apiBase.replace(/\/+$/, '')}/v1/integrations/salla/install`}
      initial={context.session ?? { kind: 'none' }}
      framed={context.framed ?? false}
    >
      <DataProviders>
        <AppShell locale={locale} messages={messages} context={context} sidebarOpen={sidebarOpen}>
          {children}
        </AppShell>
        {/* Mounted once, empty, so every toast is announced (EXPERIENCE.md). */}
        <Toaster label={messages.toast.region} toastLabel={messages.toast.item} closeLabel={messages.toast.close} dir={directionOf(locale)} />
        {/* Mounted once; dialog.confirm() renders here (sign out, destructive confirms). */}
        <DialogHost dir={directionOf(locale)} />
      </DataProviders>
    </SessionProvider>
  );
}
