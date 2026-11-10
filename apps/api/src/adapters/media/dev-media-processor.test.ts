import { describe, expect, it } from 'vitest';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { UnparseableMediaError, type MediaProcessor } from '../../ports/media-processor.js';
import { DevMediaProcessor, buildMp4Buffer, parseVideoDimensions } from './dev-media-processor.js';

function buildWebmBuffer(width: number, height: number, scale = 1000000): Buffer {
  const el = (hex: string, data: Buffer) => Buffer.concat([Buffer.from(hex, 'hex'), Buffer.from([0x80 | data.length]), data]);
  const w = Buffer.alloc(2); w.writeUInt16BE(width); const h = Buffer.alloc(2); h.writeUInt16BE(height);
  const duration = Buffer.alloc(8); duration.writeDoubleBE(30000);
  const timeScale = Buffer.alloc(4); timeScale.writeUInt32BE(scale);
  const info = el('1549a966', Buffer.concat([el('4489', duration), el('2ad7b1', timeScale)]));
  const entry = el('ae', Buffer.concat([el('83', Buffer.from([1])), el('e0', Buffer.concat([el('b0', w), el('ba', h)]))]));
  return Buffer.concat([el('1a45dfa3', Buffer.alloc(0)), el('18538067', Buffer.concat([info, el('1654ae6b', entry)]))]);
}

import { qualityCheck } from '../../modules/media/media-process.js';

describe('DevMediaProcessor (Story 3.8)', () => {
  const processor: MediaProcessor = new DevMediaProcessor();

  it('reads independently assembled nested version-1 tracks and extended-size movie boxes', async () => {
    const box = (type: string, data: Buffer, extended = false) => {
      const header = Buffer.alloc(extended ? 16 : 8); header.writeUInt32BE(extended ? 1 : data.length + 8); header.write(type, 4);
      if (extended) header.writeBigUInt64BE(BigInt(data.length + 16), 8);
      return Buffer.concat([header, data]);
    };
    const movie = Buffer.alloc(112); movie[0] = 1; movie.writeUInt32BE(1000, 20); movie.writeBigUInt64BE(45000n, 24);
    const track = Buffer.alloc(96); track[0] = 1; track.writeUInt32BE(1280 * 65536, 88); track.writeUInt32BE(720 * 65536, 92);
    const handler = Buffer.alloc(24); handler.write('vide', 8);
    const bytes = box('moov', Buffer.concat([box('mvhd', movie), box('trak', Buffer.concat([box('tkhd', track), box('mdia', box('hdlr', handler))]))]), true);
    expect(await processor.probe(bytes, 'video/quicktime')).toEqual({ width: 1280, height: 720, durationSeconds: 45, hasVideoTrack: true });
    expect((await processor.probe(buildWebmBuffer(1280, 720, 2000000), 'video/webm')).durationSeconds).toBe(60);
  });

  it('rejects zero movie duration even when a fragmented movie has a video track', async () => {
    const fragment = Buffer.from([0, 0, 0, 8, 0x6d, 0x6f, 0x6f, 0x66]);
    await expect(processor.probe(Buffer.concat([buildMp4Buffer(1080, 1920, undefined, { durationSeconds: 0 }), fragment]), 'video/mp4')).rejects.toBeInstanceOf(UnparseableMediaError);
  });

  it('probes duration, video tracks and image dimensions and rejects unparseable containers', async () => {
    const video = await processor.probe(buildMp4Buffer(720, 1280, undefined, { durationSeconds: 90 }), 'video/mp4');
    expect(video).toEqual({ width: 720, height: 1280, durationSeconds: 90, hasVideoTrack: true });
    expect(qualityCheck('video', video)).toBeNull();
    expect(qualityCheck('video', await processor.probe(buildMp4Buffer(540, 960), 'video/mp4'))).toBe('below_min_resolution');
    expect(qualityCheck('video', await processor.probe(buildMp4Buffer(1080, 1920, undefined, { durationSeconds: 95 }), 'video/quicktime'))).toBe('over_duration');
    expect(qualityCheck('video', await processor.probe(buildMp4Buffer(1080, 1920, undefined, { noVideoTrack: true }), 'video/mp4'))).toBe('no_video_track');
    expect(await processor.probe(buildWebmBuffer(1280, 720), 'video/webm')).toEqual({ width: 1280, height: 720, durationSeconds: 30, hasVideoTrack: true });
    const image = await sharp({ create: { width: 800, height: 1200, channels: 3, background: 'red' } }).jpeg().toBuffer();
    expect(qualityCheck('image', await processor.probe(image, 'image/jpeg'))).toBe('below_min_resolution');
    await expect(processor.probe(Buffer.from('garbage video container'), 'video/mp4')).rejects.toBeInstanceOf(UnparseableMediaError);
  });

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
