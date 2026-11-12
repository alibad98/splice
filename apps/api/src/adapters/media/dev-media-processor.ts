// Dev/test media processor adapter (Story 3.8). Uses `sharp` for real WebP image optimization and poster generation,
// and a deterministic in-process MP4 generator for video renditions (up to the source video's shorter side, never upscaling).
import { createHash } from 'node:crypto';
import { VIDEO_RENDITION_TIERS, type RenditionProfile } from '@slips/contracts';
import sharp from 'sharp';
import { MAX_IMAGE_PIXELS } from '../../modules/media/media-inspect.js';
import { UnparseableMediaError, type MediaProbe, type MediaProcessor, type ProcessedRendition } from '../../ports/media-processor.js';

const IMAGE_MAX_LONG_SIDE = 1920;
const IMAGE_WEBP_QUALITY = 82;
const POSTER_WIDTH = 720;
const POSTER_HEIGHT = 1280;


/**
 * Build a minimal ISO-BMFF MP4 buffer with an `ftypisom` header, a `moov/trak/tkhd` box carrying `width` and `height`
 * in 16.16 fixed-point, and an `mdat` payload. Validated by `inspectMedia` and `parseVideoDimensions`.
 */
export function buildMp4Buffer(width: number, height: number, payload: Buffer = Buffer.from('mdat-payload'), options: { durationSeconds?: number; noVideoTrack?: boolean } = {}): Buffer {
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

  const mvhd = Buffer.alloc(108);
  mvhd.writeUInt32BE(mvhd.length, 0); mvhd.write('mvhd', 4);
  mvhd.writeUInt32BE(1000, 20); mvhd.writeUInt32BE(Math.round((options.durationSeconds ?? 30) * 1000), 24);
  const hdlr = Buffer.alloc(32);
  hdlr.writeUInt32BE(hdlr.length, 0); hdlr.write('hdlr', 4); hdlr.write(options.noVideoTrack ? 'soun' : 'vide', 16);
  if (options.noVideoTrack) { tkhd.writeUInt32BE(0, 84); tkhd.writeUInt32BE(0, 88); }
  const mdia = Buffer.alloc(8);
  mdia.writeUInt32BE(8 + hdlr.length, 0); mdia.write('mdia', 4);
  const trakSize = 8 + tkhd.length + mdia.length + hdlr.length;
  const trak = Buffer.alloc(8);
  trak.writeUInt32BE(trakSize, 0);
  trak.write('trak', 4, 'ascii');

  const moovSize = 8 + mvhd.length + trakSize;
  const moov = Buffer.alloc(8);
  moov.writeUInt32BE(moovSize, 0);
  moov.write('moov', 4, 'ascii');

  const mdatSize = 8 + payload.length;
  const mdat = Buffer.alloc(8);
  mdat.writeUInt32BE(mdatSize, 0);
  mdat.write('mdat', 4, 'ascii');

  return Buffer.concat([ftyp, moov, mvhd, trak, tkhd, mdia, hdlr, mdat, payload]);
}

