import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { AppShell } from '../../components/shell/AppShell';
import { SessionProvider } from '../../components/session/SessionProvider';
import { withLang } from '../../i18n/config';
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
  return (
    <SessionProvider
      apiBase={apiBase}
      signInHref={`${apiBase.replace(/\/+$/, '')}/v1/integrations/salla/install`}
      initial={context.session ?? { kind: 'none' }}
      framed={context.framed ?? false}
    >
      <AppShell locale={locale} messages={getMessages(locale)} context={context}>
        {children}
      </AppShell>
    </SessionProvider>
  );
}
