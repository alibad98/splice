'use client';

import { useSession } from '../session/SessionProvider';
import { LangLink } from './LangLink';
import { CONNECTION_HREF } from '../../lib/shell';
import type { ShellConnection } from '../../lib/shell';
import type { Messages } from '../../i18n/messages';

/** Status chip linking to Settings > Connection. Shows the live session's ConnectionStatus (Story 1.9); the prop is the server-rendered fallback. */
export function ConnectionChip({ connection: initial, messages }: { connection: ShellConnection; messages: Messages }) {
  const session = useSession();
  const connection = session?.state.status === 'signed-in' ? session.state.connection : session ? ({ state: 'not-connected' } as const) : initial;
  const connected = connection.state === 'connected';
  return (
    <LangLink
      href={CONNECTION_HREF}
      className={`inline-flex min-h-9 items-center gap-2 rounded-pill border px-3 text-small ${
        connected ? 'border-success-text/30 bg-success-tint text-success-text' : 'border-warning-text/30 bg-warning-tint text-warning-text'
      }`}
    >
      <span aria-hidden="true" className={`size-2 rounded-full ${connected ? 'bg-success' : 'bg-warning'}`} />
      {connected ? messages.shell.connection.connected : messages.shell.connection.notConnected}
    </LangLink>
  );
}
