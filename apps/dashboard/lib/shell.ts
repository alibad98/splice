import type { ConnectionStatus, SessionInfo } from '@slips/contracts';

/** Connection state shown by the shell chip. */
export type ShellConnection = { state: 'connected'; storeName: string } | { state: 'not-connected' };

export interface ShellContext {
  connection: ShellConnection;
  /** Server-side view of the cookie session; absent in tests and before sign-in. */
  session?: { kind: 'signed-in'; info: SessionInfo } | { kind: 'expired' } | { kind: 'none' };
  /** The navigation is for an iframe (embedded): the browser signs in with the host token. */
  framed?: boolean;
  /** Storefront URL for "Preview store"; absent until a store is connected. */
  storeUrl?: string;
}

/** Chip state for an API `ConnectionStatus` (Story 1.8). A disconnected store shows the same warning as no store. */
export function connectionFromStatus(status: ConnectionStatus): ShellConnection {
  return status.state === 'connected' && status.store_name ? { state: 'connected', storeName: status.store_name } : { state: 'not-connected' };
}

// TODO(support): replace with the real support channel when one exists.
export const SUPPORT_EMAIL = 'support@slips.app';
export const SUPPORT_HREF = `mailto:${SUPPORT_EMAIL}`;
export const CONNECTION_HREF = '/settings?tab=connection';
