import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConnectionStatus } from '@slips/contracts';
import { runOutsideStoreContext, withStoreContext, type LifecycleState } from '@slips/db';
import type { Pool } from 'pg';
import { DB_POOL, EVENT_SENDER, INTEGRATION_CONFIG, type IntegrationConfig } from '../../infra.module.js';
import { publishEvent, uuidv7, type EventSender } from '../../events/outbox.js';
import {
  COMMERCE_PLATFORM,
  PlatformAuthRejectedError,
  PlatformUnavailableError,
  type CommercePlatform,
  type MerchantProfile,
  type TokenSet,
} from '../../ports/commerce-platform.js';
import { TELEMETRY, type Telemetry } from '../../ports/telemetry.js';
import { TOKEN_CIPHER, type TokenCipher } from '../../ports/token-cipher.js';
import { StoreDisconnectedError, StoreLifecycleConflictError, StoreNotConnectedError } from './errors.js';
import { createInstallState, verifyInstallState } from './install-state.js';
import { STORE_DATA_LIFECYCLES, type StoreDataLifecycle } from '../../ports/store-data-lifecycle.js';
import { integrationStoreData } from './integration.lifecycle.js';
import { IntegrationRepository } from './integration.repository.js';
import { lockStore, StoreLifecycle } from './store-lifecycle.js';
import { WebhookInbox } from './webhook-inbox.js';

/** Refresh when the access token has less than this left. */
export const REFRESH_SKEW_MS = 60_000;
/** An invalid_grant this soon after a failed persist of a rotated token is our loss, not the merchant's revocation. */
export const PERSIST_FAILURE_WINDOW_MS = 10 * 60_000;
const PERSIST_ATTEMPTS = 3;
const lockKey = (storeId: string): string => `platform_tokens:${storeId}`;

export type InstallFailure = 'denied' | 'state' | 'rejected' | 'unavailable' | 'conflict' | 'internal';
export type InstallResult = { ok: true; storeId: string; created: boolean } | { ok: false; reason: InstallFailure };

type TokenOutcome = { kind: 'token'; token: string } | { kind: 'unknown' } | { kind: 'disconnected' } | { kind: 'unavailable'; error: PlatformUnavailableError };

const pgCode = (err: unknown): string | undefined => {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code ?? e?.cause?.code;
};

