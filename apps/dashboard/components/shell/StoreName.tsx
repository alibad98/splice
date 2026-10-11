'use client';

import { useSession } from '../session/SessionProvider';

/** The store's name from the live session, else the server-provided name. */
export function StoreName({ initial }: { initial: string }) {
  const session = useSession();
  const live = session?.state.status === 'signed-in' && session.state.storeName ? session.state.storeName : initial;
  return <span className="truncate text-body font-bold">{live}</span>;
}
