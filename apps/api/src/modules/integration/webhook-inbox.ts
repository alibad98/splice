// Webhook intake and processing (AD-13). Order of operations is part of the contract:
//   1. verify the signature over the RAW body (timing-safe, in the adapter) before anything else; invalid -> 401, nothing stored
//   2. reduce to the canonical PII-free form; store it with the body hash, type, store external id and the event id; answer 200
//   3. process one event at a time per store, via guarded lifecycle writes
// The raw body is never stored or logged. A token pair (Easy Mode authorize) is kept only envelope-encrypted until processed.
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { uuidv7 } from '../../events/outbox.js';
import { PlatformAuthRejectedError, PlatformUnavailableError, type CanonicalWebhook, type CommercePlatform, type MerchantProfile, type TokenSet, type WebhookRequest } from '../../ports/commerce-platform.js';
import { Metric, type Telemetry } from '../../ports/telemetry.js';
import type { TokenCipher } from '../../ports/token-cipher.js';
import { StoreLifecycleConflictError } from './errors.js';
import type { StoreLifecycle } from './store-lifecycle.js';

/** An event for a store we do not know yet is retried for this long, then dead-lettered (never answered 404). */
export const PARK_WINDOW_MS = 15 * 60_000;
export const PARK_RETRY_MS = 60_000;
/** Mirrors the shared retry policy (worker/queues.ts): 5 attempts, 30 s doubling to 15 min. */
export const MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 15 * 60_000;
const LEASE_MS = 2 * 60_000;

export type IntakeResult = { status: 200; duplicate: boolean; id: string; kind?: CanonicalWebhook['kind'] } | { status: 400 | 401 };
export type ProcessOutcome = 'processed' | 'ignored' | 'parked' | 'retry' | 'dead_lettered' | 'skipped';

interface InboxRow {
  id: string;
  platform: string;
  event_id: string;
  type: string;
  platform_store_id: string;
  payload: { kind?: string } & Record<string, unknown>;
  secret_enc: string | null;
  occurred_at: Date | null;
  attempts: number;
  parked_since: Date | null;
}

const secretAad = (platform: string, eventId: string): string => `inbox:${platform}:${eventId}`;

export class WebhookInbox {
  constructor(
    private readonly pool: Pool,
    private readonly platform: CommercePlatform,
    private readonly cipher: TokenCipher,
    private readonly telemetry: Telemetry,
    private readonly lifecycle: StoreLifecycle,
    private readonly install: (tokens: TokenSet, profile: MerchantProfile) => Promise<unknown>,
    private readonly locate: (platformStoreId: string) => Promise<string | undefined>,
    private readonly now: () => number = Date.now,
  ) {}

  /** Steps 1 and 2. Never logs or stores the raw body. */
  async receive(req: WebhookRequest): Promise<IntakeResult> {
    if (!this.platform.webhooks.verify(req)) return { status: 401 };
    const event = this.platform.webhooks.parse(req);
    if (!event) return { status: 400 };
    const id = uuidv7();
    const secret = event.tokens
      ? this.cipher.encrypt(JSON.stringify({ a: event.tokens.accessToken, r: event.tokens.refreshToken, e: event.tokens.expiresAt.toISOString(), s: event.tokens.scopes }), secretAad(this.platform.platform, event.eventId))
      : null;
    const { rows } = await this.pool.query<{ id: string }>(
      `insert into webhook_inbox (id, platform, event_id, type, platform_store_id, body_hash, payload, secret_enc, secret_key_id, occurred_at, received_at, next_attempt_at)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $11)
       on conflict (platform, event_id) do nothing returning id::text as id`,
      [id, this.platform.platform, event.eventId, event.type, event.platformStoreId, createHash('sha256').update(req.rawBody).digest('hex'), JSON.stringify(event.payload), secret, secret ? this.cipher.keyId : null, event.occurredAt ?? null, new Date(this.now())],
    );
    if (rows.length === 0) return { status: 200, duplicate: true, id: '' };
    this.telemetry.log.info('webhook received', { webhook_type: event.type, platform_store_id: event.platformStoreId });
    return { status: 200, duplicate: false, id, kind: event.kind };
  }

  /**
   * Receive, then handle at once what needs no outbound call (an uninstall must stop Slips immediately). The worker sweep
   * is the backstop: it retries anything not finished here, and handles authorize events, which call the platform.
   */
  async receiveAndProcess(req: WebhookRequest): Promise<IntakeResult> {
    const result = await this.receive(req);
    if (result.status === 200 && !result.duplicate && result.kind !== 'authorize') {
      try {
        await this.processOne(result.id);
      } catch (err) {
        this.telemetry.captureError(err, { component: 'webhook-inbox', inbox_id: result.id });
      }
    }
    return result;
  }

  /** Process every row that is due, oldest first; returns how many were handled. A failing row never blocks the others. */
  async processDue(limit = 25): Promise<number> {
    const { rows } = await this.pool.query<{ id: string }>(
      `select id::text as id from webhook_inbox where status = 'pending' and next_attempt_at <= $1 order by received_at limit $2`,
      [new Date(this.now()), limit],
    );
    let n = 0;
    for (const r of rows) {
      try {
        if ((await this.processOne(r.id)) !== 'skipped') n++;
      } catch (err) {
        this.telemetry.captureError(err, { component: 'webhook-inbox', inbox_id: r.id });
      }
    }
    return n;
  }

