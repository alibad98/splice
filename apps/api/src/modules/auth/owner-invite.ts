// Owner invite: when a store is installed, link it to the login for the owner's email. A new login (no password yet)
// gets an emailed one-time code to set one; an existing login simply gains the store, so an owner of several stores
// keeps one password. The password is for direct access outside Salla (and future integrations); inside Salla the
// embedded session needs none (AD-12).
import type { Mailer } from '../../ports/mailer.js';
import type { StoreInstallListener } from '../../ports/store-install-listener.js';
import type { Telemetry } from '../../ports/telemetry.js';
import { generateOtp, hashOtp } from './credentials.crypto.js';
import { LoginRepository } from './login.repository.js';

/** The invite arrives by email at install time and may be read later, so it outlives an ordinary 10-minute code. */
export const SETUP_OTP_TTL_MS = 72 * 3_600_000;

export function setupLink(dashboardUrl: string, email: string): string {
  const url = new URL('/verify-otp', dashboardUrl);
  url.searchParams.set('flow', 'setup');
  url.searchParams.set('email', email);
  return url.toString();
}

export function ownerInviteListener(deps: { mailer: Mailer; telemetry: Telemetry; dashboardUrl: string; now?: () => number }): StoreInstallListener {
  const now = deps.now ?? Date.now;
  return {
    name: 'auth.owner-invite',
    async onInstalled(pool, { storeId, profile }) {
      const email = profile.ownerEmail?.trim().toLowerCase();
      if (!email) return;
      // The link commits on its own: a failed email must not leave the store unlinked.
      const login = await LoginRepository.transaction(pool, async (repo) => {
        const found = await repo.ensure(email);
        await repo.linkStore(found.id, storeId);
        return found;
      });
      // Already has a password: the store is now one more it can open, nothing to send.
      if (login.passwordHash) return;
      await LoginRepository.transaction(pool, async (repo) => {
        // An invite still open: a re-authorisation must not spam the owner.
        const at = new Date(now());
        if (await repo.hasPendingOtp(login.id, 'setup', at)) return;
        const code = generateOtp();
        const expiresAt = new Date(at.getTime() + SETUP_OTP_TTL_MS);
        await repo.createOtp(login.id, 'setup', hashOtp(code), expiresAt, at);
        // Sent inside the transaction: if the mail fails the code is rolled back and the next authorize retries.
        await deps.mailer.sendOtp({ to: email, code, purpose: 'setup', expiresAt, link: setupLink(deps.dashboardUrl, email), ...(profile.storeName ? { storeName: profile.storeName } : {}) });
        deps.telemetry.log.info('owner setup invite sent', { store_id: storeId, login_id: login.id });
      });
    },
  };
}
