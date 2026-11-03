import type { ConnectionStatus, SessionInfo } from '@slips/contracts';

/** The store connection as the shell sees it: drives the chip, the shown store name and (Story 2.7) the disconnected banner. `disconnected`: the store lost platform access; the chip shows it like `not-connected`, but the banner appears and the store name stays. */
export type ShellConnection = { state: 'connected'; storeName: string } | { state: 'disconnected'; storeName?: string } | { state: 'not-connected' };

export interface ShellContext {
  connection: ShellConnection;
  /** Server-side view of the cookie session; absent in tests and before sign-in. */
  session?: { kind: 'signed-in'; info: SessionInfo } | { kind: 'expired' } | { kind: 'none' };
  /** The navigation is for an iframe (embedded): the browser signs in with the host token. */
  framed?: boolean;
  /** Storefront URL for "Preview store"; absent until a store is connected. */
  storeUrl?: string;
}

/** Chip state for an API `ConnectionStatus` (Story 1.8). A disconnected store keeps its own state, for the banner (Story 2.7). */
export function connectionFromStatus(status: ConnectionStatus): ShellConnection {
  if (status.state === 'disconnected') return status.store_name ? { state: 'disconnected', storeName: status.store_name } : { state: 'disconnected' };
  return status.state === 'connected' && status.store_name ? { state: 'connected', storeName: status.store_name } : { state: 'not-connected' };
}

// TODO(support): replace with the real support channel when one exists.
export const SUPPORT_EMAIL = 'support@slips.app';
export const SUPPORT_HREF = `mailto:${SUPPORT_EMAIL}`;
export const CONNECTION_HREF = '/settings?tab=connection';
