import { describe, expect, it } from 'vitest';
import { embedOrigin, frameAncestors, isAdminPath } from './policy';

describe('framing policy', () => {
  it('merchant pages allow only the Salla dashboard origin', () => {
    expect(frameAncestors('/')).toBe('frame-ancestors https://s.salla.sa');
    expect(frameAncestors('/products')).toBe('frame-ancestors https://s.salla.sa');
  });
  it('/admin is never framed', () => {
    for (const p of ['/admin', '/admin/', '/admin/users']) expect(frameAncestors(p)).toBe("frame-ancestors 'none'");
    expect(isAdminPath('/administrator')).toBe(false);
    expect(frameAncestors('/administrator')).toBe('frame-ancestors https://s.salla.sa');
  });
  it('the player preview allows the dashboard and all configured Salla ancestors', () => {
    expect(frameAncestors('/player-preview/index.html')).toBe("frame-ancestors 'self' https://s.salla.sa");
    expect(frameAncestors('/player-preview/index.html', 'https://merchant.example')).toBe("frame-ancestors 'self' https://merchant.example");
    for (const path of ['/player-preview-other/index.html', '/content', '/player-preview/index.html/other']) {
      expect(frameAncestors(path)).toBe('frame-ancestors https://s.salla.sa');
    }
  });
  it('the origin comes from env but must be an https origin (or localhost) and never a wildcard', () => {
    expect(embedOrigin({ EMBED_ALLOWED_ORIGIN: 'https://s.example.com/path?x' })).toBe('https://s.example.com');
    expect(embedOrigin({ EMBED_ALLOWED_ORIGIN: 'http://localhost:4000' })).toBe('http://localhost:4000');
    for (const bad of ['*', 'http://evil.example', 'not a url', '']) expect(embedOrigin({ EMBED_ALLOWED_ORIGIN: bad })).toBe('https://s.salla.sa');
  });
});
