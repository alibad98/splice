// CommercePlatform port (AD-4): the only way domain code talks to a store platform. Salla lives behind it
// in adapters/salla; canonical shapes here carry no shopper PII (AD-5).

export type PlatformId = 'salla';

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scopes: string[];
}

export interface MerchantProfile {
  /** The platform's store id: with the platform it is the store locator (AD-16). */
  platformStoreId: string;
  storeName: string;
  /** Platform account id of the store owner. */
  platformMerchantId: string;
  ownerName?: string;
  /** Storefront hostnames, lower case. */
  domains: string[];
}

/** A call on behalf of one store. `storeId` keys per-store pacing; the token is never logged. */
export interface PlatformSession {
  storeId: string;
  accessToken: string;
}

export interface CanonicalProduct {
  externalId: string;
  name: string;
  price: number;
  currency: string;
  status: string;
}

export interface CanonicalOrderLine {
  productExternalId: string;
  quantity: number;
}

/** Order without any shopper identity (AD-5). */
export interface CanonicalOrder {
  externalId: string;
  status: string;
  total: number;
  currency: string;
  lines: CanonicalOrderLine[];
}

export interface CanonicalSubscription {
  externalId: string;
  planName: string;
  planType: string;
  status: string;
}

export interface WebhookRequest {
  headers: Readonly<Record<string, string | string[] | undefined>>;
  rawBody: Buffer;
}

export type WebhookKind = 'authorize' | 'installed' | 'uninstalled' | 'other';

/** A verified webhook reduced to what Slips may keep (AD-5, AD-13): no shopper PII, no raw body. */
export interface CanonicalWebhook {
  /** Unique per delivery of one event: a retry of the same event carries the same id. */
  eventId: string;
  /** The platform's event name, kept for the inbox. */
  type: string;
  kind: WebhookKind;
  /** The platform's store id (the store locator, AD-16). */
  platformStoreId: string;
  occurredAt?: Date;
  /** Built from an allow-list of fields; safe to store and log. */
  payload: Record<string, unknown>;
  /** Present only for `authorize` (Easy Mode): the token pair. A secret: stored only envelope-encrypted. */
  tokens?: TokenSet;
}

/** The refresh or code was rejected for good (revoked, expired, already used): the store must be disconnected. */
export class PlatformAuthRejectedError extends Error {
  constructor(message = 'platform rejected the credentials') {
    super(message);
    this.name = 'PlatformAuthRejectedError';
  }
}

/** Network failure, timeout, 5xx, or exhausted rate-limit retries: try again later, change nothing. */
export class PlatformUnavailableError extends Error {
  constructor(message: string, readonly retryAfterSeconds?: number) {
    super(message);
    this.name = 'PlatformUnavailableError';
  }
}

/** Who the platform vouches for after verifying an embedded-page token. Identity comes only from this (AD-12). */
export interface EmbeddedIdentity {
  platformStoreId: string;
  platformUserId: string;
  expiresAt: Date;
}

export interface CommercePlatform {
  readonly platform: PlatformId;
  readonly auth: {
    /** URL the merchant is sent to in order to authorise the app. */
    buildAuthorizeUrl(state: string): string;
    exchangeCode(code: string): Promise<TokenSet>;
    /** Refresh tokens are single-use: call only from `integration.getAccessToken`, under the store's lock. */
    refresh(refreshToken: string): Promise<TokenSet>;
    getMerchantProfile(accessToken: string): Promise<MerchantProfile>;
  };
  readonly embedded: {
    /** Server-side verification of the token the embedded page got from the platform host. Throws PlatformAuthRejectedError for an invalid or expired token, PlatformUnavailableError when the platform cannot be asked. */
    introspect(token: string): Promise<EmbeddedIdentity>;
    /** Where the merchant opens Slips inside the platform dashboard ("Open in Salla"); undefined when not configured. */
    openUrl(): string | undefined;
  };
  readonly products: { list(session: PlatformSession, page: number): Promise<{ items: CanonicalProduct[]; hasMore: boolean }> };
  readonly orders: { get(session: PlatformSession, externalId: string): Promise<CanonicalOrder> };
  readonly subscriptions: { list(session: PlatformSession): Promise<CanonicalSubscription[]> };
  readonly webhooks: {
    /** True only when the signature matches the raw body (timing-safe). */
    verify(req: WebhookRequest): boolean;
    /** Reduce a VERIFIED webhook to its canonical form; null when the body is not a recognisable event. Never throws on bad input. */
    parse(req: WebhookRequest): CanonicalWebhook | null;
  };
}

export const COMMERCE_PLATFORM = Symbol('CommercePlatform');
