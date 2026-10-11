import { describe, expect, it, vi } from 'vitest';

let header: string | null = null;
let cookie: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => ({ get: () => header }),
  cookies: async () => ({ get: () => (cookie ? { value: cookie } : undefined) }),
}));

const { getLocale } = await import('../i18n/server');

describe('getLocale', () => {
  it('?lang=en (header from proxy) renders en without a cookie', async () => {
    header = 'en'; cookie = undefined;
    expect(await getLocale()).toBe('en');
  });
  it('invalid lang falls back to the cookie, then ar', async () => {
    header = 'zz'; cookie = 'en';
    expect(await getLocale()).toBe('en');
    header = 'zz'; cookie = undefined;
    expect(await getLocale()).toBe('ar');
  });
  it('defaults to ar', async () => {
    header = null; cookie = undefined;
    expect(await getLocale()).toBe('ar');
  });
});
