'use client';

import { useI18n } from '../../i18n/provider';
import { Icon } from '../shell/Icon';
import { useSession } from './SessionProvider';

/** "Open in Salla" (direct-link sessions) and "Sign out" (both modes). Renders nothing when signed out. */
export function SessionActions() {
  const session = useSession();
  const { messages } = useI18n();
  if (!session || session.state.status !== 'signed-in') return null;
  const m = messages.session;
  const { openInPlatformUrl } = session.state;
  return (
    <>
      {openInPlatformUrl ? (
        <a href={openInPlatformUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1.5 rounded-pill px-3 text-small font-medium text-info-text hover:bg-secondary">
          {m.openInSalla}
          <Icon name="external" className="size-4" />
        </a>
      ) : null}
      <button type="button" onClick={() => void session.client.signOut()} className="inline-flex min-h-9 items-center rounded-pill px-3 text-small font-medium text-muted-foreground hover:bg-secondary">
        {m.signOut}
      </button>
    </>
  );
}
