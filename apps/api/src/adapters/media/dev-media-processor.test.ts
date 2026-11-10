import { describe, expect, it } from 'vitest';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import type { MediaProcessor } from '../../ports/media-processor.js';
import { DevMediaProcessor, buildMp4Buffer, parseVideoDimensions } from './dev-media-processor.js';

function buildWebmBuffer(width: number, height: number): Buffer {
  // EBML header (0x1A45DFA3) + PixelWidth (0xB0 0x82 <u16>) + PixelHeight (0xBA 0x82 <u16>)
  const buf = Buffer.alloc(16);
  buf.writeUInt32BE(0x1a45dfa3, 0);
  buf[4] = 0xe0;
  buf[5] = 0x88;
  buf[6] = 0xb0;
  buf[7] = 0x82;
  buf.writeUInt16BE(width, 8);
  buf[10] = 0xba;
  buf[11] = 0x82;
  buf.writeUInt16BE(height, 12);
  return buf;
}

describe('DevMediaProcessor (Story 3.8)', () => {
  const processor: MediaProcessor = new DevMediaProcessor();

  it('produces 480p, 720p, 1080p progressive MP4 renditions and a 720x1280 WebP poster for a 1080x1920 video', async () => {
    const src = buildMp4Buffer(1080, 1920);
    expect(parseVideoDimensions(src)).toEqual({ width: 1080, height: 1920 });

    const out = await processor.processVideo(src, 'video/mp4');
    expect(out.map((r) => ({ profile: r.profile, contentType: r.contentType, width: r.width, height: r.height }))).toEqual([
      { profile: '480p', contentType: 'video/mp4', width: 480, height: 854 },
      { profile: '720p', contentType: 'video/mp4', width: 720, height: 1280 },
      { profile: '1080p', contentType: 'video/mp4', width: 1080, height: 1920 },
      { profile: 'poster', contentType: 'image/webp', width: 720, height: 1280 },
    ]);

    for (const r of out) {
      expect(r.bytes.length).toBeGreaterThan(0);
      expect(r.contentType).not.toMatch(/mpegurl|mp2t/i);
      if (r.contentType === 'video/mp4') {
        const sniffed = await fileTypeFromBuffer(r.bytes);
        expect(sniffed?.mime).toBe('video/mp4');
        expect(parseVideoDimensions(r.bytes)).toEqual({ width: r.width, height: r.height });
      } else {
        const meta = await sharp(r.bytes).metadata();
        expect({ format: meta.format, width: meta.width, height: meta.height }).toEqual({
          format: 'webp',
          width: 720,
          height: 1280,
        });
      }
    }
  });

  it('never upscales a 720x1280 video: produces only 480p, 720p and poster (no 1080p)', async () => {
    const src = buildMp4Buffer(720, 1280);
    const out = await processor.processVideo(src, 'video/mp4');
    expect(out.map((r) => r.profile)).toEqual(['480p', '720p', 'poster']);
    expect(out.find((r) => r.profile === '720p')).toMatchObject({ width: 720, height: 1280, contentType: 'video/mp4' });
  });

  it('produces the lowest tier at source dimensions without upscaling when source short side is < 480p', async () => {
    const src = buildMp4Buffer(360, 640);
    const out = await processor.processVideo(src, 'video/mp4');
    expect(out.map((r) => ({ profile: r.profile, contentType: r.contentType, width: r.width, height: r.height }))).toEqual([
      { profile: '480p', contentType: 'video/mp4', width: 360, height: 640 },
      { profile: 'poster', contentType: 'image/webp', width: 720, height: 1280 },
    ]);
  });

  it('parses WebM dimensions and scales landscape videos without upscaling', async () => {
    const src = buildWebmBuffer(1280, 720);
    expect(parseVideoDimensions(src)).toEqual({ width: 1280, height: 720 });
    const out = await processor.processVideo(src, 'video/webm');
    expect(out.map((r) => ({ profile: r.profile, width: r.width, height: r.height }))).toEqual([
      { profile: '480p', width: 854, height: 480 },
      { profile: '720p', width: 1280, height: 720 },
      { profile: 'poster', width: 720, height: 1280 },
    ]);
  });

  it('encodes an image into a web-optimized WebP capped at 1920px on the longer side without upscaling and strips EXIF', async () => {
    const largePng = await sharp({
      create: { width: 2400, height: 3600, channels: 3, background: { r: 20, g: 80, b: 140 } },
    })
      .withMetadata({ exif: { IFD0: { Artist: 'Merchant' } } })
      .jpeg()
      .toBuffer();

    const [large] = await processor.processImage(largePng, 'image/jpeg');
    expect(large).toBeDefined();
    expect(large!.profile).toBe('web');
    expect(large!.contentType).toBe('image/webp');
    expect(large!.width).toBe(1280);
    expect(large!.height).toBe(1920);
    const largeMeta = await sharp(large!.bytes).metadata();
    expect(largeMeta.format).toBe('webp');
    expect(largeMeta.exif).toBeUndefined();

    const smallPng = await sharp({
      create: { width: 1080, height: 1350, channels: 3, background: { r: 100, g: 50, b: 20 } },
    })
      .png()
      .toBuffer();
    const [small] = await processor.processImage(smallPng, 'image/png');
    expect(small).toMatchObject({ profile: 'web', contentType: 'image/webp', width: 1080, height: 1350 });
  });
});
