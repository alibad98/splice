import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxy } from './proxy';

const get = (path: string, headers: Record<string, string> = {}) =>
  proxy(new NextRequest(`https://app.example.com${path}`, { headers }));

afterEach(() => vi.unstubAllEnvs());

describe('proxy security headers', () => {
  it('merchant pages are framable only by the Salla dashboard origin', () => {
    for (const path of ['/', '/products?lang=en', '/settings']) {
      const res = get(path);
      expect(res.headers.get('content-security-policy')).toBe('frame-ancestors https://s.salla.sa');
      expect(res.headers.get('x-frame-options')).toBeNull();
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    }
  });

  it('/admin is never framable', () => {
    const res = get('/admin');
    expect(res.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('auth paths are never framable', () => {
    for (const path of ['/login', '/forgot-password', '/verify-otp', '/reset-password', '/set-password']) {
      const res = get(path);
      expect(res.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
      expect(res.headers.get('x-frame-options')).toBe('DENY');
    }
  });

  it('still mirrors a valid ?lang into the first-party cookie', () => {
    const res = get('/?lang=en');
    expect(res.cookies.get('slips-locale')?.value).toBe('en');
    expect(get('/?lang=zz').cookies.get('slips-locale')).toBeUndefined();
  });

  it('lets the dev-only UI gallery open without a session outside production', () => {
    const res = get('/ui', { 'sec-fetch-dest': 'document' });
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('still redirects /ui to /login without a session in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const res = get('/ui', { 'sec-fetch-dest': 'document' });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.example.com/login');
  });

  it('redirects top-level document navigations without session cookie to /login', () => {
    const res = get('/', { 'sec-fetch-dest': 'document' });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.example.com/login');
  });

  it('lets /login render when a session cookie is present (the page checks it with the API)', () => {
    // A stale cookie must not bounce /login -> / while the merchant layout bounces / -> /login (redirect loop).
    const req = new NextRequest('https://app.example.com/login', {
      headers: {
        'sec-fetch-dest': 'document',
        cookie: 'slips_session=store.sess.token',
      },
    });
    const res = proxy(req);
    expect(res.headers.get('location')).toBeNull();
    expect(res.status).toBe(200);
  });
});
