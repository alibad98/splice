// Dev/test media processor adapter (Story 3.8). Uses `sharp` for real WebP image optimization and poster generation,
// and a deterministic in-process MP4 generator for video renditions (up to the source video's shorter side, never upscaling).
import { createHash } from 'node:crypto';
import { VIDEO_RENDITION_TIERS, type RenditionProfile } from '@slips/contracts';
import sharp from 'sharp';
import { MAX_IMAGE_PIXELS } from '../../modules/media/media-inspect.js';
import type { MediaProcessor, ProcessedRendition } from '../../ports/media-processor.js';

const IMAGE_MAX_LONG_SIDE = 1920;
const IMAGE_WEBP_QUALITY = 82;
const POSTER_WIDTH = 720;
const POSTER_HEIGHT = 1280;
const DEFAULT_VIDEO_DIMENSIONS = { width: 1080, height: 1920 } as const;

/**
 * Build a minimal ISO-BMFF MP4 buffer with an `ftypisom` header, a `moov/trak/tkhd` box carrying `width` and `height`
 * in 16.16 fixed-point, and an `mdat` payload. Validated by `inspectMedia` and `parseVideoDimensions`.
 */
export function buildMp4Buffer(width: number, height: number, payload: Buffer = Buffer.from('mdat-payload')): Buffer {
  const ftyp = Buffer.from([
    0x00, 0x00, 0x00, 0x18,
    0x66, 0x74, 0x79, 0x70, // 'ftyp'
    0x69, 0x73, 0x6f, 0x6d, // 'isom'
    0x00, 0x00, 0x02, 0x00,
    0x69, 0x73, 0x6f, 0x6d, // 'isom'
    0x6d, 0x70, 0x34, 0x32, // 'mp42'
  ]);

  // tkhd v0 box (92 bytes): width at offset 84, height at offset 88 (16.16 fixed point).
  const tkhd = Buffer.alloc(92);
  tkhd.writeUInt32BE(92, 0);
  tkhd.write('tkhd', 4, 'ascii');
  tkhd.writeUInt8(0, 8); // version 0
  tkhd.writeUInt8(3, 11); // flags: track_enabled | track_in_movie
  tkhd.writeUInt32BE(0x00010000, 48); // identity matrix[0]
  tkhd.writeUInt32BE(0x00010000, 64); // identity matrix[4]
  tkhd.writeUInt32BE(0x40000000, 80); // identity matrix[8]
  tkhd.writeUInt32BE(((width & 0xffff) << 16) >>> 0, 84);
  tkhd.writeUInt32BE(((height & 0xffff) << 16) >>> 0, 88);

  const trakSize = 8 + tkhd.length;
  const trak = Buffer.alloc(8);
  trak.writeUInt32BE(trakSize, 0);
  trak.write('trak', 4, 'ascii');

  const moovSize = 8 + trakSize;
  const moov = Buffer.alloc(8);
  moov.writeUInt32BE(moovSize, 0);
  moov.write('moov', 4, 'ascii');

  const mdatSize = 8 + payload.length;
  const mdat = Buffer.alloc(8);
  mdat.writeUInt32BE(mdatSize, 0);
  mdat.write('mdat', 4, 'ascii');

  return Buffer.concat([ftyp, moov, trak, tkhd, mdat, payload]);
}

/**
 * Extract `{ width, height }` from an MP4/MOV (`tkhd` box) or WebM (`PixelWidth` / `PixelHeight` EBML elements) buffer.
 * Falls back to `1080x1920` when synthetic test bytes omit track headers.
 */
