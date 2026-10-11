// DEV-ONLY webhook recorder for the Salla gate (Story 1.13, G6). Off unless WEBHOOK_RECORD_DIR is set, and env
// validation refuses it in production. It writes ONE json file per VERIFIED delivery: allow-listed headers (the signature
// and any credential are redacted) and the body with shopper PII and secrets scrubbed, keeping the shape and the ids so
// the file works as an integration-test fixture. Nothing here is ever logged.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WebhookRequest } from '../../ports/commerce-platform.js';

const KEEP_HEADERS = ['content-type', 'user-agent', 'x-salla-security-strategy'];
const REDACT_HEADERS = ['x-salla-signature', 'authorization'];
/** Key names whose values are personal data or secrets (matched case-insensitively, whole key). */
const PII_KEYS = new Set([
  'name', 'first_name', 'last_name', 'full_name', 'email', 'mobile', 'mobile_code', 'phone', 'telephone', 'whatsapp',
  'address', 'street', 'street_number', 'block', 'building', 'district', 'city', 'postal_code', 'zip', 'zip_code', 'country_code',
  'lat', 'lng', 'latitude', 'longitude', 'ip', 'ip_address', 'user_agent', 'avatar', 'birthday', 'national_id', 'iban',
  'notes', 'note', 'customer_name', 'receiver', 'sender', 'owner_name',
  'access_token', 'refresh_token', 'token', 'secret', 'client_secret', 'password', 'authorization', 'api_key',
]);
/** Containers whose whole content is shopper data. */
const PII_CONTAINERS = new Set(['customer', 'shipping_address', 'billing_address', 'ship_to', 'pickup_address', 'receiver', 'user']);
const EMAIL = /[^\s@"']+@[^\s@"']+\.[^\s@"']+/g;
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;
const MARK = '<scrubbed>';

export function scrub(value: unknown, key = ''): unknown {
  const k = key.toLowerCase();
  if (PII_CONTAINERS.has(k)) return MARK;
  if (PII_KEYS.has(k)) return value === null || value === undefined ? value : MARK;
  if (Array.isArray(value)) return value.map((v) => scrub(v, key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([kk, v]) => [kk, scrub(v, kk)]));
  // Ids and amounts are kept; free text that looks like an email or a phone number is not.
  if (typeof value === 'string') return value.replace(EMAIL, MARK).replace(PHONE, (m) => (/^\d{4}-\d{2}-\d{2}/.test(m) ? m : MARK));
  return value;
}

export interface WebhookRecorder {
  record(req: WebhookRequest): void;
}

export function createWebhookRecorder(dir: string | undefined, now: () => number = Date.now): WebhookRecorder | undefined {
  if (!dir) return undefined;
  let seq = 0;
  return {
    record(req) {
      try {
        mkdirSync(dir, { recursive: true });
        const headers: Record<string, string> = {};
        for (const name of KEEP_HEADERS) {
          const v = req.headers[name];
          if (v !== undefined) headers[name] = Array.isArray(v) ? v.join(', ') : v;
        }
        for (const name of REDACT_HEADERS) if (req.headers[name] !== undefined) headers[name] = '<redacted>';
        let body: unknown;
        try {
          body = scrub(JSON.parse(req.rawBody.toString('utf8')));
        } catch {
          body = MARK; // not JSON: record nothing of it
        }
        const event = body && typeof body === 'object' && typeof (body as { event?: unknown }).event === 'string' ? (body as { event: string }).event : 'unknown';
        const file = `${new Date(now()).toISOString().replace(/[:.]/g, '-')}-${String(++seq).padStart(3, '0')}-${event.replace(/[^a-z0-9._-]/gi, '_')}.json`;
        writeFileSync(join(dir, file), JSON.stringify({ recorded_at: new Date(now()).toISOString(), headers, body }, null, 2) + '\n', { mode: 0o600 });
      } catch {
        /* a recorder failure must never affect webhook handling */
      }
    },
  };
}
