import { it, expect } from 'vitest';
import { manifest } from '../../test/manifest.js';
import { formatPrice, selectMedia } from './index.js';
it('chooses processed renditions and processing poster before inspected source', () => {
  const slide = manifest().items[0]!.slides[0]!;
  const base = 'https://api.example';
  expect(selectMedia(slide, base)?.src).toBe(base + '/demo.png');
  slide.status = 'scanned';
  slide.poster_url = '/poster.png';
  slide.source_url = '/original.png';
  expect(selectMedia(slide, base)?.src).toBe(base + '/poster.png');
  slide.poster_url = null;
  expect(selectMedia(slide, base)?.src).toBe(base + '/original.png');
  slide.status = 'failed';
  expect(selectMedia(slide, base)).toBeNull();
});
it('uses currency minor unit exponents', () => {
  const p = manifest().items[0]!.product!;
  expect(formatPrice(p, 'en', 12900)).toContain('129.00');
  p.currency = 'JPY';
  expect(formatPrice(p, 'en', 129)).toContain('129');
  p.currency = 'KWD';
  expect(formatPrice(p, 'en', 1290)).toContain('1.290');
});
it('never renders uninspected importing/uploaded media', () => {
  const s = manifest().items[0]!.slides[0]!;
  s.source_url = '/raw.png';
  s.poster_url = '/poster.png';
  for (const status of ['importing', 'uploaded'] as const) {
    s.status = status;
    expect(selectMedia(s, 'https://api.example')).toBeNull();
  }
});
