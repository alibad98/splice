import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EnvelopeTokenCipher } from './envelope-cipher.js';

const key = () => randomBytes(32).toString('base64');

describe('EnvelopeTokenCipher', () => {
  const k1 = key();
  const cipher = new EnvelopeTokenCipher({ k1 }, 'k1');

  it('round-trips and never stores the plaintext', () => {
    const env = cipher.encrypt('secret-access-token', 'store-1:access');
    expect(env).not.toContain('secret-access-token');
    expect(env.startsWith('v1.k1.')).toBe(true);
    expect(cipher.decrypt(env, 'store-1:access')).toBe('secret-access-token');
  });

  it('uses a fresh data key and nonce each time', () => {
    expect(cipher.encrypt('t', 'a')).not.toBe(cipher.encrypt('t', 'a'));
  });

  it('refuses another row (aad), tampering and a wrong master key, without echoing secrets', () => {
    const env = cipher.encrypt('tok-123', 'store-1:access');
    expect(() => cipher.decrypt(env, 'store-2:access')).toThrow('could not be decrypted');
    const parts = env.split('.');
    const flipped = Buffer.from(parts[3]!, 'base64url');
    flipped[flipped.length - 1]! ^= 1;
    expect(() => cipher.decrypt([...parts.slice(0, 3), flipped.toString('base64url')].join('.'), 'store-1:access')).toThrow('could not be decrypted');
    const other = new EnvelopeTokenCipher({ k1: key() }, 'k1');
    expect(() => other.decrypt(env, 'store-1:access')).toThrow('could not be decrypted');
    try {
      other.decrypt(env, 'store-1:access');
    } catch (e) {
      expect(String(e)).not.toContain('tok-123');
      expect(String(e)).not.toContain(k1);
    }
    expect(() => cipher.decrypt('garbage', 'x')).toThrow('malformed');
  });

  it('decrypts with an old key id after rotation and wraps new values with the active one', () => {
    const old = new EnvelopeTokenCipher({ k1 }, 'k1').encrypt('abc', 'a');
    const rotated = new EnvelopeTokenCipher({ k1, k2: key() }, 'k2');
    expect(rotated.decrypt(old, 'a')).toBe('abc');
    expect(rotated.encrypt('abc', 'a').startsWith('v1.k2.')).toBe(true);
  });

  it('rejects a master key that is not 32 bytes or an unconfigured active id', () => {
    expect(() => new EnvelopeTokenCipher({ k1: Buffer.from('short').toString('base64') }, 'k1')).toThrow(/32 bytes/);
    expect(() => new EnvelopeTokenCipher({ k1 }, 'k9')).toThrow(/not configured/);
  });
});