interface Box { type: string; data: Buffer }
function boxes(bytes: Buffer): Box[] {
  const result: Box[] = [];
  for (let offset = 0; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw new UnparseableMediaError('truncated box');
    let size = bytes.readUInt32BE(offset); let header = 8;
    if (size === 1) { if (offset + 16 > bytes.length) throw new UnparseableMediaError(); size = Number(bytes.readBigUInt64BE(offset + 8)); header = 16; }
    if (size === 0) size = bytes.length - offset;
    if (size < header || offset + size > bytes.length) throw new UnparseableMediaError('invalid box size');
    result.push({ type: bytes.toString('ascii', offset + 4, offset + 8), data: bytes.subarray(offset + header, offset + size) });
    offset += size;
  }
  return result;
}
function mp4Probe(bytes: Buffer): MediaProbe {
  const moov = boxes(bytes).find(b => b.type === 'moov');
  if (!moov) throw new UnparseableMediaError('missing movie');
  const children = boxes(moov.data); const mvhd = children.find(b => b.type === 'mvhd')?.data;
  if (!mvhd) throw new UnparseableMediaError('missing duration');
  const version = mvhd[0]; const scaleOffset = version === 1 ? 20 : 12; const durationOffset = version === 1 ? 24 : 16;
  if (mvhd.length < durationOffset + (version === 1 ? 8 : 4)) throw new UnparseableMediaError();
  const scale = mvhd.readUInt32BE(scaleOffset);
  const duration = version === 1 ? Number(mvhd.readBigUInt64BE(durationOffset)) : mvhd.readUInt32BE(durationOffset);
  if (!scale || !Number.isFinite(duration) || duration <= 0) throw new UnparseableMediaError();
  let width = 0; let height = 0; let hasVideoTrack = false;
  for (const trak of children.filter(b => b.type === 'trak')) {
    const parts = boxes(trak.data); const tkhd = parts.find(b => b.type === 'tkhd')?.data;
    const mdia = parts.find(b => b.type === 'mdia');
    const hdlr = (mdia ? boxes(mdia.data) : parts).find(b => b.type === 'hdlr')?.data;
    if (!tkhd) continue;
    const w = tkhd[0] === 1 ? 88 : 76;
    if (tkhd.length < w + 8) throw new UnparseableMediaError();
    const tw = tkhd.readUInt32BE(w) / 65536; const th = tkhd.readUInt32BE(w + 4) / 65536;
    if (hdlr && hdlr.length >= 12 && hdlr.toString('ascii', 8, 12) === 'vide' && tw > 0 && th > 0) {
      hasVideoTrack = true; width = tw; height = th; break;
    }
  }
  return { width, height, hasVideoTrack, durationSeconds: duration / scale };
}
interface Element { id: number; data: Buffer }
function ebmlElements(bytes: Buffer): Element[] {
  const result: Element[] = [];
  for (let offset = 0; offset < bytes.length;) {
    const read = (isId: boolean): number => {
      const first = bytes[offset]; if (!first) throw new UnparseableMediaError();
      let length = 1; while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
      if (length > (isId ? 4 : 8) || offset + length > bytes.length) throw new UnparseableMediaError();
      let value = isId ? first : first & (0xff >> length); offset++;
      for (let i = 1; i < length; i++) value = value * 256 + bytes[offset++]!;
      return !isId && value === 2 ** (7 * length) - 1 ? bytes.length - offset : value;
    };
    const id = read(true); const size = read(false);
    if (!Number.isSafeInteger(size) || offset + size > bytes.length) throw new UnparseableMediaError();
    result.push({ id, data: bytes.subarray(offset, offset + size) }); offset += size;
  }
  return result;
}
const uint = (b: Buffer): number => { if (!b.length || b.length > 8) throw new UnparseableMediaError(); let v = 0; for (const n of b) v = v * 256 + n; return v; };
function webmProbe(bytes: Buffer): MediaProbe {
  const root = ebmlElements(bytes); const segment = root.find(e => e.id === 0x18538067);
  if (!segment || !root.some(e => e.id === 0x1a45dfa3)) throw new UnparseableMediaError();
  const parts = ebmlElements(segment.data); const info = parts.find(e => e.id === 0x1549a966);
  if (!info) throw new UnparseableMediaError();
  const values = ebmlElements(info.data); const scale = values.find(e => e.id === 0x2ad7b1);
  const duration = values.find(e => e.id === 0x4489)?.data;
  if (!duration || ![4, 8].includes(duration.length)) throw new UnparseableMediaError();
  const durationSeconds = (duration.length === 4 ? duration.readFloatBE() : duration.readDoubleBE()) * (scale ? uint(scale.data) : 1000000) / 1e9;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new UnparseableMediaError();
  const tracks = parts.find(e => e.id === 0x1654ae6b);
  for (const entry of tracks ? ebmlElements(tracks.data).filter(e => e.id === 0xae) : []) {
    const fields = ebmlElements(entry.data); const type = fields.find(e => e.id === 0x83);
    const video = fields.find(e => e.id === 0xe0);
    if (!type || uint(type.data) !== 1 || !video) continue;
    const dims = ebmlElements(video.data); const w = dims.find(e => e.id === 0xb0); const h = dims.find(e => e.id === 0xba);
    if (!w || !h || !uint(w.data) || !uint(h.data)) throw new UnparseableMediaError();
    return { width: uint(w.data), height: uint(h.data), hasVideoTrack: true, durationSeconds };
  }
  return { width: 0, height: 0, hasVideoTrack: false, durationSeconds };
}
export function parseVideoDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 4) throw new UnparseableMediaError();
  const { width, height } = bytes.readUInt32BE(0) === 0x1a45dfa3 ? webmProbe(bytes) : mp4Probe(bytes);
  return { width, height };
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
  async probe(bytes: Buffer, contentType: string): Promise<MediaProbe> {
    try {
      if (contentType.startsWith('image/')) {
        const meta = await sharp(bytes, { failOn: 'warning', limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
        if (!meta.width || !meta.height) throw new UnparseableMediaError();
        return { width: meta.width, height: meta.height, durationSeconds: null, hasVideoTrack: false };
      }
      return contentType === 'video/webm' ? webmProbe(bytes) : mp4Probe(bytes);
    } catch (err) { if (err instanceof UnparseableMediaError) throw err; throw new UnparseableMediaError('unparseable media'); }
  }
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
