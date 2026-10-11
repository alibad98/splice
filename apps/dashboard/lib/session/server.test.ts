import { describe, expect, it, vi } from 'vitest';

let cookieValue: string | undefined;
let dest: string | null = null;
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (n === 'slips_session' && cookieValue ? { value: cookieValue } : undefined) }),
  headers: async () => ({ get: (n: string) => (n === 'sec-fetch-dest' ? dest : null) }),
}));

const { getServerSession, isFramedNavigation } = await import('./server');
const { getShellContext } = await import('../shell-context');

const info = { v: 1, mode: 'direct', store: { name: 'متجر' }, connection: { v: 1, state: 'connected', store_name: 'متجر' }, expires_at: '2030-01-01T00:00:00.000Z', csrf_token: 'c' };

describe('getServerSession', () => {
  it('is none without a cookie and never calls the API', async () => {
    cookieValue = undefined;
    const f = vi.fn();
    expect(await getServerSession(f as unknown as typeof fetch)).toEqual({ kind: 'none' });
    expect(f).not.toHaveBeenCalled();
  });
  it('forwards only the session cookie and parses the answer', async () => {
    cookieValue = 'a.b.c';
    const f = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => Response.json(info));
    const s = await getServerSession(f as unknown as typeof fetch);
    expect(s.kind).toBe('signed-in');
    const init = f.mock.calls[0]![1];
    expect(init.headers).toEqual({ cookie: 'slips_session=a.b.c' });
  });
  it('reports an idle-expired session as expired, other failures as none', async () => {
    cookieValue = 'a.b.c';
    expect(await getServerSession((async () => Response.json({ code: 'session_expired' }, { status: 401 })) as unknown as typeof fetch)).toEqual({ kind: 'expired' });
    expect(await getServerSession((async () => Response.json({}, { status: 500 })) as unknown as typeof fetch)).toEqual({ kind: 'none' });
    expect(await getServerSession((async () => { throw new Error('down'); }) as unknown as typeof fetch)).toEqual({ kind: 'none' });
  });
});

describe('shell context', () => {
  it('wires the chip to the real ConnectionStatus of the signed-in store', async () => {
    cookieValue = 'a.b.c';
    vi.stubGlobal('fetch', async () => Response.json(info));
    expect((await getShellContext()).connection).toEqual({ state: 'connected', storeName: 'متجر' });
    vi.stubGlobal('fetch', async () => Response.json({ ...info, connection: { v: 1, state: 'disconnected', store_name: 'متجر' } }));
    expect((await getShellContext()).connection).toEqual({ state: 'not-connected' });
    cookieValue = undefined;
    expect((await getShellContext()).connection).toEqual({ state: 'not-connected' });
    vi.unstubAllGlobals();
  });
  it('knows an iframe navigation from Sec-Fetch-Dest', async () => {
    dest = 'iframe';
    expect(await isFramedNavigation()).toBe(true);
    dest = 'document';
    expect(await isFramedNavigation()).toBe(false);
  });
});
