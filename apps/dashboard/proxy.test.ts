import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { proxy } from './proxy';

const get = (path: string, headers: Record<string, string> = {}) =>
  proxy(new NextRequest(`https://app.example.com${path}`, { headers }));

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

  it('redirects top-level document navigations without session cookie to /login', () => {
    const res = get('/', { 'sec-fetch-dest': 'document' });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.example.com/login');
  });

  it('redirects authenticated top-level document navigation on /login to /', () => {
    const req = new NextRequest('https://app.example.com/login', {
      headers: {
        'sec-fetch-dest': 'document',
        cookie: 'slips_session=store.sess.token',
      },
    });
    const res = proxy(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.example.com/');
  });
});
