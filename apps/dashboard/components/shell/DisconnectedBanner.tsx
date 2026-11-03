'use client';

import { Banner } from '@slips/ui';
import { useI18n } from '../../i18n/provider';
import { formatRelativeTime } from '../../i18n/format';
import { useCatalogSync } from '../../lib/api/catalog';
import { useNow } from '../../lib/use-now';
import { useSession } from '../session/SessionProvider';
import { fill } from '../products/format';

/**
 * Story 2.7: a persistent danger banner on every merchant page while the store's platform connection is lost
 * (`disconnected`), with the last sync time and one Reconnect action (the install URL). Driven by the live session's
 * connection, so it is gone as soon as the session reports `connected`; never shown for a store that is not connected.
 */
export function DisconnectedBanner() {
  const session = useSession();
  if (!session || session.state.status !== 'signed-in' || session.state.connection.state !== 'disconnected') return null;
  return <DisconnectedBannerBody reconnectHref={session.signInHref} />;
}

function DisconnectedBannerBody({ reconnectHref }: { reconnectHref: string }) {
  const { locale, messages } = useI18n();
  const m = messages.shell.disconnected;
  const now = useNow();
  // A failed status read leaves the time out; the banner stays.
  const sync = useCatalogSync();
  const last = sync.data?.last_synced_at ? new Date(sync.data.last_synced_at) : null;
  return (
    <Banner tone="danger" action={{ label: m.reconnect, href: reconnectHref }} className="mb-6" data-testid="disconnected-banner">
      <p>{m.message}</p>
      {last ? (
        <p className="text-small font-normal text-muted-foreground">
          <time dateTime={sync.data!.last_synced_at!}>{fill(m.lastSynced, { time: formatRelativeTime(last, locale, now) })}</time>
        </p>
      ) : null}
    </Banner>
  );
}
