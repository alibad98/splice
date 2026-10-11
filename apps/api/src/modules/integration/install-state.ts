import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const STATE_TTL_MS = 10 * 60 * 1000;

const sign = (secret: Buffer, body: string): Buffer => createHmac('sha256', secret).update(body).digest();
const eq = (a: Buffer, b: Buffer): boolean => a.length === b.length && timingSafeEqual(a, b);

/** OAuth `state`: `<nonce>.<expiry>.<hmac>`. The nonce is also set as an HttpOnly cookie, binding the callback to the browser that started it. */
export function createInstallState(secret: Buffer, now: number): { state: string; nonce: string } {
  const nonce = randomBytes(16).toString('base64url');
  const body = `${nonce}.${now + STATE_TTL_MS}`;
  return { state: `${body}.${sign(secret, body).toString('base64url')}`, nonce };
}

/** True only for an unexpired state signed by us whose nonce equals the cookie's. */
export function verifyInstallState(secret: Buffer, state: string | undefined, cookieNonce: string | undefined, now: number): boolean {
  if (!state || !cookieNonce) return false;
  const [nonce, expiry, mac, extra] = state.split('.');
  if (!nonce || !expiry || !mac || extra !== undefined || !/^\d+$/.test(expiry)) return false;
  if (!eq(Buffer.from(mac, 'base64url'), sign(secret, `${nonce}.${expiry}`))) return false;
  if (Number(expiry) <= now) return false;
  return eq(Buffer.from(nonce), Buffer.from(cookieNonce));
}
