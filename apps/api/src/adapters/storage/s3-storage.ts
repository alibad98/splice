import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
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
}

const isNotFound = (err: unknown): boolean => {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.name === 'NoSuchBucket' || e?.$metadata?.httpStatusCode === 404;
};

/** ObjectStorage over S3 (MinIO locally). The upload object is never served: no public ACLs, no GET presigning. */
export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket;
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
      return (out.Body as Readable | undefined) ?? null;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, ContentLength: body.length }));
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
  }

  destroy(): void {
    this.client.destroy();
  }
}
