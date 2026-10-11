import Link from 'next/link';
import { CONNECTION_HREF } from '../../lib/shell';
import type { ShellConnection } from '../../lib/shell';
import type { Messages } from '../../i18n/messages';

/** Status chip linking to Settings > Connection. Renders from a typed prop (real data: Story 1.8). */
export function ConnectionChip({ connection, messages }: { connection: ShellConnection; messages: Messages }) {
  const connected = connection.state === 'connected';
  return (
    <Link
      href={CONNECTION_HREF}
      className={`inline-flex min-h-9 items-center gap-2 rounded-pill border px-3 text-small ${
        connected ? 'border-success-text/30 bg-success-tint text-success-text' : 'border-warning-text/30 bg-warning-tint text-warning-text'
      }`}
    >
      <span aria-hidden="true" className={`size-2 rounded-full ${connected ? 'bg-success' : 'bg-warning'}`} />
      {connected ? messages.shell.connection.connected : messages.shell.connection.notConnected}
    </Link>
  );
}
