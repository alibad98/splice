import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  PlatformAuthRejectedError,
  PlatformUnavailableError,
  type CanonicalOrder,
  type CanonicalProduct,
  type CanonicalSubscription,
  type CommercePlatform,
  type EmbeddedIdentity,
  type MerchantProfile,
  type PlatformSession,
  type TokenSet,
  type WebhookRequest,
} from '../../ports/commerce-platform.js';
import type { Telemetry } from '../../ports/telemetry.js';
import {
  SALLA_ADMIN_BASE,
  SALLA_AUTHORIZE_URL,
  SALLA_DEFAULT_SCOPES,
  SALLA_DEFINITIVE_OAUTH_ERRORS,
  SALLA_EMBEDDED_APP_BASE,
  SALLA_INTROSPECT_SOURCE_HEADER,
  SALLA_INTROSPECT_URL,
  SALLA_HEADERS,
  SALLA_SIGNATURE_STRATEGY,
  SALLA_TOKEN_URL,
  SALLA_USER_INFO_URL,
} from './salla-endpoints.js';
import { SallaHttp, type SallaHttpOptions } from './salla-http.js';

export interface SallaConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes?: string;
  /** Partners Portal app id, needed for the subscriptions API. */
  appId?: string;
  /** Webhook signing secret (Story 1.10 wires it). */
  webhookSecret?: string;
}

const TokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.coerce.number().positive(),
  scope: z.string().optional(),
});
const OAuthError = z.object({ error: z.string().optional() });
const UserInfo = z.object({
  data: z.object({
    id: z.union([z.string(), z.number()]).optional(),
    name: z.string().optional(),
    merchant: z.object({
      id: z.union([z.string(), z.number()]),
      name: z.string().optional(),
      username: z.string().optional(),
      domain: z.string().optional(),
    }),
  }),
});
const IntrospectResponse = z.object({
  success: z.boolean().optional(),
  data: z
    .object({
      merchant_id: z.union([z.string(), z.number()]),
      user_id: z.union([z.string(), z.number()]).optional(),
      exp: z.string().optional(),
      // Not in the documented response; checked when present (verify app binding in Story 1.11-1.13).
      app_id: z.union([z.string(), z.number()]).optional(),
      aud: z.union([z.string(), z.number()]).optional(),
      client_id: z.union([z.string(), z.number()]).optional(),
    })
    .nullish(),
});
// Unknown keys (names, phones, addresses...) are dropped by the schemas: AD-5, only whitelisted fields survive.
const Money = z.object({ amount: z.coerce.number(), currency: z.string() });
const ProductsPage = z.object({
  data: z.array(z.object({ id: z.union([z.string(), z.number()]), name: z.string(), price: Money, status: z.string().optional() })),
  pagination: z.object({ currentPage: z.number(), totalPages: z.number() }).optional(),
});
const OrderResponse = z.object({
  data: z.object({
    id: z.union([z.string(), z.number()]),
    status: z.object({ slug: z.string().optional(), name: z.string().optional() }).optional(),
    amounts: z.object({ total: Money }),
    items: z.array(z.object({ product_id: z.union([z.string(), z.number()]), quantity: z.number() })).default([]),
  }),
});
const SubscriptionsResponse = z.object({
  data: z.array(z.object({ id: z.union([z.string(), z.number()]), plan_name: z.string(), plan_type: z.string(), status: z.string().optional() })),
});

/** The token endpoint is called while a refresh transaction and advisory lock are held: never sleep on 429, give up fast. */
const TOKEN_ENDPOINT_LIMITS = { maxRateLimitRetries: 0, timeoutMs: 8_000 } as const;

/** Hostname from a store URL or bare host, lower case; undefined when unusable. */
function hostOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** The Salla adapter for the CommercePlatform port. Payload shapes marked in the research doc are verified in Story 1.11-1.13. */
export class SallaCommercePlatform implements CommercePlatform {
  readonly platform = 'salla' as const;
  private readonly http: SallaHttp;
  private readonly now: () => number;

