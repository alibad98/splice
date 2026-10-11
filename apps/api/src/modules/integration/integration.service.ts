import { Inject, Injectable } from '@nestjs/common';
import { ConnectionStatus } from '@slips/contracts';
import { withStoreContext } from '@slips/db';
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
import { IntegrationRepository } from './integration.repository.js';

/** Refresh when the access token has less than this left. */
export const REFRESH_SKEW_MS = 60_000;

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
  ) {}

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
  async installFromTokens(tokens: TokenSet, profile: MerchantProfile): Promise<{ storeId: string; created: boolean }> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const existing = await this.locate(profile.platformStoreId);
      try {
        if (existing) {
          await withStoreContext(this.pool, existing, async () => {
            const store = await this.repo.getStore();
            if (!store) throw new Error('store locator points at a missing store');
            if (store.lifecycleState !== 'active' && store.lifecycleState !== 'disconnected') throw new StoreLifecycleConflictError();
            await this.repo.refreshStoreDetails({ name: profile.storeName, syncedDomains: profile.domains }, 'active');
            await this.persistInstall(existing, tokens, profile);
          });
          return { storeId: existing, created: false };
        }
        const id = uuidv7();
        await withStoreContext(this.pool, id, async (ctx) => {
          await this.repo.insertStore({ platform: this.platform.platform, platformStoreId: profile.platformStoreId, name: profile.storeName, syncedDomains: profile.domains });
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

  private async locate(platformStoreId: string): Promise<string | undefined> {
    const { rows } = await this.pool.query<{ id: string }>('select id::text as id from store_locator where platform = $1 and platform_store_id = $2', [this.platform.platform, platformStoreId]);
    return rows[0]?.id;
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
      await ctx.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`platform_tokens:${storeId}`]);
      state = await read(); // another caller may have refreshed (or disconnected) while we waited
      if ('outcome' in state) return state.outcome;
      if (fresh(state.token.accessExpiresAt)) {
        await this.repo.logAccess('use', 'ok');
        return { kind: 'token', token: this.cipher.decrypt(state.token.accessTokenEnc, `${storeId}:access`) };
      }
      try {
        const next = await this.platform.auth.refresh(this.cipher.decrypt(state.token.refreshTokenEnc, `${storeId}:refresh`));
        await this.repo.upsertTokens(this.seal(storeId, next));
        await this.repo.logAccess('refresh', 'ok');
        return { kind: 'token', token: next.accessToken };
      } catch (err) {
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

  /** What the dashboard connection chip shows for a store. */
  async getConnection(storeId: string): Promise<ConnectionStatus> {
    return withStoreContext(this.pool, storeId, async () => {
      const store = await this.repo.getStore();
      if (!store) return ConnectionStatus.parse({ state: 'not_connected' });
      return ConnectionStatus.parse({ state: store.lifecycleState === 'active' ? 'connected' : 'disconnected', store_name: store.name });
    });
  }
}
