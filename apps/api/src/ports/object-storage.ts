// ObjectStorage port (Story 3.5): the media bucket. Adapters: S3 (MinIO locally) and in-memory (tests).
import type { Readable } from 'node:stream';

export interface PresignPutInput {
  key: string;
  contentType: string;
  /** Exact body length; signed as `Content-Length`. */
  sizeBytes: number;
  /** Lower-case hex SHA-256 of the body; signed as `x-amz-checksum-sha256` (base64), so storage rejects any other body. */
  sha256Hex: string;
  expiresInSeconds: number;
}

export interface PresignedPut {
  url: string;
  method: 'PUT';
  /** Headers the client must send with the PUT (`Content-Length` is set by the client from the body). */
  headers: Record<string, string>;
}

export interface ObjectHead {
  sizeBytes: number;
  contentType: string | undefined;
}

export interface ObjectStorage {
  presignPut(input: PresignPutInput): Promise<PresignedPut>;
  /** Size and type of an object, or `null` when it does not exist. */
  head(key: string): Promise<ObjectHead | null>;
  /** The object's bytes as a stream, or `null` when it does not exist. */
  getStream(key: string): Promise<Readable | null>;
  put(key: string, body: Buffer, contentType: string, metadata?: { cacheControl?: string }): Promise<void>;
  /** Deletes one object; a missing object is not an error. */
  delete(key: string): Promise<void>;
  /** Deletes up to `limit` objects under `prefix`; `done` once nothing is left under it. */
  deletePrefix(prefix: string, limit: number): Promise<{ deleted: number; done: boolean }>;
  /** Creates the bucket when missing (development boot only). */
  ensureBucket?(): Promise<void>;
}

export const OBJECT_STORAGE = Symbol('ObjectStorage');

/** Fails closed on use when no storage is configured (S3 env unset outside production). */
export function unconfiguredStorage(): ObjectStorage {
  const fail = (): never => {
    throw new Error('Object storage is not configured (S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY)');
  };
  return { presignPut: fail, head: fail, getStream: fail, put: fail, delete: fail, deletePrefix: fail };
}
