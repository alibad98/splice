import type { ConnectionStatus } from '@slips/contracts';

/** Connection state shown by the shell chip. */
export type ShellConnection = { state: 'connected'; storeName: string } | { state: 'not-connected' };

export interface ShellContext {
  connection: ShellConnection;
  /** Storefront URL for "Preview store"; absent until a store is connected. */
  storeUrl?: string;
}

/** Chip state for an API `ConnectionStatus` (Story 1.8). A disconnected store shows the same warning as no store. */
export function connectionFromStatus(status: ConnectionStatus): ShellConnection {
  return status.state === 'connected' && status.store_name ? { state: 'connected', storeName: status.store_name } : { state: 'not-connected' };
}

// DEFERRED(Story 1.9): the store behind the request comes from the merchant session, which does not exist yet,
// so this stays not-connected until 1.9 fetches the API's ConnectionStatus for the signed-in store and maps it
// with connectionFromStatus(). The API side (IntegrationService.getConnection) is ready.
export async function getShellContext(): Promise<ShellContext> {
  return { connection: { state: 'not-connected' } };
}

// TODO(support): replace with the real support channel when one exists.
export const SUPPORT_EMAIL = 'support@slips.app';
export const SUPPORT_HREF = `mailto:${SUPPORT_EMAIL}`;
export const CONNECTION_HREF = '/settings?tab=connection';
