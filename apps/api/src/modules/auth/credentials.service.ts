import { BadRequestException, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Pool } from 'pg';
import { withStoreContext } from '@slips/db';
import type { LoginInput, ResetPasswordInput, SelectStoreInput, SetPasswordInput, StoreChoice, VerifyOtpInput, VerifyOtpResponse } from '@slips/contracts';
import { DB_POOL, SESSION_CONFIG, type SessionConfig } from '../../infra.module.js';
import { MAILER, type Mailer } from '../../ports/mailer.js';
import { TELEMETRY, type Telemetry } from '../../ports/telemetry.js';
import { SessionService, type MerchantSession } from '../session/session.service.js';
import { CredentialsRepository } from './credentials.repository.js';
import { generateOtp, hashOtp, hashPassword, otpMatches, signAuthToken, verifyAuthToken, verifyPassword } from './credentials.crypto.js';
import { LoginRepository } from './login.repository.js';

const DUMMY_HASH = '00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000';
const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

/** Signed in to one store, or the password was right and the owner must pick one of several stores. */
export type SignInOutcome =
  | { kind: 'session'; sessionToken: string; session: MerchantSession; cookie: string }
  | { kind: 'select'; selectionToken: string; stores: StoreChoice[] };

const normalize = (email: string): string => email.trim().toLowerCase();

/**
 * Email/password sign-in. One login per email, linked to every store that email owns (linked at install by the owner
 * invite), so an owner of several stores has one password and chooses the store after signing in.
 */
@Injectable()
export class CredentialsService {
  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    @Inject(SESSION_CONFIG) private readonly sessionConfig: SessionConfig,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(TELEMETRY) private readonly telemetry: Telemetry,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  private get logins(): LoginRepository {
    return new LoginRepository(this.pool);
  }

