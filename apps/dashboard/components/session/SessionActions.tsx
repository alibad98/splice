'use client';

import { dialog, Icon as KitIcon, SidebarMenuButton, SidebarMenuItem } from '@slips/ui';
import { useI18n } from '../../i18n/provider';
import { Icon } from '../shell/Icon';
import { useSession } from './SessionProvider';

/** "Open in Salla" (direct-link sessions), in the header. Renders nothing when signed out. */
export function SessionActions() {
  const session = useSession();
  const { messages } = useI18n();
  if (!session || session.state.status !== 'signed-in') return null;
  const { openInPlatformUrl } = session.state;
  if (!openInPlatformUrl) return null;
  return (
    <a href={openInPlatformUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1.5 rounded-pill px-3 text-small font-medium text-info-text hover:bg-secondary">
      {messages.session.openInSalla}
      <Icon name="external" className="size-4" />
    </a>
  );
}

/** "Sign out" at the foot of the sidebar (both modes), behind a confirm. Renders nothing when signed out. */
export function SignOutMenuItem() {
  const session = useSession();
  const { messages } = useI18n();
  if (!session || session.state.status !== 'signed-in') return null;
  const m = messages.session;
  const ask = () =>
    void dialog.confirm({
      tone: 'danger',
      icon: 'logout',
      title: m.signOutTitle,
      description: m.signOutBody,
      confirmLabel: m.signOutConfirm,
      cancelLabel: m.signOutCancel,
      // signOut() always ends signed out (even if the API call fails), so the dialog closes either way.
      onConfirm: () => session.client.signOut().catch(() => undefined),
    });
  return (
    <SidebarMenuItem>
      <SidebarMenuButton tone="danger" tooltip={m.signOut} onClick={ask} aria-haspopup="dialog">
        <KitIcon name="logout" />
        <span>{m.signOut}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
