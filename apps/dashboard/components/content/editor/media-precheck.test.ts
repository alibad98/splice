import { describe, expect, it, vi } from 'vitest';
import { classify, precheckBasics, precheckFile, precheckMeta } from './media-precheck';

const MB = 1024 * 1024;
const meta = (width: number, height: number, duration?: number) => ({ width, height, ...(duration !== undefined ? { duration } : {}) });

describe('media pre-check (Story 3.6)', () => {
  it('classifies the allowed types, falling back to the extension when the browser gives none; SVG and GIF are refused', () => {
    expect(classify({ name: 'a.jpg', type: 'image/jpeg' })).toEqual({ kind: 'image', contentType: 'image/jpeg' });
    expect(classify({ name: 'clip.MOV', type: '' })).toEqual({ kind: 'video', contentType: 'video/quicktime' });
    expect(classify({ name: 'clip.webm', type: 'video/webm' })).toEqual({ kind: 'video', contentType: 'video/webm' });
    expect(classify({ name: 'logo.svg', type: 'image/svg+xml' })).toBeNull();
    expect(classify({ name: 'a.gif', type: 'image/gif' })).toBeNull();
    expect(classify({ name: 'notes.txt', type: '' })).toBeNull();
  });

  it('refuses images over 10 MB and videos over 200 MB, at the limit allowed', () => {
    expect(precheckBasics({ name: 'a.png', type: 'image/png', size: 10 * MB })).toMatchObject({ ok: true, kind: 'image' });
    expect(precheckBasics({ name: 'a.png', type: 'image/png', size: 12 * MB })).toEqual({ ok: false, reason: 'imageSize' });
    expect(precheckBasics({ name: 'v.mp4', type: 'video/mp4', size: 200 * MB })).toMatchObject({ ok: true, kind: 'video' });
    expect(precheckBasics({ name: 'v.mp4', type: 'video/mp4', size: 200 * MB + 1 })).toEqual({ ok: false, reason: 'videoSize' });
    expect(precheckBasics({ name: 'logo.svg', type: 'image/svg+xml', size: 10 })).toEqual({ ok: false, reason: 'type' });
  });

  it('checks the shorter side and the duration; an unreadable image is refused, an unreadable video passes', () => {
    expect(precheckMeta('image', meta(1080, 1920))).toBeNull();
    expect(precheckMeta('image', meta(1920, 800))).toBe('imageResolution');
    expect(precheckMeta('image', null)).toBe('unreadable');
    expect(precheckMeta('image', meta(0, 0))).toBe('unreadable');
    expect(precheckMeta('video', meta(1080, 1920, 30))).toBeNull();
    expect(precheckMeta('video', meta(720, 1280, 90))).toBeNull();
    expect(precheckMeta('video', meta(1080, 1920, 95))).toBe('videoDuration');
    expect(precheckMeta('video', meta(480, 854, 30))).toBe('videoResolution');
    expect(precheckMeta('video', null)).toBeNull();
    // Metadata without dimensions (audio-only or not yet known) skips the resolution check.
    expect(precheckMeta('video', meta(0, 0, Number.NaN))).toBeNull();
  });

  it('runs the basics before reading metadata, and a reader that throws counts as unreadable', async () => {
    const read = vi.fn().mockResolvedValue(meta(1200, 1600));
    const big = new File(['x'], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 12 * MB });
    expect(await precheckFile(big, read)).toEqual({ ok: false, reason: 'imageSize' });
    expect(read).not.toHaveBeenCalled();

    const ok = new File(['x'], 'ok.jpg', { type: 'image/jpeg' });
    expect(await precheckFile(ok, read)).toEqual({ ok: true, kind: 'image', contentType: 'image/jpeg' });
    expect(read).toHaveBeenCalledWith(ok, 'image');
    expect(await precheckFile(ok, () => Promise.reject(new Error('decode')))).toEqual({ ok: false, reason: 'unreadable' });
    const mov = new File(['x'], 'clip.mov', { type: 'video/quicktime' });
    expect(await precheckFile(mov, () => Promise.resolve(null))).toMatchObject({ ok: true, kind: 'video' });
  });

  it('keeps detected dimensions for resolution errors in either orientation and accepts the exact minimum', async () => {
    const video = new File(['x'], 'clip.MOV', { type: 'video/quicktime' });
    for (const [width, height] of [[480, 854], [854, 480]] as const) {
      expect(await precheckFile(video, async () => meta(width, height, 30))).toEqual({
        ok: false, reason: 'videoResolution', width, height,
      });
    }
    expect(await precheckFile(video, async () => meta(1280, 720, 90))).toMatchObject({ ok: true });
    const image = new File(['x'], 'small.jpg', { type: 'image/jpeg' });
    expect(await precheckFile(image, async () => meta(800, 1200))).toEqual({
      ok: false, reason: 'imageResolution', width: 800, height: 1200,
    });
  });
});
