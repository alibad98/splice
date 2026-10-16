// StoreInstallListener port: modules that react to a store being installed or re-authorised register one, so the
// integration module can notify them without knowing their tables. Runs after the install has committed, on both
// install paths: the Easy Mode `app.store.authorize` webhook (the production path) and the OAuth callback.
import type { Pool } from 'pg';
import type { MerchantProfile } from './commerce-platform.js';

export interface StoreInstalledEvent {
  storeId: string;
  /** True for a brand-new store; false for a reinstall or a token re-authorisation. */
  created: boolean;
  profile: MerchantProfile;
}

export interface StoreInstallListener {
  /** Unique name, used in error reports. */
  readonly name: string;
  /** Must be idempotent: Salla re-sends `app.store.authorize` on every re-authorisation. A failure is reported, never fails the install. */
  onInstalled(pool: Pool, event: StoreInstalledEvent): Promise<void>;
}

export const STORE_INSTALL_LISTENERS = Symbol('STORE_INSTALL_LISTENERS');
