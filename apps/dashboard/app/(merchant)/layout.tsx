import type { ReactNode } from 'react';
import { AppShell } from '../../components/shell/AppShell';
import { getMessages } from '../../i18n/messages';
import { getLocale } from '../../i18n/server';
import { getShellContext } from '../../lib/shell';

export default async function MerchantLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <AppShell locale={locale} messages={getMessages(locale)} context={await getShellContext()}>
      {children}
    </AppShell>
  );
}
