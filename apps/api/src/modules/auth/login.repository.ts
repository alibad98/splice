// Data access for the identity tables (merchant_logins, merchant_login_stores, login_otps). These are not tenant tables
// (read at sign-in, before a store is chosen), so this runs on the pool or a plain transaction, not in a store context.
import type { Pool, PoolClient } from 'pg';
import type { OtpPurpose } from '@slips/contracts';

export interface LoginRow {
  id: string;
  email: string;
  passwordHash: string | null;
}

export interface OtpRow {
  id: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
}

type Db = Pool | PoolClient;

export class LoginRepository {
  constructor(private readonly db: Db) {}

  /** Run `fn` in one transaction on its own connection. */
  static async transaction<T>(pool: Pool, fn: (repo: LoginRepository) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(new LoginRepository(client));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async findByEmail(email: string): Promise<LoginRow | undefined> {
    const { rows } = await this.db.query<LoginRow>('select id::text as id, email, password_hash as "passwordHash" from merchant_logins where email = $1', [email]);
    return rows[0];
  }

  /** The login for this email, created (without a password) when missing. Safe under concurrent installs. */
  async ensure(email: string): Promise<LoginRow> {
    await this.db.query('insert into merchant_logins (email) values ($1) on conflict (email) do nothing', [email]);
    const login = await this.findByEmail(email);
    if (!login) throw new Error('login vanished after insert');
    return login;
  }

  async linkStore(loginId: string, storeId: string): Promise<void> {
    await this.db.query('insert into merchant_login_stores (login_id, linked_store_id) values ($1, $2) on conflict do nothing', [loginId, storeId]);
  }

  async linkedStoreIds(loginId: string): Promise<string[]> {
    const { rows } = await this.db.query<{ id: string }>('select linked_store_id::text as id from merchant_login_stores where login_id = $1 order by created_at', [loginId]);
    return rows.map((r) => r.id);
  }

  async setPassword(loginId: string, passwordHash: string, at: Date): Promise<void> {
    await this.db.query('update merchant_logins set password_hash = $2, password_set_at = $3, updated_at = $3 where id = $1', [loginId, passwordHash, at]);
  }

  async hasPendingOtp(loginId: string, purpose: OtpPurpose, now: Date): Promise<boolean> {
    const { rowCount } = await this.db.query('select 1 from login_otps where login_id = $1 and purpose = $2 and used_at is null and expires_at > $3 limit 1', [loginId, purpose, now]);
    return (rowCount ?? 0) > 0;
  }

  /** Issue a code, retiring any earlier unused code of the same purpose. */
  async createOtp(loginId: string, purpose: OtpPurpose, codeHash: string, expiresAt: Date, now: Date): Promise<void> {
    await this.db.query('update login_otps set used_at = $3 where login_id = $1 and purpose = $2 and used_at is null', [loginId, purpose, now]);
    await this.db.query('insert into login_otps (login_id, purpose, code_hash, expires_at, created_at) values ($1, $2, $3, $4, $5)', [loginId, purpose, codeHash, expiresAt, now]);
  }

  async latestPendingOtp(loginId: string, purpose: OtpPurpose): Promise<OtpRow | undefined> {
    const { rows } = await this.db.query<OtpRow>(
      'select id::text as id, code_hash as "codeHash", attempts, expires_at as "expiresAt" from login_otps where login_id = $1 and purpose = $2 and used_at is null order by created_at desc limit 1',
      [loginId, purpose],
    );
    return rows[0];
  }

  async incrementOtpAttempts(id: string): Promise<void> {
    await this.db.query('update login_otps set attempts = attempts + 1 where id = $1', [id]);
  }

  /** Consume a code; false when another request consumed it first. */
  async markOtpUsed(id: string, at: Date): Promise<boolean> {
    const { rowCount } = await this.db.query('update login_otps set used_at = $2 where id = $1 and used_at is null', [id, at]);
    return (rowCount ?? 0) > 0;
  }
}
