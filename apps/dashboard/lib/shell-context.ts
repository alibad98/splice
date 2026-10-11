import { connectionFromStatus, type ShellConnection, type ShellContext } from './shell';
import { getServerSession, isFramedNavigation } from './session/server';

/**
 * Shell data for the request. A direct-link (cookie) session is resolved here on the server; an embedded session has
 * no cookie, so the chip starts as not connected and the browser fills it in once the bearer is minted (SessionProvider).
 */
export async function getShellContext(): Promise<ShellContext> {
  const session = await getServerSession();
  const framed = await isFramedNavigation();
  const connection: ShellConnection = session.kind === 'signed-in' ? connectionFromStatus(session.info.connection) : { state: 'not-connected' };
  return { connection, session, framed };
}