/** The integration module's service: install, token custody and the connection status. Tokens never leave it except through getAccessToken. */
@Injectable()
export class IntegrationService {
  private readonly repo = new IntegrationRepository();

  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    @Inject(COMMERCE_PLATFORM) private readonly platform: CommercePlatform,
    @Inject(TOKEN_CIPHER) private readonly cipher: TokenCipher,
    @Inject(TELEMETRY) private readonly telemetry: Telemetry,
    @Inject(EVENT_SENDER) private readonly events: EventSender,
    @Inject(INTEGRATION_CONFIG) private readonly config: IntegrationConfig,
    @Optional() @Inject(STORE_DATA_LIFECYCLES) modules: readonly StoreDataLifecycle[] = [],
  ) {
    // Other modules purge first; the integration module's own data (tokens, account) goes last.
    this.lifecycle = new StoreLifecycle(pool, telemetry, events, [...modules, integrationStoreData], () => this.now());
    this.inbox = new WebhookInbox(pool, platform, cipher, telemetry, this.lifecycle, (t, p) => this.installFromTokens(t, p), (id) => this.locate(id), () => this.now());
  }

  /** Uninstall, reinstall and purge (AD-20). */
  readonly lifecycle: StoreLifecycle;
  /** Verified-webhook intake and processing (AD-13). */
  readonly inbox: WebhookInbox;

  /** Clock; tests replace it. */
  now: () => number = Date.now;

  /** Start the OAuth flow: the URL to send the merchant to, and the nonce for the binding cookie. */
  beginInstall(): { redirectUrl: string; nonce: string } {
    const { state, nonce } = createInstallState(this.config.stateSecret, this.now());
    return { redirectUrl: this.platform.auth.buildAuthorizeUrl(state), nonce };
  }

  /** Finish the OAuth flow from the callback query and the binding cookie. Never throws; returns a coarse reason on failure. */
  async completeInstall(input: { code?: string; state?: string; error?: string; cookieNonce?: string }): Promise<InstallResult> {
    if (!verifyInstallState(this.config.stateSecret, input.state, input.cookieNonce, this.now())) return { ok: false, reason: 'state' };
    if (input.error || !input.code) return { ok: false, reason: 'denied' };
    try {
      const tokens = await this.platform.auth.exchangeCode(input.code);
      const profile = await this.platform.auth.getMerchantProfile(tokens.accessToken);
      const result = await this.installFromTokens(tokens, profile);
      this.telemetry.log.info('store install completed', { store_id: result.storeId, created: result.created });
      return { ok: true, ...result };
    } catch (err) {
      const reason: InstallFailure =
        err instanceof PlatformAuthRejectedError ? 'rejected' : err instanceof PlatformUnavailableError ? 'unavailable' : err instanceof StoreLifecycleConflictError ? 'conflict' : 'internal';
      this.telemetry.captureError(err, { component: 'integration.install', reason });
      return { ok: false, reason };
    }
  }

  /**
   * Persist an authorised install: the `stores` row (`install_epoch` 1 when new), the owner's `merchant_accounts`
   * row, envelope-encrypted tokens, and the `integration.store.installed` event, all in one transaction. The
   * store is located by (platform, platform_store_id); a second install of the same store updates it in place.
   * Reused by the Easy Mode webhook (Story 1.10).
   */
  async installFromTokens(tokens: TokenSet, profile: MerchantProfile): Promise<{ storeId: string; created: boolean; restored?: boolean }> {
    let restored = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const existing = await this.locate(profile.platformStoreId);
      try {
        if (existing) {
          await withStoreContext(this.pool, existing, async (ctx) => {
            // Same lock as refresh, so an install can not interleave with a refresh and overwrite its rotated pair.
            await ctx.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey(existing)]);
            await lockStore(ctx); // also serialises with uninstall and with the purge's batches
            const store = await this.repo.getStore();
            if (!store) throw new Error('store locator points at a missing store');
            if (store.lifecycleState === 'uninstalled' || store.lifecycleState === 'purged') {
              // AD-20: the same row comes back with the next epoch; a purge in flight sees it and stops.
              const epoch = await this.lifecycle.reinstallInTx(ctx, { installEpoch: store.installEpoch, lifecycleState: store.lifecycleState, platform: store.platform, platformStoreId: store.platformStoreId }, { name: profile.storeName, syncedDomains: profile.domains });
              if (epoch === undefined) throw new StoreLifecycleConflictError();
              await this.persistInstall(existing, tokens, profile);
              restored = true;
              return;
            }
            await this.repo.refreshStoreDetails({ name: profile.storeName, syncedDomains: profile.domains }, 'active');
            await this.persistInstall(existing, tokens, profile);
          });
          return { storeId: existing, created: false, ...(restored ? { restored } : {}) };
        }
        const id = uuidv7();
        await withStoreContext(this.pool, id, async (ctx) => {
          await this.repo.insertStore({ platform: this.platform.platform, platformStoreId: profile.platformStoreId, name: profile.storeName, syncedDomains: profile.domains, at: new Date(this.now()) });
          await ctx.query('insert into store_locator (platform, platform_store_id, id) values ($1, $2, $3)', [this.platform.platform, profile.platformStoreId, id]);
          await this.persistInstall(id, tokens, profile);
          await publishEvent(ctx, this.events, this.telemetry, 'integration.store.installed', { v: 1, store_id: id, install_epoch: 1 });
        });
        return { storeId: id, created: true };
      } catch (err) {
        // A concurrent install of the same new store won the unique key: take the update path next time round.
        if (!existing && pgCode(err) === '23505') continue;
        throw err;
      }
    }
    throw new Error('install did not settle after concurrent attempts');
  }

  private async persistInstall(storeId: string, tokens: TokenSet, profile: MerchantProfile): Promise<void> {
    await this.repo.upsertMerchant({ platformMerchantId: profile.platformMerchantId, ...(profile.ownerName ? { ownerName: profile.ownerName } : {}) });
    await this.repo.upsertTokens(this.seal(storeId, tokens));
    await this.repo.logAccess('install', 'ok');
  }

  private seal(storeId: string, tokens: TokenSet) {
    return {
      accessTokenEnc: this.cipher.encrypt(tokens.accessToken, `${storeId}:access`),
      refreshTokenEnc: this.cipher.encrypt(tokens.refreshToken, `${storeId}:refresh`),
      accessExpiresAt: tokens.expiresAt,
      scopes: tokens.scopes.join(' '),
      keyId: this.cipher.keyId,
    };
  }

  async locate(platformStoreId: string): Promise<string | undefined> {
    const { rows } = await this.pool.query<{ id: string | null }>('select locate_store($1, $2)::text as id', [this.platform.platform, platformStoreId]);
    return rows[0]?.id ?? undefined;
  }

  /**
   * The only way to obtain a platform access token (AD-4). Returns a valid token, refreshing first when it is about
   * to expire. Refresh is single-flight per store under `pg_advisory_xact_lock`: the token row is re-read after the
   * lock, so a concurrent caller reuses the winner's new pair, which is persisted in the same transaction (refresh
   * tokens are single-use). A definitive rejection disconnects the store and emits `integration.store.disconnected`.
   * Every access is recorded in `token_access_log`.
   */
  async getAccessToken(storeId: string): Promise<string> {
    const outcome = await withStoreContext(this.pool, storeId, async (ctx): Promise<TokenOutcome> => {
      const fresh = (expires: Date): boolean => expires.getTime() - this.now() > REFRESH_SKEW_MS;
      const read = async (): Promise<{ outcome: TokenOutcome } | { token: Awaited<ReturnType<IntegrationRepository['getTokens']>> & object }> => {
        const store = await this.repo.getStore();
        if (!store) return { outcome: { kind: 'unknown' } };
        if (store.lifecycleState !== 'active') return { outcome: { kind: 'disconnected' } };
        const token = await this.repo.getTokens();
        return token ? { token } : { outcome: { kind: 'unknown' } };
      };
      let state = await read();
      if ('outcome' in state) return state.outcome;
      if (fresh(state.token.accessExpiresAt)) {
        await this.repo.logAccess('use', 'ok');
        return { kind: 'token', token: this.cipher.decrypt(state.token.accessTokenEnc, `${storeId}:access`) };
      }
      await ctx.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey(storeId)]);
      state = await read(); // another caller may have refreshed (or disconnected) while we waited
      if ('outcome' in state) return state.outcome;
      if (fresh(state.token.accessExpiresAt)) {
        await this.repo.logAccess('use', 'ok');
        return { kind: 'token', token: this.cipher.decrypt(state.token.accessTokenEnc, `${storeId}:access`) };
      }
      try {
        const next = await this.platform.auth.refresh(this.cipher.decrypt(state.token.refreshTokenEnc, `${storeId}:refresh`));
        // Salla has rotated the single-use refresh token: persist the new pair in its own short transaction, now.
        const persisted = await this.persistRotated(storeId, next);
        await this.repo.logAccess('refresh', persisted ? 'ok' : 'persist_failed');
        return { kind: 'token', token: next.accessToken };
      } catch (err) {
        if (err instanceof PlatformAuthRejectedError && (await this.recentPersistFailure(storeId))) {
          // The rejection is most likely the consequence of a rotated pair we failed to save, not a revocation.
          this.telemetry.captureError(err, { code: 'token_persist_failed', store_id: storeId, note: 'refresh rejected after a persist failure; store left connected' });
          await this.repo.logAccess('refresh', 'error');
          return { kind: 'unavailable', error: new PlatformUnavailableError('refresh rejected after a token persist failure') };
        }
        if (err instanceof PlatformAuthRejectedError) {
          const store = (await this.repo.getStore())!;
          await this.repo.markDisconnected();
          await this.repo.logAccess('refresh', 'rejected');
          await publishEvent(ctx, this.events, this.telemetry, 'integration.store.disconnected', { v: 1, store_id: storeId, install_epoch: store.installEpoch, reason: 'refresh_rejected' });
          this.telemetry.log.warn('store disconnected: refresh rejected', { store_id: storeId });
          return { kind: 'disconnected' };
        }
        if (err instanceof PlatformUnavailableError) {
          await this.repo.logAccess('refresh', 'error');
          return { kind: 'unavailable', error: err };
        }
        throw err;
      }
    });
    switch (outcome.kind) {
      case 'token':
        return outcome.token;
      case 'unknown':
        throw new StoreNotConnectedError();
      case 'disconnected':
        throw new StoreDisconnectedError();
      case 'unavailable':
        throw outcome.error;
    }
  }

  /** Write the rotated pair in a transaction independent of the caller's, retrying; false when every attempt failed. */
  private async persistRotated(storeId: string, next: TokenSet): Promise<boolean> {
    const sealed = this.seal(storeId, next);
    let last: unknown;
    for (let attempt = 1; attempt <= PERSIST_ATTEMPTS; attempt++) {
      try {
        await runOutsideStoreContext(() => withStoreContext(this.pool, storeId, () => this.repo.upsertTokens(sealed)));
        return true;
      } catch (err) {
        last = err;
        if (attempt < PERSIST_ATTEMPTS) await new Promise((r) => setTimeout(r, 50 * attempt));
      }
    }
    this.persistFailures.set(storeId, this.now());
    this.telemetry.captureError(last, { code: 'token_persist_failed', store_id: storeId, attempts: PERSIST_ATTEMPTS });
    return false;
  }

  private persistFailures = new Map<string, number>();

  /** True when a persist failure was recorded for this store within the window (this process, or the access log). */
  private async recentPersistFailure(storeId: string): Promise<boolean> {
    const at = this.persistFailures.get(storeId);
    if (at !== undefined && this.now() - at <= PERSIST_FAILURE_WINDOW_MS) return true;
    const rows = await this.repo.countRecentAccess('refresh', 'persist_failed', new Date(this.now() - PERSIST_FAILURE_WINDOW_MS));
    return rows > 0;
  }

  /** The store behind a platform store id, for sign-in: undefined when Slips was never installed there. */
  async findStoreForSignIn(platformStoreId: string): Promise<{ storeId: string; name: string; lifecycleState: LifecycleState } | undefined> {
    const storeId = await this.locate(platformStoreId);
    if (!storeId) return undefined;
    return withStoreContext(this.pool, storeId, async () => {
      const store = await this.repo.getStore();
      return store ? { storeId, name: store.name, lifecycleState: store.lifecycleState } : undefined;
    });
  }

  /**
   * The active-store check for storefront-facing endpoints (the Epic 4 content endpoint calls this with the locator
   * from the request). False for an unknown, disconnected, uninstalled or purged store, so the endpoint answers with an
   * empty result for it (AD-20). Billing and other per-store processing use the same check.
   */
  async isStoreActive(locator: { platform?: string; platformStoreId: string }): Promise<boolean> {
    if (locator.platform && locator.platform !== this.platform.platform) return false;
    const storeId = await this.locate(locator.platformStoreId);
    return storeId ? this.isStoreActiveById(storeId) : false;
  }

  async isStoreActiveById(storeId: string): Promise<boolean> {
    return withStoreContext(this.pool, storeId, async () => (await this.repo.getStore())?.lifecycleState === 'active');
  }

  /** What the dashboard connection chip shows for a store. */
  async getConnection(storeId: string): Promise<ConnectionStatus> {
    return withStoreContext(this.pool, storeId, async () => {
      const store = await this.repo.getStore();
      if (!store) return ConnectionStatus.parse({ state: 'not_connected' });
      return ConnectionStatus.parse({ state: store.lifecycleState === 'active' ? 'connected' : 'disconnected', store_name: store.name });
    });
  }
}
