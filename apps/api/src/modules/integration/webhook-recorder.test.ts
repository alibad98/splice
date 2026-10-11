import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseEnv } from '../../config/env.js';
import { createWebhookRecorder, scrub } from './webhook-recorder.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'rec-'));
  dirs.push(d);
  return d;
};

const order = {
  event: 'order.created',
  merchant: 1234,
  created_at: '2026-10-10 12:00:00',
  data: {
    id: 99,
    reference_id: 555,
    total: { amount: 120, currency: 'SAR' },
    customer: { id: 7, first_name: 'Ali', email: 'ali@example.com', mobile: 501234567 },
    shipping: { address: { street: 'King Rd', city: 'Riyadh' } },
    items: [{ id: 1, name: 'Shirt', notes: 'slips:c1 call me on +966 50 123 4567', quantity: 2 }],
    comment: 'mail me at buyer@example.org',
  },
};

describe('webhook recorder', () => {
  it('scrubs PII and secrets but keeps ids, amounts and structure', () => {
    const s = JSON.stringify(scrub(order));
    for (const leak of ['Ali', 'ali@example.com', '501234567', 'King Rd', 'Riyadh', 'buyer@example.org', '+966 50 123 4567']) expect(s).not.toContain(leak);
    const out = scrub(order) as typeof order;
    expect(out.data.id).toBe(99);
    expect(out.data.total).toEqual({ amount: 120, currency: 'SAR' });
    expect(out.data.items[0]?.quantity).toBe(2);
    expect(out.created_at).toBe('2026-10-10 12:00:00');
    expect(JSON.stringify(scrub({ event: 'app.store.authorize', data: { access_token: 'AT', refresh_token: 'RT' } }))).not.toMatch(/AT|RT"/);
  });

  it('writes a scrubbed file with redacted credentials headers', () => {
    const dir = tmp();
    const rec = createWebhookRecorder(dir, () => Date.UTC(2026, 9, 10));
    rec?.record({ headers: { 'x-salla-signature': 'a'.repeat(64), 'x-salla-security-strategy': 'signature', cookie: 'x', authorization: 'tok' }, rawBody: Buffer.from(JSON.stringify(order)) });
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('order.created');
    const text = readFileSync(join(dir, files[0] as string), 'utf8');
    const parsed = JSON.parse(text) as { headers: Record<string, string> };
    expect(parsed.headers['x-salla-signature']).toBe('<redacted>');
    expect(parsed.headers['authorization']).toBe('<redacted>');
    expect(parsed.headers['x-salla-security-strategy']).toBe('signature');
    expect(parsed.headers['cookie']).toBeUndefined();
    expect(text).not.toContain('ali@example.com');
    expect(text).not.toContain('a'.repeat(64));
  });

  it('records nothing from a non-JSON body', () => {
    const dir = tmp();
    createWebhookRecorder(dir)?.record({ headers: {}, rawBody: Buffer.from('name=Ali&email=a@b.co') });
    const text = readFileSync(join(dir, readdirSync(dir)[0] as string), 'utf8');
    expect(text).not.toContain('Ali');
  });

  it('is disabled without WEBHOOK_RECORD_DIR', () => {
    expect(createWebhookRecorder(undefined)).toBeUndefined();
    expect(createWebhookRecorder('')).toBeUndefined();
  });

  it('env: optional in dev, refused in production', () => {
    const base = { ROLE: 'http', DATABASE_URL: 'postgres://slips:slips@localhost:5432/slips' };
    expect(parseEnv(base).WEBHOOK_RECORD_DIR).toBeUndefined();
    expect(parseEnv({ ...base, WEBHOOK_RECORD_DIR: '/tmp/x' }).WEBHOOK_RECORD_DIR).toBe('/tmp/x');
    const prod = { ...base, NODE_ENV: 'production', TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'), OAUTH_STATE_SECRET: 'x'.repeat(32), SALLA_CLIENT_ID: 'id', SALLA_CLIENT_SECRET: 'secret-123', SALLA_REDIRECT_URI: 'https://a.example/cb' };
    expect(() => parseEnv({ ...prod, WEBHOOK_RECORD_DIR: '/tmp/x' })).toThrow(/WEBHOOK_RECORD_DIR/);
    expect(parseEnv(prod).WEBHOOK_RECORD_DIR).toBeUndefined();
  });
});
