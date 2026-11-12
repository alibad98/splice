// Worker-side inspection of an uploaded asset (Story 3.5): verify, sniff, strip, scan, then `scanned` or `failed`.
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { MEDIA_LIMITS, type MediaContentType, type MediaFailureReason, type MediaKind } from '@slips/contracts';
import { requireStoreContext } from '@slips/db';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { publishEvent, type EventSender } from '../../events/outbox.js';
import type { MalwareScanner } from '../../ports/malware-scanner.js';
import type { ObjectStorage } from '../../ports/object-storage.js';
import { Metric, type Telemetry } from '../../ports/telemetry.js';
import { MediaRepository, type MediaAssetRow } from './media.repository.js';

/** File extension of the stored clean copy, per allowed type. */
const EXTENSIONS: Readonly<Record<MediaContentType, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

const ALLOWED_TYPES = new Set<string>(Object.keys(EXTENSIONS));

/** `stores/{store_id}/assets/{asset_id}/{sha256_of_clean}/original.{ext}`: immutable, content-addressed. */
export const cleanKey = (storeId: string, assetId: string, cleanSha256: string, contentType: MediaContentType): string =>
  `stores/${storeId}/assets/${assetId}/${cleanSha256}/original.${EXTENSIONS[contentType]}`;

const sha256Hex = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/** Reads a stream into memory, or `null` as soon as it passes `maxBytes`. */
export async function readCapped(stream: Readable, maxBytes: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buf.length;
    if (total > maxBytes) {
      stream.destroy();
      return null;
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks, total);
}

/**
 * Largest decoded image accepted (50 MP, e.g. 8660 x 5773): above any phone camera, far below sharp's ~268 MP default, so
 * a small file declaring huge dimensions cannot decompress into gigabytes of pixels.
 */
export const MAX_IMAGE_PIXELS = 50_000_000;

/** Re-encodes an image in its own format, applying and then dropping the EXIF orientation and all metadata (EXIF, GPS, XMP, ICC). */
async function reencodeImage(bytes: Buffer, type: MediaContentType): Promise<Buffer> {
  const image = sharp(bytes, { failOn: 'warning', limitInputPixels: MAX_IMAGE_PIXELS }).rotate();
  if (type === 'image/jpeg') return image.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  if (type === 'image/png') return image.png().toBuffer();
  return image.webp({ quality: 90 }).toBuffer();
}

type Verdict = { status: 'scanned'; storageKey: string; sizeBytes: number } | { status: 'failed'; reason: MediaFailureReason };

/**
 * Inspects one `uploaded` asset inside the job's store context. Failures about the file end in `failed` with a
 * reason; failures that are not (storage or scanner down) throw so the job retries, and on the final attempt the asset
 * is set `failed` (`inspection_failed`). The upload object is deleted only after the verdict commits
 * (`releaseUpload`, run by the `media.asset.scanned`/`failed` handlers), so a rolled-back verdict leaves the bytes for the retry.
 */
export class MediaInspector {
  private readonly repo = new MediaRepository();

  constructor(
    private readonly storage: ObjectStorage,
    private readonly scanner: MalwareScanner,
    private readonly events: EventSender,
    private readonly telemetry: Telemetry,
  ) {}

  async inspect(storeId: string, assetId: string, opts: { finalAttempt: boolean }, now: () => Date = () => new Date()): Promise<void> {
    const asset = await this.repo.findAsset(assetId, { forUpdate: true });
    if (!asset) {
      this.telemetry.log.warn('media inspect: asset not found', { asset_id: assetId });
      return;
    }
    // Already inspected (a redelivered job): nothing to do.
    if (asset.status !== 'uploaded') return;
    let verdict: Verdict;
    try {
      verdict = await this.examine(storeId, asset);
    } catch (err) {
      if (!opts.finalAttempt) throw err;
      this.telemetry.captureError(err, { component: 'media.inspect', asset_id: assetId });
      verdict = { status: 'failed', reason: 'inspection_failed' };
    }
    const tx = requireStoreContext();
    if (verdict.status === 'scanned') {
      await this.repo.finishInspection(assetId, verdict, now());
      await publishEvent(tx, this.events, this.telemetry, 'media.asset.scanned', { v: 1, store_id: storeId, asset_id: assetId, kind: asset.kind, size_bytes: verdict.sizeBytes });
      this.telemetry.counter(Metric.MediaStoredBytes, {}, verdict.sizeBytes);
    } else {
      await this.repo.finishInspection(assetId, verdict, now());
      await publishEvent(tx, this.events, this.telemetry, 'media.asset.failed', { v: 1, store_id: storeId, asset_id: assetId, reason: verdict.reason });
    }
  }

  /**
   * After an inspected asset's verdict committed (in its store context): deletes its upload object unless another upload of
   * the same bytes in this store still needs it (the content-addressed key is shared). Idempotent.
   */
  async releaseUpload(assetId: string, now: Date = new Date()): Promise<void> {
    const asset = await this.repo.findAsset(assetId);
    // An import that failed before its file was stored has no upload object.
    if (!asset || asset.status === 'uploaded' || asset.status === 'importing' || !asset.uploadKey) return;
    if (await this.repo.uploadKeyInUse(asset.uploadKey, { assetId: asset.id }, now)) return;
    await this.storage.delete(asset.uploadKey);
  }

  /** The verdict for the uploaded bytes. Throws only for failures that are not about the file. */
  private async examine(storeId: string, asset: MediaAssetRow): Promise<Verdict> {
    // An `uploaded` asset always has these (a CHECK: they are null only while importing or after a failed import).
    if (!asset.uploadKey || !asset.sha256 || !asset.contentType) throw new Error(`media inspect: uploaded asset ${asset.id} lacks its file fields`);
    const stream = await this.storage.getStream(asset.uploadKey);
    if (!stream) throw new Error(`media inspect: upload object ${asset.uploadKey} is missing`);
    const kind: MediaKind = asset.kind;
    const bytes = await readCapped(stream, MEDIA_LIMITS[kind].max_bytes);
    const reject = async (reason: MediaFailureReason): Promise<Verdict> => ({ status: 'failed', reason });
    // Over the cap or not the declared bytes: either way not the file whose hash was declared.
    if (!bytes || sha256Hex(bytes) !== asset.sha256) return reject('checksum_mismatch');
    const sniffed = (await fileTypeFromBuffer(bytes))?.mime;
    if (!sniffed || !ALLOWED_TYPES.has(sniffed)) return reject('type_not_allowed');
    if (sniffed !== asset.contentType) return reject('type_mismatch');
    const type = sniffed as MediaContentType;
    let clean = bytes;
    if (kind === 'image') {
      const meta = await sharp(bytes, { limitInputPixels: false }).metadata().catch(() => null);
      if (!meta?.width || !meta.height) return reject('corrupt');
      if (meta.width * meta.height > MAX_IMAGE_PIXELS) return reject('image_too_large');
      try {
        clean = await reencodeImage(bytes, type);
      } catch {
        return reject('corrupt');
      }
    }
    // The original bytes are scanned (the re-encoded copy derives from them).
    const scan = await this.scanner.scan(bytes);
    if (scan.infected) {
      this.telemetry.log.warn('media inspect: malware found', { asset_id: asset.id, signature: scan.signature });
      return reject('malware');
    }
    const key = cleanKey(storeId, asset.id, sha256Hex(clean), type);
    await this.storage.put(key, clean, type);
    return { status: 'scanned', storageKey: key, sizeBytes: clean.length };
  }
}
