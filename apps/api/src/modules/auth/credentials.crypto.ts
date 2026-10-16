import { createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

/** setup / reset: proves the email owner passed a code. select: proves the password was right, pending a store choice. */
export type AuthTokenPurpose = 'setup' | 'reset' | 'select';

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const parts = hash.split(':');
  if (parts.length !== 2) return false;
  const [salt, key] = parts;
  if (!salt || !key) return false;
  const keyBuffer = Buffer.from(key, 'hex');
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return keyBuffer.length === derived.length && timingSafeEqual(keyBuffer, derived);
}

export function hashOtp(code: string): string {
  return createHash('sha256').update(code.trim()).digest('hex');
}

export function otpMatches(code: string, codeHash: string): boolean {
  const given = Buffer.from(hashOtp(code), 'hex');
  const stored = Buffer.from(codeHash, 'hex');
  return given.length === stored.length && timingSafeEqual(given, stored);
}

export function generateOtp(): string {
  return randomInt(100000, 1000000).toString();
}

/** A short-lived signed token for `subject` (a login id). */
export function signAuthToken(subject: string, email: string, purpose: AuthTokenPurpose, secret: Buffer): string {
  const timestamp = Date.now().toString();
  const payload = `${subject}:${email.toLowerCase()}:${purpose}:${timestamp}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

export function verifyAuthToken(token: string, expectedPurpose: AuthTokenPurpose, secret: Buffer): { subject: string; email: string } | null {
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const parts = raw.split(':');
    if (parts.length !== 5) return null;
    const [subject, email, purpose, timestampStr, givenSig] = parts;
    if (!subject || !email || !purpose || !timestampStr || !givenSig) return null;
    if (purpose !== expectedPurpose) return null;
    const timestamp = parseInt(timestampStr, 10);
    if (Number.isNaN(timestamp) || Date.now() - timestamp > TOKEN_TTL_MS || timestamp > Date.now() + 60_000) {
      return null;
    }
    const payload = `${subject}:${email}:${purpose}:${timestampStr}`;
    const expectedSig = createHmac('sha256', secret).update(payload).digest('hex');
    const givenBuf = Buffer.from(givenSig, 'hex');
    const expectedBuf = Buffer.from(expectedSig, 'hex');
    if (givenBuf.length !== expectedBuf.length || !timingSafeEqual(givenBuf, expectedBuf)) {
      return null;
    }
    return { subject, email };
  } catch {
    return null;
  }
}
