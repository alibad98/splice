import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { proxy } from './proxy';

const get = (path: string) => proxy(new NextRequest(`https://app.example.com${path}`));

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
  it('still mirrors a valid ?lang into the first-party cookie', () => {
    const res = get('/?lang=en');
    expect(res.cookies.get('slips-locale')?.value).toBe('en');
    expect(get('/?lang=zz').cookies.get('slips-locale')).toBeUndefined();
  });
});
