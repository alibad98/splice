import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { withStoreContext, type SessionMode } from '@slips/db';
import type { Pool } from 'pg';
import { DB_POOL, SESSION_CONFIG, type SessionConfig } from '../../infra.module.js';
import { SessionRepository } from './session.repository.js';

export const SESSION_COOKIE = 'slips_session';
/** A session row is touched at most this often, so reads stay cheap. */
const TOUCH_EVERY_MS = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MerchantSession {
  id: string;
  storeId: string;
  mode: SessionMode;
  expiresAt: Date;
}

export type AuthOutcome = { kind: 'ok'; session: MerchantSession } | { kind: 'expired' } | { kind: 'none' };

const sha256 = (v: string): Buffer => createHash('sha256').update(v).digest();

/**
 * Merchant sessions (AD-12). The credential is `<storeId>.<sessionId>.<secret>`: the store id only selects which
 * tenant partition to look in (RLS), the row is found by session id and the secret is compared by hash, so a
 * guessed or edited credential matches nothing. Only a hash of the secret is stored.
 */
@Injectable()
export class SessionService {
  private readonly repo = new SessionRepository();

  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    @Inject(SESSION_CONFIG) private readonly config: SessionConfig,
  ) {}

  /** Clock; tests replace it. */
  now: () => number = Date.now;

  async create(storeId: string, mode: SessionMode): Promise<{ token: string; session: MerchantSession }> {
    const id = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const ttl = mode === 'embedded' ? this.config.embeddedTtlMs : this.config.directMaxAgeMs;
    const expiresAt = new Date(this.now() + ttl);
    await withStoreContext(this.pool, storeId, async () => {
      await this.repo.deleteExpired(new Date(this.now()));
      await this.repo.insert({ id, mode, secretHash: sha256(secret).toString('hex'), expiresAt });
    });
    return { token: `${storeId}.${id}.${secret}`, session: { id, storeId, mode, expiresAt } };
  }

  /** Resolve a credential. Expired sessions (hard expiry or idle for `idleMs`) are removed and reported as such. */
  async authenticate(token: string, expectedMode: SessionMode): Promise<AuthOutcome> {
    const [storeId, id, secret, extra] = token.split('.');
    if (!storeId || !id || !secret || extra !== undefined || !UUID.test(storeId) || !UUID.test(id)) return { kind: 'none' };
    return withStoreContext(this.pool, storeId, async (): Promise<AuthOutcome> => {
      const row = await this.repo.get(id);
      if (!row || row.mode !== expectedMode) return { kind: 'none' };
      const given = sha256(secret);
      const stored = Buffer.from(row.secretHash, 'hex');
      if (given.length !== stored.length || !timingSafeEqual(given, stored)) return { kind: 'none' };
      const now = this.now();
      if (row.expiresAt.getTime() <= now || now - row.lastSeenAt.getTime() > this.config.idleMs) {
        await this.repo.delete(id);
        return { kind: 'expired' };
      }
      if (now - row.lastSeenAt.getTime() > TOUCH_EVERY_MS) await this.repo.touch(id, new Date(now));
      return { kind: 'ok', session: { id, storeId, mode: row.mode, expiresAt: row.expiresAt } };
    });
  }

  /** End a session immediately (sign out). */
  async revoke(session: Pick<MerchantSession, 'id' | 'storeId'>): Promise<void> {
    await withStoreContext(this.pool, session.storeId, () => this.repo.delete(session.id));
  }

  /** The CSRF token for a cookie session: derived from the session id, so nothing extra is stored. */
  csrfToken(sessionId: string): string {
    return createHmac('sha256', this.config.secret).update(`csrf:${sessionId}`).digest('base64url');
  }

  isValidCsrf(sessionId: string, given: string | undefined): boolean {
    if (!given) return false;
    const a = sha256(given);
    const b = sha256(this.csrfToken(sessionId));
    return timingSafeEqual(a, b);
  }

  /** `Set-Cookie` value for a direct-link session: httpOnly, Secure (production), SameSite=Lax, first party. */
  cookieFor(token: string): string {
    return this.cookie(token, Math.floor(this.config.directMaxAgeMs / 1000));
  }

  clearedCookie(): string {
    return this.cookie('', 0);
  }

  private cookie(value: string, maxAge: number): string {
    return [
      `${SESSION_COOKIE}=${value}`,
      'HttpOnly',
      'SameSite=Lax',
      'Path=/',
      `Max-Age=${maxAge}`,
      ...(this.config.secureCookies ? ['Secure'] : []),
      ...(this.config.cookieDomain ? [`Domain=${this.config.cookieDomain}`] : []),
    ].join('; ');
  }
}
