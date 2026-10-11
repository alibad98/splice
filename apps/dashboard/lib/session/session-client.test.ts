import { describe, expect, it, vi } from 'vitest';
import type { EmbeddedHost } from '../embedded/host';
import { SessionClient, type SessionState } from './session-client';

const info = (over: Record<string, unknown> = {}) => ({ v: 1, mode: 'embedded', store: { name: 'Demo' }, connection: { v: 1, state: 'connected', store_name: 'Demo' }, expires_at: '2030-01-01T00:00:00.000Z', ...over });
const bearer = (token: string, expires_in = 900) => ({ v: 1, access_token: token, token_type: 'Bearer', expires_in, expires_at: '2030-01-01T00:00:00.000Z' });
const problem = (status: number, code: string) => Response.json({ status, code }, { status, headers: { 'content-type': 'application/problem+json' } });

type TestHost = EmbeddedHost & { token: string | null };
function host(over: Partial<EmbeddedHost> = {}): TestHost {
  const h: TestHost = { token: 'host-1', isFramed: () => true, init: async () => undefined, getToken: () => h.token, refresh: vi.fn(), ready: vi.fn(), ...over };
  return h;
}
const mockFetch = (impl: (url: string, init: RequestInit) => Promise<Response> | Response) => vi.fn(async (url: string, init: RequestInit = {}) => impl(url, init));
function timers() {
  const pending: { fn: () => void; ms: number }[] = [];
  return { pending, setTimer: (fn: () => void, ms: number) => pending.push({ fn, ms }), clearTimer: () => { pending.length = 0; } };
}
const client = (h: EmbeddedHost, fetchImpl: typeof fetch, initial: SessionState = { status: 'loading' }, t = timers()) =>
  Object.assign(new SessionClient({ apiBase: 'https://api.example.com/', host: h, fetch: fetchImpl, setTimer: t.setTimer, clearTimer: t.clearTimer }, initial), { t });

describe('embedded sign-in', () => {
  it('trades the host token for a bearer held in memory, loads the connection, signals ready and schedules a refresh at 80%', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = mockFetch((url, init) => {
      calls.push({ url, init });
      return url.endsWith('/embedded') ? Response.json(bearer('B1', 900)) : Response.json(info());
    });
    const h = host();
    const c = client(h, f as unknown as typeof fetch);
    await c.start();
    expect(c.getState()).toMatchObject({ status: 'signed-in', mode: 'embedded', storeName: 'Demo', connection: { state: 'connected', storeName: 'Demo' } });
    expect(calls[0]!.url).toBe('https://api.example.com/v1/session/embedded');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ token: 'host-1' });
    const second = calls[1]!;
    expect(new Headers(second.init.headers).get('authorization')).toBe('Bearer B1');
    expect(second.init.credentials).toBe('omit'); // no cookie of any kind in embedded mode
    expect(h.ready).toHaveBeenCalledOnce();
    expect(c.t.pending).toHaveLength(1);
    expect(c.t.pending[0]!.ms).toBe(720_000);
    expect(JSON.stringify(c.getState())).not.toContain('B1');
  });

  it('before expiry asks the host for a fresh token again and re-mints, keeping the merchant signed in', async () => {
    let n = 0;
    const f = mockFetch((url) => (url.endsWith('/embedded') ? Response.json(bearer(`B${++n}`)) : Response.json(info())));
    const h = host();
    const c = client(h, f as unknown as typeof fetch);
    await c.start();
    h.token = 'host-2';
    c.t.pending[0]!.fn();
    await vi.waitFor(() => expect(f.mock.calls.filter(([u]) => u.endsWith('/embedded'))).toHaveLength(2));
    expect(JSON.parse(String(f.mock.calls.find(([u], i) => u.endsWith('/embedded') && i > 1)![1]!.body))).toEqual({ token: 'host-2' });
  });

  it('a 401 from the API re-mints once and retries the request', async () => {
    let minted = 0;
    const f = mockFetch((url, init) => {
      if (url.endsWith('/embedded')) return Response.json(bearer(`B${++minted}`));
      if (url.endsWith('/v1/session')) return Response.json(info());
      return new Headers(init.headers).get('authorization') === 'Bearer B1' ? problem(401, 'session_expired') : Response.json({ ok: true });
    });
    const c = client(host(), f as unknown as typeof fetch);
    await c.start();
    const res = await c.apiFetch('/v1/thing');
    expect(await res.json()).toEqual({ ok: true });
    expect(minted).toBe(2);
  });

  it('a stale host token asks the host to refresh and shows an error when there is no session yet', async () => {
    const f = mockFetch(() => problem(401, 'invalid_token'));
    const h = host();
    const c = client(h, f as unknown as typeof fetch);
    await c.start();
    expect(h.refresh).toHaveBeenCalled();
    expect(c.getState()).toEqual({ status: 'error', code: 'invalid_token' });
  });

  it('an uninstalled store shows the reinstall error and no retry loop; platform trouble after sign-in keeps the merchant signed in', async () => {
    const c1 = client(host(), mockFetch(() => problem(403, 'store_not_installed')) as unknown as typeof fetch);
    await c1.start();
    expect(c1.getState()).toEqual({ status: 'error', code: 'store_not_installed' });
    expect(c1.t.pending).toHaveLength(0);

    let fail = false;
    const f = mockFetch((url) => (fail ? problem(503, 'platform_unavailable') : url.endsWith('/embedded') ? Response.json(bearer('B1')) : Response.json(info())));
    const c2 = client(host(), f as unknown as typeof fetch);
    await c2.start();
    fail = true;
    await c2.mint();
    expect(c2.getState().status).toBe('signed-in');
    expect(c2.t.pending).toHaveLength(1); // retry soon
  });

  it('with no host token the page cannot sign in', async () => {
    const h = host();
    h.token = null;
    const c = client(h, vi.fn() as unknown as typeof fetch);
    await c.start();
    expect(c.getState()).toEqual({ status: 'error', code: 'invalid_token' });
  });

  it('sign out ends the session and forgets the bearer', async () => {
    const f = mockFetch((url) => (url.endsWith('/embedded') ? Response.json(bearer('B1')) : url.endsWith('/sign-out') ? new Response(null, { status: 204 }) : Response.json(info())));
    const c = client(host(), f as unknown as typeof fetch);
    await c.start();
    await c.signOut();
    expect(c.getState()).toEqual({ status: 'signed-out', reason: 'signed-out' });
    expect(c.t.pending).toHaveLength(0);
    expect(new Headers(f.mock.calls.at(-1)![1]!.headers).get('authorization')).toBe('Bearer B1');
  });
});