  constructor(private readonly config: SallaConfig, telemetry: Telemetry, options: SallaHttpOptions = {}) {
    this.http = new SallaHttp(telemetry, options);
    this.now = options.now ?? Date.now;
  }

  readonly auth = {
    buildAuthorizeUrl: (state: string): string => {
      const url = new URL(SALLA_AUTHORIZE_URL);
      url.searchParams.set('client_id', this.config.clientId);
      url.searchParams.set('redirect_uri', this.config.redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', this.config.scopes ?? SALLA_DEFAULT_SCOPES);
      url.searchParams.set('state', state);
      return url.toString();
    },
    exchangeCode: (code: string): Promise<TokenSet> =>
      this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: this.config.redirectUri }),
    refresh: (refreshToken: string): Promise<TokenSet> => this.tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    getMerchantProfile: async (accessToken: string): Promise<MerchantProfile> => {
      const res = await this.http.request(undefined, SALLA_USER_INFO_URL, { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' } });
      if (res.status === 401) throw new PlatformAuthRejectedError('Salla rejected the access token');
      if (!res.ok) throw new PlatformUnavailableError(`Salla user info failed (${res.status})`);
      const parsed = UserInfo.safeParse(await res.json().catch(() => null));
      if (!parsed.success) throw new PlatformUnavailableError('Salla user info response was not recognised');
      const { merchant, name, id } = parsed.data.data;
      const host = hostOf(merchant.domain);
      return {
        platformStoreId: String(merchant.id),
        storeName: merchant.name ?? merchant.username ?? String(merchant.id),
        platformMerchantId: String(id ?? merchant.id),
        ...(name ? { ownerName: name } : {}),
        domains: host ? [host] : [],
      };
    },
  };

  readonly embedded = {
    introspect: async (token: string): Promise<EmbeddedIdentity> => {
      if (!this.config.appId) throw new PlatformUnavailableError('SALLA_APP_ID is not configured');
      const res = await this.http.request(undefined, SALLA_INTROSPECT_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', [SALLA_INTROSPECT_SOURCE_HEADER]: this.config.appId },
        body: JSON.stringify({ env: 'prod', token, iss: 'merchant-dashboard', subject: 'embedded-page' }),
      }, TOKEN_ENDPOINT_LIMITS);
      if (res.status === 401 || res.status === 403) throw new PlatformAuthRejectedError('Salla rejected the embedded token');
      if (res.status >= 400 && res.status < 500 && res.status !== 429) throw new PlatformAuthRejectedError('Salla rejected the embedded token');
      if (!res.ok) throw new PlatformUnavailableError(`Salla introspection failed (${res.status})`);
      const parsed = IntrospectResponse.safeParse(await res.json().catch(() => null));
      if (!parsed.success) throw new PlatformUnavailableError('Salla introspection response was not recognised');
      if (parsed.data.success === false || !parsed.data.data) throw new PlatformAuthRejectedError('Salla did not verify the embedded token');
      const d = parsed.data.data;
      for (const bound of [d.app_id, d.aud, d.client_id]) {
        if (bound !== undefined && String(bound) !== this.config.appId) throw new PlatformAuthRejectedError('Salla embedded token was issued for another app');
      }
      if (!d.exp) throw new PlatformAuthRejectedError('Salla embedded token has no expiry');
      const exp = new Date(d.exp);
      if (Number.isNaN(exp.getTime())) throw new PlatformUnavailableError('Salla introspection response was not recognised');
      if (exp.getTime() <= this.now()) throw new PlatformAuthRejectedError('Salla embedded token has expired');
      return {
        platformStoreId: String(parsed.data.data.merchant_id),
        platformUserId: String(parsed.data.data.user_id ?? parsed.data.data.merchant_id),
        expiresAt: exp,
      };
    },
    openUrl: (): string | undefined => (this.config.appId ? `${SALLA_EMBEDDED_APP_BASE}/${encodeURIComponent(this.config.appId)}` : undefined),
  };

