import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';
import type { ObjectHead, ObjectStorage, PresignPutInput, PresignedPut } from '../../ports/object-storage.js';

export interface S3StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  /** Browser origins allowed to PUT to the pre-signed URLs (the dashboard, Story 3.6); set as bucket CORS at boot. */
  corsOrigins?: readonly string[];
  /** Where a best-effort step (bucket CORS) reports a failure; it never throws. */
  /** Deadline for manifest PUTs only; other media operations retain their existing behavior. */
  manifestPutTimeoutMs?: number;
  warn?: (message: string, fields: Record<string, unknown>) => void;
}

const isNotFound = (err: unknown): boolean => {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.name === 'NoSuchBucket' || e?.$metadata?.httpStatusCode === 404;
};

/** ObjectStorage over S3 (MinIO locally). The upload object is never served: no public ACLs, no GET presigning. */
export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly manifestPutTimeoutMs: number;
  private readonly corsOrigins: readonly string[];
  private readonly warn: (message: string, fields: Record<string, unknown>) => void;

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket;
    this.manifestPutTimeoutMs = config.manifestPutTimeoutMs ?? 10000;
    if (!Number.isInteger(this.manifestPutTimeoutMs) || this.manifestPutTimeoutMs < 1 || this.manifestPutTimeoutMs > 10000) throw new Error('invalid manifest PUT deadline');
    this.corsOrigins = config.corsOrigins ?? [];
    this.warn = config.warn ?? (() => {});
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      // Only the checksum we sign; no SDK-added CRC32 on presigned PUTs or uploads.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  /**
   * A PUT URL that signs `content-type`, `content-length` and `x-amz-checksum-sha256`. The checksum header is kept a
   * header (unhoistable) rather than a query parameter, so storage verifies the body against it.
   */
  async presignPut(input: PresignPutInput): Promise<PresignedPut> {
    const checksum = Buffer.from(input.sha256Hex, 'hex').toString('base64');
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.sizeBytes,
      ChecksumSHA256: checksum,
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn: input.expiresInSeconds,
      signableHeaders: new Set(['content-type', 'content-length', 'x-amz-checksum-sha256']),
      unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
    });
    return { url, method: 'PUT', headers: { 'content-type': input.contentType, 'x-amz-checksum-sha256': checksum } };
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { sizeBytes: Number(out.ContentLength ?? 0), contentType: out.ContentType };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async getStream(key: string): Promise<Readable | null> {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!out.Body) throw new Error('Object storage GET returned no body');
      return out.Body as Readable;
    } catch (err) {
      // GET's explicit S3 missing-key response is distinct from bucket/configuration/proxy failures.
      if ((err as { name?: string } | null)?.name === 'NoSuchKey') return null;
      throw err;
    }
  }

  async put(key: string, body: Buffer, contentType: string, metadata?: { cacheControl?: string }): Promise<void> {
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, CacheControl: metadata?.cacheControl, ContentType: contentType, ContentLength: body.length });
    if (key.startsWith('m/v1/salla/')) await this.client.send(command, { abortSignal: AbortSignal.timeout(this.manifestPutTimeoutMs) });
    else await this.client.send(command);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async deletePrefix(prefix: string, limit: number): Promise<{ deleted: number; done: boolean }> {
    const max = Math.max(1, Math.min(limit, 1000));
    const listed = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, MaxKeys: max }));
    const keys = (listed.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
    if (keys.length > 0) {
      const out = await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys, Quiet: true } }));
      if (out.Errors && out.Errors.length > 0) throw new Error(`storage: ${out.Errors.length} objects under ${prefix} were not deleted`);
    }
    return { deleted: keys.length, done: !listed.IsTruncated };
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (err) {
      if (!isNotFound(err)) throw err;
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
    await this.ensureCors();
  }

  /**
   * Best-effort bucket CORS so the dashboard can PUT straight to the pre-signed URL (Story 3.6): PUT from the configured
   * origins with the signed `content-type` and `x-amz-checksum-sha256` headers. A failure is logged and boot continues
   * (MinIO allows any origin by default and does not implement this call).
   */
  async ensureCors(): Promise<void> {
    if (this.corsOrigins.length === 0) return;
    try {
      await this.client.send(
        new PutBucketCorsCommand({
          Bucket: this.bucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedOrigins: [...this.corsOrigins],
                AllowedMethods: ['PUT'],
                AllowedHeaders: ['content-type', 'x-amz-checksum-sha256'],
                ExposeHeaders: ['etag'],
                MaxAgeSeconds: 3600,
              },
            ],
          },
        }),
      );
    } catch (err) {
      this.warn('media bucket CORS not set', { bucket: this.bucket, error: err instanceof Error ? err.message : String(err) });
    }
  }

  destroy(): void {
    this.client.destroy();
  }
}