describe('direct-link session', () => {
  const direct = { status: 'signed-in', mode: 'direct', storeName: 'D', connection: { state: 'connected', storeName: 'D' }, csrfToken: 'csrf-1' } as const;

  it('sends the cookie and the CSRF token on state-changing requests only', async () => {
    const f = mockFetch(() => Response.json({}));
    const d = new SessionClient({ apiBase: 'https://api.example.com', host: host({ isFramed: () => false }), fetch: f as unknown as typeof fetch }, direct);
    await d.apiFetch('/v1/a');
    await d.apiFetch('/v1/b', { method: 'POST' });
    const [get, post] = f.mock.calls.map(([, init]) => init!);
    expect(get!.credentials).toBe('include');
    expect(new Headers(get!.headers).get('x-csrf-token')).toBeNull();
    expect(new Headers(post!.headers).get('x-csrf-token')).toBe('csrf-1');
    expect(new Headers(post!.headers).get('authorization')).toBeNull();
      });

  it('returns to sign-in with the expired copy when the session idled out', async () => {
    const f = mockFetch(() => problem(401, 'session_expired'));
    const d = new SessionClient({ apiBase: 'https://api.example.com', host: host({ isFramed: () => false }), fetch: f as unknown as typeof fetch }, direct);
    await d.apiFetch('/v1/a');
    expect(d.getState()).toEqual({ status: 'signed-out', reason: 'expired' });
  });

  it('a direct visit without a session stays signed out and never calls the host', async () => {
    const h = host({ isFramed: () => false });
    const init = vi.spyOn(h, 'init');
    const d = new SessionClient({ apiBase: 'https://api.example.com', host: h, fetch: vi.fn() as unknown as typeof fetch }, { status: 'signed-out', reason: 'expired' });
    await d.start();
    expect(d.getState()).toEqual({ status: 'signed-out', reason: 'expired' });
    expect(init).not.toHaveBeenCalled();
  });
});
