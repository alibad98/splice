import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ObjectHead, ObjectStorage, PresignPutInput, PresignedPut } from '../../ports/object-storage.js';

interface StoredObject {
  body: Buffer;
  contentType: string;
}

/**
 * In-memory ObjectStorage for tests. `upload` plays the client's PUT to a presigned URL and enforces what S3 enforces
 * through the signature: the URL is not expired, and length, type and SHA-256 match what was signed.
 */
export class MemoryObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, StoredObject>();
  private readonly grants = new Map<string, PresignPutInput & { expiresAt: number }>();
  /** Set to make every call fail (storage down). */
  failing = false;

  async presignPut(input: PresignPutInput): Promise<PresignedPut> {
    this.check();
    const url = `memory://media/${input.key}?expires=${input.expiresInSeconds}`;
    this.grants.set(url, { ...input, expiresAt: Date.now() + input.expiresInSeconds * 1000 });
    return {
      url,
      method: 'PUT',
      headers: { 'content-type': input.contentType, 'x-amz-checksum-sha256': Buffer.from(input.sha256Hex, 'hex').toString('base64') },
    };
  }

  /** The client's PUT to a presigned URL. Throws like S3 would answer 403/400. */
  upload(url: string, body: Buffer, contentType: string, now = Date.now()): void {
    const grant = this.grants.get(url);
    if (!grant) throw new Error('unknown presigned url');
    if (now > grant.expiresAt) throw new Error('presigned url expired');
    if (body.length !== grant.sizeBytes || contentType !== grant.contentType) throw new Error('signed headers do not match');
    if (createHash('sha256').update(body).digest('hex') !== grant.sha256Hex) throw new Error('checksum mismatch');
    this.objects.set(grant.key, { body, contentType });
  }

  async head(key: string): Promise<ObjectHead | null> {
    this.check();
    const o = this.objects.get(key);
    return o ? { sizeBytes: o.body.length, contentType: o.contentType } : null;
  }

  async getStream(key: string): Promise<Readable | null> {
    this.check();
    const o = this.objects.get(key);
    return o ? Readable.from([o.body]) : null;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.check();
    this.objects.set(key, { body, contentType });
  }

  async delete(key: string): Promise<void> {
    this.check();
    this.objects.delete(key);
  }

  async deletePrefix(prefix: string, limit: number): Promise<{ deleted: number; done: boolean }> {
    this.check();
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
    for (const k of keys.slice(0, limit)) this.objects.delete(k);
    const deleted = Math.min(limit, keys.length);
    return { deleted, done: keys.length <= limit };
  }

  async ensureBucket(): Promise<void> {}

  private check(): void {
    if (this.failing) throw new Error('storage unavailable');
  }
}