  /** Linked stores the login may open now (not uninstalled or purged), by name. */
  private async openableStores(loginId: string): Promise<StoreChoice[]> {
    const out: StoreChoice[] = [];
    for (const storeId of await this.logins.linkedStoreIds(loginId)) {
      const store = await withStoreContext(this.pool, storeId, () => new CredentialsRepository().getStore());
      if (store && (store.lifecycleState === 'active' || store.lifecycleState === 'disconnected')) out.push({ id: storeId, name: store.name });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async openSession(storeId: string): Promise<SignInOutcome> {
    const { token, session } = await this.sessions.create(storeId, 'direct');
    return { kind: 'session', sessionToken: token, session, cookie: this.sessions.cookieFor(token) };
  }

  /** After the password (or a setup code) is proven: open the only store, or ask which one. */
  private async signIn(loginId: string, email: string): Promise<SignInOutcome> {
    const stores = await this.openableStores(loginId);
    if (stores.length === 0) throw new ForbiddenException({ message: 'No active store is linked to this account', code: 'store_inactive' });
    if (stores.length === 1) return this.openSession(stores[0]!.id);
    return { kind: 'select', selectionToken: signAuthToken(loginId, email, 'select', this.sessionConfig.secret), stores };
  }

  async login(input: LoginInput): Promise<SignInOutcome> {
    const email = normalize(input.email);
    const login = await this.logins.findByEmail(email);
    // Same scrypt cost whether or not the account exists.
    const valid = await verifyPassword(input.password, login?.passwordHash ?? DUMMY_HASH);
    if (!login?.passwordHash || !valid) {
      if (login) this.telemetry.log.warn('invalid login attempt', { login_id: login.id });
      throw new UnauthorizedException({ message: 'Invalid email or password', code: 'invalid_credentials' });
    }
    const outcome = await this.signIn(login.id, email);
    this.telemetry.log.info('merchant logged in with password', { login_id: login.id, outcome: outcome.kind });
    return outcome;
  }

  async selectStore(input: SelectStoreInput): Promise<SignInOutcome> {
    const claims = verifyAuthToken(input.selection_token, 'select', this.sessionConfig.secret);
    if (!claims) throw new UnauthorizedException({ message: 'Sign-in expired. Please sign in again.', code: 'invalid_token' });
    const stores = await this.openableStores(claims.subject);
    if (!stores.some((s) => s.id === input.store_id)) throw new ForbiddenException({ message: 'This store is not available for this account', code: 'store_inactive' });
    return this.openSession(input.store_id);
  }

  private async sendCode(loginId: string, email: string, purpose: 'setup' | 'reset'): Promise<void> {
    const code = generateOtp();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + OTP_TTL_MS);
    await LoginRepository.transaction(this.pool, async (repo) => {
      await repo.createOtp(loginId, purpose, hashOtp(code), expiresAt, now);
      await this.mailer.sendOtp({ to: email, code, purpose, expiresAt });
    });
  }

  async forgotPassword(email: string): Promise<{ ok: true; message: string }> {
    const normalized = normalize(email);
    const login = await this.logins.findByEmail(normalized);
    if (login && (await this.logins.linkedStoreIds(login.id)).length > 0) {
      await this.sendCode(login.id, normalized, 'reset');
      this.telemetry.log.info('password reset otp requested', { login_id: login.id });
    }
    return { ok: true, message: 'If an account exists with this email, a verification code has been sent.' };
  }

  async verifyOtp(input: VerifyOtpInput): Promise<VerifyOtpResponse> {
    const email = normalize(input.email);
    const login = await this.logins.findByEmail(email);
    const otp = login ? await this.logins.latestPendingOtp(login.id, input.purpose) : undefined;
    if (!login || !otp) throw new BadRequestException({ message: 'Invalid or expired verification code', code: 'invalid_otp' });
    if (otp.expiresAt.getTime() <= Date.now()) throw new BadRequestException({ message: 'Verification code has expired', code: 'otp_expired' });
    if (otp.attempts >= MAX_OTP_ATTEMPTS) throw new BadRequestException({ message: 'Too many attempts. Request a new verification code.', code: 'otp_attempts_exceeded' });
    if (!otpMatches(input.code, otp.codeHash)) {
      await this.logins.incrementOtpAttempts(otp.id);
      throw new BadRequestException({ message: 'Invalid verification code', code: 'invalid_otp' });
    }
    if (!(await this.logins.markOtpUsed(otp.id, new Date()))) throw new BadRequestException({ message: 'Invalid or expired verification code', code: 'invalid_otp' });
    this.telemetry.log.info('otp verified successfully', { login_id: login.id, purpose: input.purpose });
    return { token: signAuthToken(login.id, email, input.purpose, this.sessionConfig.secret), expires_in: 900, purpose: input.purpose };
  }

  async resetPassword(input: ResetPasswordInput): Promise<{ ok: true; message: string }> {
    const claims = verifyAuthToken(input.reset_token, 'reset', this.sessionConfig.secret);
    if (!claims) throw new UnauthorizedException({ message: 'Invalid or expired reset token', code: 'invalid_token' });
    await this.logins.setPassword(claims.subject, await hashPassword(input.new_password), new Date());
    // A new password signs out every direct session of every store this login can open.
    for (const storeId of await this.logins.linkedStoreIds(claims.subject)) {
      await withStoreContext(this.pool, storeId, () => new CredentialsRepository().revokeAllDirectSessions());
    }
    this.telemetry.log.info('password reset completed', { login_id: claims.subject });
    return { ok: true, message: 'Password changed successfully. Please log in with your new password.' };
  }

  async setPassword(input: SetPasswordInput): Promise<SignInOutcome> {
    const claims = verifyAuthToken(input.setup_token, 'setup', this.sessionConfig.secret);
    if (!claims) throw new UnauthorizedException({ message: 'Invalid or expired setup token', code: 'invalid_token' });
    await this.logins.setPassword(claims.subject, await hashPassword(input.new_password), new Date());
    this.telemetry.log.info('initial password setup completed', { login_id: claims.subject });
    return this.signIn(claims.subject, claims.email);
  }

  async resendOtp(email: string, purpose: 'setup' | 'reset'): Promise<{ ok: true; message: string }> {
    const normalized = normalize(email);
    const login = await this.logins.findByEmail(normalized);
    // A setup code is only for a login still waiting for its first password; a reset needs a linked store.
    const eligible = login && (purpose === 'setup' ? !login.passwordHash : (await this.logins.linkedStoreIds(login.id)).length > 0);
    if (login && eligible) {
      await this.sendCode(login.id, normalized, purpose);
      this.telemetry.log.info('otp resent', { login_id: login.id, purpose });
    }
    return { ok: true, message: 'A new verification code has been sent.' };
  }
}
