import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { TokenCipher } from '../../ports/token-cipher.js';

const VERSION = 'v1';
const IV = 12;
const TAG = 16;
const b64 = (b: Buffer): string => b.toString('base64url');

function seal(key: Buffer, plaintext: Buffer, aad: Buffer): Buffer {
  const iv = randomBytes(IV);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(aad);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([iv, ct, c.getAuthTag()]);
}

function open(key: Buffer, sealed: Buffer, aad: Buffer): Buffer {
  if (sealed.length < IV + TAG) throw new Error('malformed token envelope');
  const d = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, IV));
  d.setAAD(aad);
  d.setAuthTag(sealed.subarray(sealed.length - TAG));
  return Buffer.concat([d.update(sealed.subarray(IV, sealed.length - TAG)), d.final()]);
}

/**
 * AES-256-GCM envelope encryption: a fresh random data key encrypts each value; a master key from the
 * environment wraps the data key. Envelope: `v1.<keyId>.<wrapped data key>.<ciphertext>`. Both layers bind `aad`.
 * Error messages never include key material or plaintext.
 */
export class EnvelopeTokenCipher implements TokenCipher {
  private readonly keys: ReadonlyMap<string, Buffer>;
  readonly keyId: string;

  /** `keys` maps key ids to base64-encoded 32-byte master keys; `activeKeyId` wraps new data keys (others still decrypt). */
  constructor(keys: Readonly<Record<string, string>>, activeKeyId: string) {
    const parsed = new Map<string, Buffer>();
    for (const [id, b64Key] of Object.entries(keys)) {
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) throw new Error('invalid master key id');
      const key = Buffer.from(b64Key, 'base64');
      if (key.length !== 32) throw new Error(`master key ${id} must be 32 bytes (base64)`);
      parsed.set(id, key);
    }
    if (!parsed.has(activeKeyId)) throw new Error(`active master key ${activeKeyId} is not configured`);
    this.keys = parsed;
    this.keyId = activeKeyId;
  }

  encrypt(plaintext: string, aad: string): string {
    const master = this.keys.get(this.keyId)!;
    const dataKey = randomBytes(32);
    const a = Buffer.from(aad);
    const wrapped = seal(master, dataKey, a);
    const ct = seal(dataKey, Buffer.from(plaintext, 'utf8'), a);
    dataKey.fill(0);
    return [VERSION, this.keyId, b64(wrapped), b64(ct)].join('.');
  }

  decrypt(envelope: string, aad: string): string {
    const [version, keyId, wrapped, ct, extra] = envelope.split('.');
    if (version !== VERSION || !keyId || !wrapped || !ct || extra !== undefined) throw new Error('malformed token envelope');
    const master = this.keys.get(keyId);
    if (!master) throw new Error(`unknown master key ${keyId.slice(0, 32)}`);
    const a = Buffer.from(aad);
    try {
      const dataKey = open(master, Buffer.from(wrapped, 'base64url'), a);
      try {
        return open(dataKey, Buffer.from(ct, 'base64url'), a).toString('utf8');
      } finally {
        dataKey.fill(0);
      }
    } catch {
      throw new Error('token envelope could not be decrypted');
    }
  }
}