export function parseVideoDimensions(bytes: Buffer): { width: number; height: number } {
  // 1. Scan for MP4 / QuickTime `tkhd` box.
  for (let i = 4; i + 88 <= bytes.length; i++) {
    if (bytes[i] === 0x74 && bytes[i + 1] === 0x6b && bytes[i + 2] === 0x68 && bytes[i + 3] === 0x64) {
      const boxStart = i - 4;
      const boxSize = bytes.readUInt32BE(boxStart);
      const version = bytes[i + 4];
      const wOffset = version === 1 ? boxStart + 96 : boxStart + 84;
      const hOffset = version === 1 ? boxStart + 100 : boxStart + 88;
      if (boxSize >= (version === 1 ? 104 : 92) && hOffset + 4 <= bytes.length) {
        const w = bytes.readUInt32BE(wOffset) >>> 16;
        const h = bytes.readUInt32BE(hOffset) >>> 16;
        if (w > 0 && h > 0) return { width: w, height: h };
      }
    }
  }

  // 2. Scan for WebM EBML PixelWidth (0xB0) + PixelHeight (0xBA) inside a Video element (0xE0).
  if (bytes.length >= 4 && bytes.readUInt32BE(0) === 0x1a45dfa3) {
    let width = 0;
    let height = 0;
    for (let i = 4; i + 4 <= bytes.length; i++) {
      if (bytes[i] === 0xb0 && bytes[i + 1] === 0x82 && i + 4 <= bytes.length) {
        width = bytes.readUInt16BE(i + 2);
      } else if (bytes[i] === 0xba && bytes[i + 1] === 0x82 && i + 4 <= bytes.length) {
        height = bytes.readUInt16BE(i + 2);
      }
      if (width > 0 && height > 0) return { width, height };
    }
  }

  return { ...DEFAULT_VIDEO_DIMENSIONS };
}

function scaleToTier(srcWidth: number, srcHeight: number, tier: number): { width: number; height: number } {
  const shortSide = Math.min(srcWidth, srcHeight);
  if (shortSide <= tier) {
    return { width: srcWidth, height: srcHeight };
  }
  if (srcWidth <= srcHeight) {
    const width = tier;
    const height = Math.max(2, Math.round((srcHeight * (tier / srcWidth)) / 2) * 2);
    return { width, height };
  }
  const height = tier;
  const width = Math.max(2, Math.round((srcWidth * (tier / srcHeight)) / 2) * 2);
  return { width, height };
}

export class DevMediaProcessor implements MediaProcessor {
  async processVideo(bytes: Buffer): Promise<ProcessedRendition[]> {
    if (bytes.length < 12) throw new Error('corrupt video input');
    const { width: srcWidth, height: srcHeight } = parseVideoDimensions(bytes);
    const shortSide = Math.min(srcWidth, srcHeight);

    const eligibleTiers = VIDEO_RENDITION_TIERS.filter((tier) => shortSide >= tier);
    const tiers = eligibleTiers.length > 0 ? eligibleTiers : [VIDEO_RENDITION_TIERS[0]];

    const renditions: ProcessedRendition[] = [];
    for (const tier of tiers) {
      const profile = `${tier}p` as RenditionProfile;
      const { width, height } = scaleToTier(srcWidth, srcHeight, tier);
      const digest = createHash('sha256').update(bytes).update(profile).digest();
      const mp4 = buildMp4Buffer(width, height, digest);
      renditions.push({
        profile,
        contentType: 'video/mp4',
        width,
        height,
        bytes: mp4,
      });
    }

    const seed = createHash('sha256').update(bytes).update('poster').digest();
    const posterBytes = await sharp({
      create: {
        width: POSTER_WIDTH,
        height: POSTER_HEIGHT,
        channels: 3,
        background: { r: seed[0]!, g: seed[1]!, b: seed[2]! },
      },
    })
      .webp({ quality: IMAGE_WEBP_QUALITY })
      .toBuffer();

    renditions.push({
      profile: 'poster',
      contentType: 'image/webp',
      width: POSTER_WIDTH,
      height: POSTER_HEIGHT,
      bytes: posterBytes,
    });

    return renditions;
  }

  async processImage(bytes: Buffer): Promise<ProcessedRendition[]> {
    const { data, info } = await sharp(bytes, { failOn: 'warning', limitInputPixels: MAX_IMAGE_PIXELS })
      .rotate()
      .resize({
        width: IMAGE_MAX_LONG_SIDE,
        height: IMAGE_MAX_LONG_SIDE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: IMAGE_WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });

    return [
      {
        profile: 'web',
        contentType: 'image/webp',
        width: info.width,
        height: info.height,
        bytes: data,
      },
    ];
  }
}
