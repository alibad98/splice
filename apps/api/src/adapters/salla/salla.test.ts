import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { PlatformAuthRejectedError, PlatformUnavailableError } from '../../ports/commerce-platform.js';
import { Metric } from '../../ports/telemetry.js';
import { PinoTelemetry } from '../telemetry/pino-telemetry.js';
import { SallaCommercePlatform } from './salla-platform.js';
import { parseRetryAfter, SallaHttp } from './salla-http.js';

// Fixtures follow docs/salla-desk-research.md (verify in Story 1.11-1.13 against a real store).
const TOKEN_FIXTURE = { access_token: 'AT-secret-1', refresh_token: 'RT-secret-1', expires_in: 1_209_600, token_type: 'bearer', scope: 'offline_access settings.read' };
const USER_INFO_FIXTURE = {
  status: 200,
  success: true,
  data: {
    id: 99,
    name: 'Owner Name',
    email: 'owner@example.com',
    mobile: '0500000000',
    merchant: { id: 123456, username: 'demo-store', name: 'Demo Store', plan: 'plus', domain: 'https://Demo-Store.salla.sa/' },
  },
};
const ORDER_FIXTURE = {
  data: {
    id: 555,
    status: { slug: 'completed', name: 'Completed' },
    amounts: { total: { amount: 120.5, currency: 'SAR' } },
    items: [{ product_id: 77, quantity: 2, name: 'Thing' }],
    customer: { first_name: 'Sara', last_name: 'X', mobile: '0555', email: 'shopper@example.com' },
    shipping: { address: { street: 'Secret Street 1', city: 'Riyadh' } },
  },
};

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
const telemetry = () => new PinoTelemetry({ role: 'http', level: 'silent' });
const config = { clientId: 'cid', clientSecret: 'csecret-xyz', redirectUri: 'https://api.example.com/v1/integrations/salla/callback', appId: 'app-1', webhookSecret: 'whsec' };

function platform(fetchImpl: typeof fetch, extra: ConstructorParameters<typeof SallaCommercePlatform>[2] = {}) {
  return new SallaCommercePlatform(config, telemetry(), { fetch: fetchImpl, sleep: async () => undefined, ...extra });
}

describe('SallaCommercePlatform auth', () => {
  it('builds the authorize URL with minimal scopes and the state', () => {
    const url = new URL(platform(vi.fn()).auth.buildAuthorizeUrl('st-1'));
    expect(url.origin + url.pathname).toBe('https://accounts.salla.sa/oauth2/auth');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('state')).toBe('st-1');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')!.split(' ')).toEqual(['offline_access', 'settings.read', 'products.read', 'orders.read', 'webhooks.read_write']);
    expect(url.searchParams.get('scope')).not.toMatch(/customers|\.read_write.*\.read_write|carts/);
  });

  it('exchanges a code (form-encoded, secret in the body) into a token set', async () => {
    const f = vi.fn(async () => json(TOKEN_FIXTURE));
    const p = platform(f as unknown as typeof fetch, { now: () => 1_000_000 });
    const tokens = await p.auth.exchangeCode('the-code');
    expect(tokens).toMatchObject({ accessToken: 'AT-secret-1', refreshToken: 'RT-secret-1', scopes: ['offline_access', 'settings.read'] });
    expect(tokens.expiresAt.getTime()).toBe(1_000_000 + 1_209_600_000);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://accounts.salla.sa/oauth2/token');
    expect(String(init.body)).toContain('grant_type=authorization_code');
    expect(String(init.body)).toContain('code=the-code');
  });

  it('maps invalid_grant and 401 to a definitive rejection, other failures to unavailable', async () => {
    const rejected = platform((async () => json({ error: 'invalid_grant' }, { status: 400 })) as unknown as typeof fetch);
    await expect(rejected.auth.refresh('rt')).rejects.toBeInstanceOf(PlatformAuthRejectedError);
    const unauthorized = platform((async () => json({}, { status: 401 })) as unknown as typeof fetch);
    await expect(unauthorized.auth.refresh('rt')).rejects.toBeInstanceOf(PlatformAuthRejectedError);
    const badRequest = platform((async () => json({ error: 'invalid_request' }, { status: 400 })) as unknown as typeof fetch);
    await expect(badRequest.auth.refresh('rt')).rejects.toBeInstanceOf(PlatformUnavailableError);
    const down = platform((async () => json({}, { status: 503 })) as unknown as typeof fetch);
    await expect(down.auth.refresh('rt')).rejects.toBeInstanceOf(PlatformUnavailableError);
    const network = platform((async () => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch);
    await expect(network.auth.refresh('rt')).rejects.toBeInstanceOf(PlatformUnavailableError);
  });

  it('error messages never contain tokens or secrets', async () => {
    const p = platform((async () => json({ error: 'invalid_grant', refresh_token: 'RT-leak' }, { status: 400 })) as unknown as typeof fetch);
    const err = await p.auth.refresh('RT-secret-1').catch((e: unknown) => e as Error);
    expect(String(err)).not.toMatch(/RT-|csecret|AT-/);
  });

  it('reads the merchant profile, lower-casing the host and dropping unlisted fields', async () => {
    const p = platform((async () => json(USER_INFO_FIXTURE)) as unknown as typeof fetch);
    const profile = await p.auth.getMerchantProfile('AT');
    expect(profile).toEqual({ platformStoreId: '123456', storeName: 'Demo Store', platformMerchantId: '99', ownerName: 'Owner Name', domains: ['demo-store.salla.sa'] });
    expect(JSON.stringify(profile)).not.toMatch(/example\.com|0500/);
  });
});

