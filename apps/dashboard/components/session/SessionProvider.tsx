'use client';

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { sallaHost } from '../../lib/embedded/host';
import { SessionClient, stateFromInfo, type SessionState } from '../../lib/session/session-client';
import type { SessionInfo } from '@slips/contracts';

interface SessionContextValue {
  client: SessionClient;
  state: SessionState;
  /** Where "Sign in with Salla" starts the OAuth flow. */
  signInHref: string;
}

const Ctx = createContext<SessionContextValue | null>(null);

export type InitialSession = { kind: 'signed-in'; info: SessionInfo } | { kind: 'expired' } | { kind: 'none' };

interface Props {
  apiBase: string;
  signInHref: string;
  initial: InitialSession;
  /** The navigation is for an iframe, so show a loading state instead of the sign-in card. */
  framed: boolean;
  children: ReactNode;
}

export function SessionProvider({ apiBase, signInHref, initial, framed, children }: Props) {
  const client = useMemo(
    () =>
      new SessionClient(
        { apiBase, host: sallaHost },
        initial.kind === 'signed-in' ? stateFromInfo(initial.info) : framed ? { status: 'loading' } : { status: 'signed-out', reason: initial.kind === 'expired' ? 'expired' : 'none' },
      ),
    // The client is created once per mount; props only seed it.
    [],
  );
  const state = useSyncExternalStore(client.subscribe, client.getState, client.getState);
  useEffect(() => {
    void client.start();
    return () => client.stop();
  }, [client]);
  const value = useMemo(() => ({ client, state, signInHref }), [client, state, signInHref]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The live session, or null outside a provider (tests, /admin). */
export function useSession(): SessionContextValue | null {
  return useContext(Ctx);
}
