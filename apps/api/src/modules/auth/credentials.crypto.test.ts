import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  generateOtp,
  hashOtp,
  hashPassword,
  signAuthToken,
  verifyAuthToken,
  verifyPassword,
} from './credentials.crypto.js';

describe('credentials.crypto', () => {
  const secret = randomBytes(32);

  describe('password hashing', () => {
    it('hashes and successfully verifies a correct password', async () => {
      const hash = await hashPassword('correct-horse-battery-staple');
      expect(hash).toContain(':');
      expect(hash).not.toContain('correct-horse');
      const ok = await verifyPassword('correct-horse-battery-staple', hash);
      expect(ok).toBe(true);
    });

    it('rejects an incorrect password', async () => {
      const hash = await hashPassword('my-strong-password-123');
      const ok = await verifyPassword('wrong-password', hash);
      expect(ok).toBe(false);
    });

    it('rejects malformed hashes safely', async () => {
      expect(await verifyPassword('test', 'not-a-valid-hash')).toBe(false);
      expect(await verifyPassword('test', '')).toBe(false);
    });
  });

  describe('OTP functions', () => {
    it('generates a 6-digit numeric OTP', () => {
      const otp = generateOtp();
      expect(otp).toMatch(/^\d{6}$/);
    });

    it('consistently hashes OTPs', () => {
      const hash1 = hashOtp('123456');
      const hash2 = hashOtp('123456');
      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(hashOtp('654321'));
    });
  });

  describe('temporary auth tokens', () => {
    it('signs and verifies a valid setup token', () => {
      const token = signAuthToken('store-123', 'merchant@example.com', 'setup', secret);
      const verified = verifyAuthToken(token, 'setup', secret);
      expect(verified).toEqual({
        subject: 'store-123',
        email: 'merchant@example.com',
      });
    });

    it('refuses token with mismatched purpose', () => {
      const token = signAuthToken('store-123', 'merchant@example.com', 'setup', secret);
      expect(verifyAuthToken(token, 'reset', secret)).toBeNull();
    });

    it('refuses token signed with a different secret', () => {
      const token = signAuthToken('store-123', 'merchant@example.com', 'reset', secret);
      const otherSecret = randomBytes(32);
      expect(verifyAuthToken(token, 'reset', otherSecret)).toBeNull();
    });

    it('refuses tampered tokens', () => {
      const token = signAuthToken('store-123', 'merchant@example.com', 'reset', secret);
      const tampered = token.slice(0, -3) + 'abc';
      expect(verifyAuthToken(tampered, 'reset', secret)).toBeNull();
    });
  });
});