describe('SallaCommercePlatform data', () => {
  it('maps an order to the canonical PII-free shape', async () => {
    const p = platform((async () => json(ORDER_FIXTURE)) as unknown as typeof fetch);
    const order = await p.orders.get({ storeId: 's1', accessToken: 'AT' }, '555');
    expect(order).toEqual({ externalId: '555', status: 'completed', total: 120.5, currency: 'SAR', lines: [{ productExternalId: '77', quantity: 2 }] });
    expect(JSON.stringify(order)).not.toMatch(/Sara|shopper|Secret Street|0555/);
  });

  it('lists products with paging and subscriptions', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json({ data: [{ id: 1, name: 'P', price: { amount: 10, currency: 'SAR' }, status: 'sale' }], pagination: { currentPage: 1, totalPages: 2 } }))
      .mockResolvedValueOnce(json({ data: [{ id: 9, plan_name: 'Pro', plan_type: 'recurring', status: 'active' }] }));
    const p = platform(f as unknown as typeof fetch);
    const session = { storeId: 's1', accessToken: 'AT' };
    expect(await p.products.list(session, 1)).toEqual({ items: [{ externalId: '1', name: 'P', price: 10, currency: 'SAR', status: 'sale' }], hasMore: true });
    expect(await p.subscriptions.list(session)).toEqual([{ externalId: '9', planName: 'Pro', planType: 'recurring', status: 'active' }]);
    expect(String((f.mock.calls[1] as unknown[])[0])).toContain('/apps/app-1/subscriptions');
  });
});

describe('webhook verification', () => {
  const body = Buffer.from('{"event":"order.created"}');
  const sig = createHmac('sha256', 'whsec').update(body).digest('hex');
  const p = platform(vi.fn());
  const headers = { 'x-salla-signature': sig, 'x-salla-security-strategy': 'signature' };

  it('accepts the HMAC of the raw body with the signature strategy', () => {
    expect(p.webhooks.verify({ headers, rawBody: body })).toBe(true);
  });
  it('rejects a changed body, wrong strategy, missing or malformed signature, and no configured secret', () => {
    expect(p.webhooks.verify({ headers, rawBody: Buffer.from('{"event":"order.created" }') })).toBe(false);
    expect(p.webhooks.verify({ headers: { ...headers, 'x-salla-security-strategy': 'token' }, rawBody: body })).toBe(false);
    expect(p.webhooks.verify({ headers: { 'x-salla-security-strategy': 'signature' }, rawBody: body })).toBe(false);
    expect(p.webhooks.verify({ headers: { ...headers, 'x-salla-signature': 'zz' }, rawBody: body })).toBe(false);
    const noSecret = new SallaCommercePlatform({ ...config, webhookSecret: undefined }, telemetry());
    expect(noSecret.webhooks.verify({ headers, rawBody: body })).toBe(false);
  });
});

describe('SallaHttp pacing and Retry-After', () => {
  it('parses Retry-After seconds and HTTP dates', () => {
    expect(parseRetryAfter('7', 0)).toBe(7000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(parseRetryAfter(null, 0)).toBeUndefined();
    expect(parseRetryAfter('soon', 0)).toBeUndefined();
  });

  it('spaces calls for one store but not across stores', async () => {
    const clock = 0;
    const sleeps: number[] = [];
    const http = new SallaHttp(telemetry(), { fetch: (async () => json({})) as unknown as typeof fetch, now: () => clock, sleep: async (ms) => void sleeps.push(ms), minIntervalMs: 500 });
    await Promise.all([http.request('a', 'https://x/1'), http.request('a', 'https://x/2'), http.request('a', 'https://x/3'), http.request('b', 'https://x/4')]);
    expect(sleeps).toEqual([500, 1000]);
  });

  it('waits Retry-After on 429, blocks the whole store meanwhile, then retries', async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const t = telemetry();
    const counter = vi.spyOn(t, 'counter');
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '3' } }))
      .mockResolvedValueOnce(json({ ok: true }));
    const http = new SallaHttp(t, { fetch: f as unknown as typeof fetch, now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; }, minIntervalMs: 500 });
    const res = await http.request('a', 'https://x/1');
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([3000]);
    expect(counter).toHaveBeenCalledWith(Metric.SallaApiFailures, { reason: 'rate_limited' });
  });

  it('gives up with PlatformUnavailableError (carrying retry-after) when limited too long', async () => {
    const f = vi.fn(async () => new Response('', { status: 429, headers: { 'retry-after': '600' } }));
    const http = new SallaHttp(telemetry(), { fetch: f as unknown as typeof fetch, sleep: async () => undefined });
    await expect(http.request('a', 'https://x/1')).rejects.toMatchObject({ name: 'PlatformUnavailableError', retryAfterSeconds: 600 });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('gives up after the retry budget', async () => {
    const f = vi.fn(async () => new Response('', { status: 429, headers: { 'retry-after': '1' } }));
    const http = new SallaHttp(telemetry(), { fetch: f as unknown as typeof fetch, sleep: async () => undefined, maxRateLimitRetries: 2 });
    await expect(http.request('a', 'https://x/1')).rejects.toBeInstanceOf(PlatformUnavailableError);
    expect(f).toHaveBeenCalledTimes(3);
  });
});

