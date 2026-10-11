/** Connection state shown by the shell chip. Real data arrives with Story 1.8 (Salla OAuth). */
export type ShellConnection = { state: 'connected'; storeName: string } | { state: 'not-connected' };

export interface ShellContext {
  connection: ShellConnection;
  /** Storefront URL for "Preview store"; absent until a store is connected. */
  storeUrl?: string;
}

// Placeholder until Story 1.8 supplies the merchant session; always not-connected.
export async function getShellContext(): Promise<ShellContext> {
  return { connection: { state: 'not-connected' } };
}

// TODO(support): replace with the real support channel when one exists.
export const SUPPORT_HREF = 'mailto:support@slips.app';
export const CONNECTION_HREF = '/settings?tab=connection';
