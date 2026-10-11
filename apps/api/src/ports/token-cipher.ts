// Envelope encryption port for platform tokens (NFR3). Implementations never log plaintext or key material.

export interface TokenCipher {
  /** Id of the master key that wraps new data keys; stored beside each ciphertext. */
  readonly keyId: string;
  /** Encrypt `plaintext` bound to `aad` (e.g. `<store_id>:access`), so a ciphertext copied to another row fails to decrypt. */
  encrypt(plaintext: string, aad: string): string;
  /** Throws when the envelope is malformed, tampered with, bound to other `aad`, or its master key is unknown. */
  decrypt(envelope: string, aad: string): string;
}

export const TOKEN_CIPHER = Symbol('TokenCipher');
