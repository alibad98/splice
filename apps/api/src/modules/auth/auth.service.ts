import { Inject, Injectable } from '@nestjs/common';
import type { ConnectionStatus, EmbeddedSession, SessionInfo } from '@slips/contracts';
import { COMMERCE_PLATFORM, PlatformAuthRejectedError, PlatformUnavailableError, type CommercePlatform } from '../../ports/commerce-platform.js';
import { TELEMETRY, type Telemetry } from '../../ports/telemetry.js';
import { IntegrationService } from '../integration/integration.service.js';
import { SessionService, type MerchantSession } from '../session/session.service.js';

export type EmbeddedSignIn =
  | { ok: true; session: EmbeddedSession; storeName: string }
  | { ok: false; reason: 'invalid_token' | 'store_not_installed' | 'platform_unavailable' };

/** Sign-in orchestration (AD-12): who the platform vouches for -> which Slips store -> a Slips session. */
@Injectable()
export class AuthService {
  constructor(
    @Inject(COMMERCE_PLATFORM) private readonly platform: CommercePlatform,
    @Inject(IntegrationService) private readonly integration: IntegrationService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(TELEMETRY) private readonly telemetry: Telemetry,
  ) {}

  /**
   * Embedded sign-in: the host token is verified server-side with the platform; the store comes only from that
   * answer (never from the request). Unknown, disconnected or uninstalled stores are refused with a reinstall message.
   */
  async signInEmbedded(hostToken: string): Promise<EmbeddedSignIn> {
    let identity;
    try {
      identity = await this.platform.embedded.introspect(hostToken);
    } catch (err) {
      if (err instanceof PlatformAuthRejectedError) return { ok: false, reason: 'invalid_token' };
      if (err instanceof PlatformUnavailableError) {
        this.telemetry.captureError(err, { component: 'auth.embedded' });
        return { ok: false, reason: 'platform_unavailable' };
      }
      throw err;
    }
    const store = await this.integration.findStoreForSignIn(identity.platformStoreId);
    if (!store || store.lifecycleState !== 'active') return { ok: false, reason: 'store_not_installed' };
    const { token, session } = await this.sessions.create(store.storeId, 'embedded');
    return {
      ok: true,
      storeName: store.name,
      session: { v: 1, access_token: token, token_type: 'Bearer', expires_in: Math.max(1, Math.floor((session.expiresAt.getTime() - this.sessions.now()) / 1000)), expires_at: session.expiresAt.toISOString() },
    };
  }

  /** What the shell needs about the signed-in merchant. */
  async describe(session: MerchantSession): Promise<{ info: SessionInfo; connection: ConnectionStatus }> {
    const connection = await this.integration.getConnection(session.storeId);
    const direct = session.mode === 'direct';
    const openUrl = direct ? this.platform.embedded.openUrl() : undefined;
    const info: SessionInfo = {
      v: 1,
      mode: session.mode,
      store: { name: connection.store_name ?? '' },
      connection,
      expires_at: session.expiresAt.toISOString(),
      ...(direct ? { csrf_token: this.sessions.csrfToken(session.id) } : {}),
      ...(openUrl ? { open_in_platform_url: openUrl } : {}),
    };
    return { info, connection };
  }
}
