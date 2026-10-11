// Key-based deep redaction for logs and captured errors (NFR3). Over-redacting is
// the safe failure: a key that merely contains a sensitive word is also hidden.

export const REDACTED = '[REDACTED]';

/** Normalised (lower-case, letters and digits only) substrings that mark a key as sensitive. */
const SENSITIVE_PARTS = [
  'authorization',
  'cookie',
  'token',
  'secret',
  'password',
  'passwd',
  'apikey',
  'signature',
  'privatekey',
  'credential',
  'csrf',
  // Shopper PII (never stored or logged).
  'email',
  'phone',
  'mobile',
  'firstname',
  'lastname',
  'fullname',
  'address',
  'customer',
  'name',
  'recipient',
  'street',
  'city',
  'shopper',
  'nationalid',
  'iban',
  'cardnumber',
  'cvv',
];

export function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_PARTS.some((part) => k.includes(part));
}

const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const KEY_VALUE =
  /\b((?:access_|refresh_|id_|api_)?token|code|client_secret|secret|signature|password|passwd|api_?key|authorization)=[^&\s"']*/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;

/** Scrub credential-looking substrings out of free text (error messages, stacks). */
export function scrubString(value: string): string {
  return value
    .replace(BEARER, `$1 ${REDACTED}`)
    .replace(JWT, REDACTED)
    .replace(KEY_VALUE, `$1=${REDACTED}`)
    .replace(EMAIL, REDACTED);
}

const MAX_DEPTH = 8;

/** Return a deep copy of `value` with sensitive keys masked. Never throws, handles cycles. */
export function redact(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[Truncated]';
  seen.add(value);
  try {
    if (value instanceof Error) {
      const out: Record<string, unknown> = {
        type: value.name,
        message: scrubString(value.message),
        stack: value.stack ? scrubString(value.stack) : undefined,
      };
      for (const [k, v] of Object.entries(value)) {
        if (!(k in out)) out[k] = isSensitiveKey(k) ? REDACTED : redact(v, depth + 1, seen);
      }
      return out;
    }
    if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1, seen));
    if (value instanceof Date) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = isSensitiveKey(k) ? REDACTED : redact(v, depth + 1, seen);
    }
    return out;
  } catch {
    return '[Unserializable]';
  } finally {
    seen.delete(value);
  }
}