// Shape from the embedded SDK source (docs/salla-desk-research.md G8); verify in Story 1.11-1.13 against a real store.
const INTROSPECT_FIXTURE = { success: true, data: { merchant_id: 123456, user_id: 99, exp: '2099-01-01T00:00:00Z' } };

describe('SallaCommercePlatform embedded', () => {
  it('introspects with the app id as S-Source and returns the store the platform vouches for', async () => {
    const f = vi.fn(async () => json(INTROSPECT_FIXTURE));
    const id = await platform(f as unknown as typeof fetch).embedded.introspect('host-token');
    expect(id).toEqual({ platformStoreId: '123456', platformUserId: '99', expiresAt: new Date('2099-01-01T00:00:00Z') });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.salla.dev/exchange-authority/v1/introspect');
    expect((init.headers as Record<string, string>)['S-Source']).toBe('app-1');
    expect(JSON.parse(String(init.body))).toMatchObject({ token: 'host-token' });
  });

  it.each([401, 403, 400, 422])('treats a %s answer as a rejected token', async (status) => {
    const f = vi.fn(async () => json({ success: false }, { status }));
    await expect(platform(f as unknown as typeof fetch).embedded.introspect('t')).rejects.toBeInstanceOf(PlatformAuthRejectedError);
  });

  it('treats success:false, missing data and an expired exp as rejected', async () => {
    for (const body of [{ success: false, data: null }, { success: true }, { success: true, data: { merchant_id: 1, exp: '2000-01-01T00:00:00Z' } }]) {
      const f = vi.fn(async () => json(body));
      await expect(platform(f as unknown as typeof fetch).embedded.introspect('t')).rejects.toBeInstanceOf(PlatformAuthRejectedError);
    }
  });

  it('treats 5xx, 429, network failure, an unrecognised body and a missing app id as unavailable (not a bad token)', async () => {
    for (const f of [vi.fn(async () => json({}, { status: 503 })), vi.fn(async () => json({}, { status: 429 })), vi.fn(async () => { throw new Error('boom'); }), vi.fn(async () => json('nonsense'))]) {
      await expect(platform(f as unknown as typeof fetch).embedded.introspect('t')).rejects.toBeInstanceOf(PlatformUnavailableError);
    }
    const noApp = new SallaCommercePlatform({ ...config, appId: undefined }, telemetry(), { fetch: vi.fn() as unknown as typeof fetch });
    await expect(noApp.embedded.introspect('t')).rejects.toBeInstanceOf(PlatformUnavailableError);
  });

  it('rejects a token issued for another app (app_id, aud or client_id present and different) and accepts a matching one', async () => {
    for (const key of ['app_id', 'aud', 'client_id']) {
      const bad = vi.fn(async () => json({ success: true, data: { ...INTROSPECT_FIXTURE.data, [key]: 'other-app' } }));
      await expect(platform(bad as unknown as typeof fetch).embedded.introspect('t')).rejects.toBeInstanceOf(PlatformAuthRejectedError);
      const good = vi.fn(async () => json({ success: true, data: { ...INTROSPECT_FIXTURE.data, [key]: 'app-1' } }));
      await expect(platform(good as unknown as typeof fetch).embedded.introspect('t')).resolves.toMatchObject({ platformStoreId: '123456' });
    }
  });

  it('rejects a response with no exp instead of inventing one', async () => {
    const f = vi.fn(async () => json({ success: true, data: { merchant_id: 1, user_id: 2 } }));
    await expect(platform(f as unknown as typeof fetch).embedded.introspect('t')).rejects.toBeInstanceOf(PlatformAuthRejectedError);
  });

  it('builds the Open in Salla URL from the app id and none without one', () => {
    expect(platform(vi.fn()).embedded.openUrl()).toBe('https://s.salla.sa/embedded/app/app-1');
    expect(new SallaCommercePlatform({ ...config, appId: undefined }, telemetry()).embedded.openUrl()).toBeUndefined();
  });
});
