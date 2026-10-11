import type { ReactNode } from 'react';
import { AppShell } from '../../components/shell/AppShell';
import { SessionProvider } from '../../components/session/SessionProvider';
import { getMessages } from '../../i18n/messages';
import { getLocale } from '../../i18n/server';
import { getShellContext } from '../../lib/shell-context';
import { publicApiUrl } from '../../lib/session/server';

export default async function MerchantLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const context = await getShellContext();
  const apiBase = publicApiUrl();
  return (
    <SessionProvider apiBase={apiBase} signInHref={`${apiBase.replace(/\/+$/, '')}/v1/integrations/salla/install`} initial={context.session ?? { kind: 'none' }} framed={context.framed ?? false}>
      <AppShell locale={locale} messages={getMessages(locale)} context={context}>
        {children}
      </AppShell>
    </SessionProvider>
  );
}
