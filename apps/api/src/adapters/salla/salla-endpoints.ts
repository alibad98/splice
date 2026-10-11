// Every Salla URL, header and field name lives in this adapter and nowhere else (AD-4).
// Sourced from docs/salla-desk-research.md; items tagged "verify in Story 1.11-1.13" need a real store.

export const SALLA_ACCOUNTS_BASE = 'https://accounts.salla.sa';
export const SALLA_AUTHORIZE_URL = `${SALLA_ACCOUNTS_BASE}/oauth2/auth`;
export const SALLA_TOKEN_URL = `${SALLA_ACCOUNTS_BASE}/oauth2/token`;
export const SALLA_USER_INFO_URL = `${SALLA_ACCOUNTS_BASE}/oauth2/user/info`;
export const SALLA_ADMIN_BASE = 'https://api.salla.dev/admin/v2';

/** Default minimal scopes: offline_access issues the refresh token; the rest back catalog sync, order reads and webhook subscription. */
export const SALLA_DEFAULT_SCOPES = 'offline_access settings.read products.read orders.read webhooks.read_write';

export const SALLA_HEADERS = {
  signature: 'x-salla-signature',
  securityStrategy: 'x-salla-security-strategy',
  retryAfter: 'retry-after',
} as const;

/** Webhook security strategy we configure in the Partners Portal (NFR3). */
export const SALLA_SIGNATURE_STRATEGY = 'signature';

/** Merchant API limit on Plus stores is 120 requests/minute; pace at or below it. */
export const SALLA_MIN_INTERVAL_MS = 500;

/** Token-endpoint error codes that mean the grant is gone for good (revoked, expired or already used). */
export const SALLA_DEFINITIVE_OAUTH_ERRORS = ['invalid_grant', 'invalid_token', 'unauthorized_client', 'access_denied'] as const;

/** Embedded-page token verification (verify in Story 1.11-1.13: body and response are from the embedded SDK source, not a live call). */
export const SALLA_INTROSPECT_URL = 'https://api.salla.dev/exchange-authority/v1/introspect';
export const SALLA_INTROSPECT_SOURCE_HEADER = 'S-Source';
/** Merchant dashboard page that hosts the embedded app: `<base>/<appId>`. */
export const SALLA_EMBEDDED_APP_BASE = 'https://s.salla.sa/embedded/app';

/** App events delivered to the app webhook URL (verify in Story 1.13: names from docs, payload fields from the SDK types). */
export const SALLA_APP_EVENTS = {
  authorize: 'app.store.authorize',
  installed: 'app.installed',
  uninstalled: 'app.uninstalled',
} as const;
/** A delivery has no documented event id; the SHA-256 of the raw body stands in (a retry resends the same body). Verify in Story 1.13. */