  readonly products = {
    list: async (session: PlatformSession, page: number): Promise<{ items: CanonicalProduct[]; hasMore: boolean }> => {
      const body = ProductsPage.parse(await this.admin(session, `/products?page=${page}`));
      return {
        items: body.data.map((p) => ({ externalId: String(p.id), name: p.name, price: p.price.amount, currency: p.price.currency, status: p.status ?? 'unknown' })),
        hasMore: body.pagination ? body.pagination.currentPage < body.pagination.totalPages : false,
      };
    },
  };

  readonly orders = {
    get: async (session: PlatformSession, externalId: string): Promise<CanonicalOrder> => {
      const { data } = OrderResponse.parse(await this.admin(session, `/orders/${encodeURIComponent(externalId)}`));
      return {
        externalId: String(data.id),
        status: data.status?.slug ?? data.status?.name ?? 'unknown',
        total: data.amounts.total.amount,
        currency: data.amounts.total.currency,
        lines: data.items.map((i) => ({ productExternalId: String(i.product_id), quantity: i.quantity })),
      };
    },
  };

  readonly subscriptions = {
    list: async (session: PlatformSession): Promise<CanonicalSubscription[]> => {
      if (!this.config.appId) throw new Error('SALLA_APP_ID is not configured');
      const body = SubscriptionsResponse.parse(await this.admin(session, `/apps/${encodeURIComponent(this.config.appId)}/subscriptions`));
      return body.data.map((s) => ({ externalId: String(s.id), planName: s.plan_name, planType: s.plan_type, status: s.status ?? 'unknown' }));
    },
  };

  readonly webhooks = {
    verify: (req: WebhookRequest): boolean => {
      const secret = this.config.webhookSecret;
      const header = (name: string): string | undefined => {
        const v = req.headers[name];
        return Array.isArray(v) ? v[0] : v;
      };
      if (!secret || header(SALLA_HEADERS.securityStrategy)?.toLowerCase() !== SALLA_SIGNATURE_STRATEGY) return false;
      const given = header(SALLA_HEADERS.signature);
      if (!given || !/^[0-9a-f]{64}$/i.test(given)) return false;
      const expected = createHmac('sha256', secret).update(req.rawBody).digest();
      return timingSafeEqual(expected, Buffer.from(given, 'hex'));
    },
  };

  private async tokenRequest(grant: Record<string, string>): Promise<TokenSet> {
    const body = new URLSearchParams({ ...grant, client_id: this.config.clientId, client_secret: this.config.clientSecret });
    const res = await this.http.request(undefined, SALLA_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
    }, TOKEN_ENDPOINT_LIMITS);
    if (!res.ok) {
      const err = OAuthError.safeParse(await res.json().catch(() => null));
      const code = err.success ? err.data.error : undefined;
      const definitive = res.status === 401 || (res.status >= 400 && res.status < 500 && !!code && (SALLA_DEFINITIVE_OAUTH_ERRORS as readonly string[]).includes(code));
      if (definitive) throw new PlatformAuthRejectedError(`Salla rejected the grant${code ? ` (${code})` : ''}`);
      throw new PlatformUnavailableError(`Salla token endpoint failed (${res.status})`);
    }
    const parsed = TokenResponse.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new PlatformUnavailableError('Salla token response was not recognised');
    const t = parsed.data;
    return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: new Date(this.now() + t.expires_in * 1000), scopes: (t.scope ?? '').split(/\s+/).filter(Boolean) };
  }

  private async admin(session: PlatformSession, path: string): Promise<unknown> {
    const res = await this.http.request(session.storeId, `${SALLA_ADMIN_BASE}${path}`, { headers: { authorization: `Bearer ${session.accessToken}`, accept: 'application/json' } });
    if (res.status === 401) throw new PlatformAuthRejectedError('Salla rejected the access token');
    if (!res.ok) throw new PlatformUnavailableError(`Salla API failed (${res.status})`);
    return res.json();
  }
}