  /** Count of dead-lettered rows, for the dead-letter gauge. */
  async deadLetterCount(): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>("select count(*)::text as n from webhook_inbox where status = 'dead_lettered'");
    return Number(rows[0]!.n);
  }

  /** Step 3 for one row. A lease on `next_attempt_at` makes concurrent workers skip a row that is being handled. */
  async processOne(id: string): Promise<ProcessOutcome> {
    const now = new Date(this.now());
    const claimed = await this.pool.query<InboxRow>(
      `update webhook_inbox set next_attempt_at = $2 where id = $1 and status = 'pending' and next_attempt_at <= $3
       returning id::text as id, platform, event_id, type, platform_store_id, payload, secret_enc, occurred_at, attempts, parked_since`,
      [id, new Date(now.getTime() + LEASE_MS), now],
    );
    const row = claimed.rows[0];
    if (!row) return 'skipped';
    try {
      const outcome = await this.handle(row);
      if (outcome === 'parked') return await this.park(row);
      await this.finish(row.id, outcome === 'ignored' ? 'ignored' : 'processed');
      return outcome;
    } catch (err) {
      return this.fail(row, err);
    }
  }

  private async handle(row: InboxRow): Promise<'processed' | 'ignored' | 'parked'> {
    const kind = row.payload.kind as CanonicalWebhook['kind'] | undefined;
    if (kind !== 'authorize' && kind !== 'installed' && kind !== 'uninstalled') return 'ignored';
    const storeId = await this.locate(row.platform_store_id);
    if (kind === 'installed') return storeId ? 'ignored' : 'parked'; // Easy Mode: tokens follow in app.store.authorize
    if (kind === 'uninstalled') {
      if (!storeId) return 'parked';
      const outcome = await this.lifecycle.uninstall(storeId, row.occurred_at ?? undefined);
      return outcome === 'uninstalled' ? 'processed' : 'ignored';
    }
    // authorize (Easy Mode): the same install core as the OAuth callback (Story 1.8).
    if (storeId && (await this.lifecycle.authorizePredatesUninstall(storeId, row.occurred_at ?? undefined))) return 'ignored';
    if (!row.secret_enc) throw new Error('authorize event without tokens');
    const raw = JSON.parse(this.cipher.decrypt(row.secret_enc, secretAad(row.platform, row.event_id))) as { a: string; r: string; e: string; s: string[] };
    const tokens: TokenSet = { accessToken: raw.a, refreshToken: raw.r, expiresAt: new Date(raw.e), scopes: raw.s };
    const profile = await this.platform.auth.getMerchantProfile(tokens.accessToken);
    if (profile.platformStoreId !== row.platform_store_id) throw new PlatformAuthRejectedError('authorize event and token belong to different stores');
    await this.install(tokens, profile);
    return 'processed';
  }

  private async finish(id: string, status: 'processed' | 'ignored'): Promise<void> {
    await this.pool.query(`update webhook_inbox set status = $2, processed_at = $3, secret_enc = null, secret_key_id = null, last_error = null where id = $1`, [id, status, new Date(this.now())]);
  }

  /** Unknown store: retry every minute for 15 minutes from the first sighting, then dead-letter. */
  private async park(row: InboxRow): Promise<ProcessOutcome> {
    const now = this.now();
    const since = row.parked_since ?? new Date(now);
    if (now - since.getTime() >= PARK_WINDOW_MS) {
      await this.deadLetter(row, 'unknown_store');
      return 'dead_lettered';
    }
    await this.pool.query(`update webhook_inbox set parked_since = $2, next_attempt_at = $3, last_error = 'unknown_store' where id = $1`, [row.id, since, new Date(now + PARK_RETRY_MS)]);
    return 'parked';
  }

  private async fail(row: InboxRow, err: unknown): Promise<ProcessOutcome> {
    const code = err instanceof PlatformUnavailableError ? 'platform_unavailable' : err instanceof PlatformAuthRejectedError ? 'platform_rejected' : err instanceof StoreLifecycleConflictError ? 'lifecycle_conflict' : 'internal';
    this.telemetry.counter(Metric.WebhookFailures, { reason: code });
    this.telemetry.captureError(err, { component: 'webhook-inbox', inbox_id: row.id, webhook_type: row.type, reason: code });
    const attempts = row.attempts + 1;
    // A rejected token will not get better by retrying.
    if (attempts >= MAX_ATTEMPTS || code === 'platform_rejected') {
      await this.deadLetter({ ...row, attempts }, code);
      return 'dead_lettered';
    }
    const delay = Math.min(RETRY_BASE_MS * 2 ** (attempts - 1), RETRY_MAX_MS);
    await this.pool.query(`update webhook_inbox set attempts = $2, next_attempt_at = $3, last_error = $4 where id = $1`, [row.id, attempts, new Date(this.now() + delay), code]);
    return 'retry';
  }

  private async deadLetter(row: InboxRow, reason: string): Promise<void> {
    await this.pool.query(`update webhook_inbox set status = 'dead_lettered', attempts = $2, last_error = $3, processed_at = $4, secret_enc = null, secret_key_id = null where id = $1`, [row.id, row.attempts, reason, new Date(this.now())]);
    this.telemetry.counter(Metric.WebhookFailures, { reason: `dead_lettered_${reason}` });
    this.telemetry.log.warn('webhook dead-lettered', { inbox_id: row.id, webhook_type: row.type, reason });
  }
}
