import { describe, expect, it } from 'vitest';
import { checkLink, inferLinkKind } from './media-link';

describe('media links (Story 3.7)', () => {
  it('accepts http/https links on the default ports, 80 or 443, without user info', () => {
    expect(checkLink(' https://cdn.example.com/a.jpg ')?.href).toBe('https://cdn.example.com/a.jpg');
    expect(checkLink('http://cdn.example.com:80/a')).not.toBeNull();
    expect(checkLink('https://cdn.example.com:443/a')).not.toBeNull();
    for (const bad of ['', 'cdn.example.com/a.jpg', 'ftp://cdn.example.com/a.jpg', 'https://u:p@cdn.example.com/a.jpg', 'http://cdn.example.com:8080/a.jpg', `https://x.com/${'a'.repeat(2048)}`]) {
      expect(checkLink(bad)).toBeNull();
    }
  });

  it('infers the kind from the path extension only', () => {
    const kind = (raw: string) => inferLinkKind(checkLink(raw)!);
    expect(kind('https://x.com/a.JPEG')).toBe('image');
    expect(kind('https://x.com/a/b.webp?w=10#x')).toBe('image');
    expect(kind('https://x.com/clip.MOV')).toBe('video');
    expect(kind('https://x.com/clip.webm')).toBe('video');
    expect(kind('https://x.com/watch?v=a.mp4')).toBeNull();
    expect(kind('https://x.com/file.gif')).toBeNull();
    expect(kind('https://x.mp4/')).toBeNull();
  });
});
