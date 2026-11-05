'use client';

import { useQuery } from '@tanstack/react-query';
import { MediaAsset, MediaUploadGrant, type MediaKind } from '@slips/contracts';
import { useSession } from '../../components/session/SessionProvider';
import type { SessionClient } from '../session/session-client';
import { ApiError, getJson, postJson, sendJson } from './fetch';
import { queryKeys } from './query-keys';

/** How often an `uploaded` asset is asked for again while it waits for inspection (Story 3.6). */
export const MEDIA_STATUS_POLL_MS = 3_000;
/** Polling stops after this long; the slide keeps showing Processing and the next reload has the real status. */
export const MEDIA_STATUS_POLL_MAX_MS = 2 * 60_000;

/** The PUT to storage failed: `status` 0 for a network error or an abort, otherwise the storage HTTP status. */
export class StorageUploadError extends Error {
  constructor(
    readonly status: number,
    readonly aborted = false,
  ) {
    super(aborted ? 'Upload cancelled' : `Storage upload failed (${status})`);
    this.name = 'StorageUploadError';
  }
}

/** Lower-case hex SHA-256 of the file, computed in the browser (Web Crypto). */
export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** PUT the file to the pre-signed URL with the grant's headers; progress is reported 0..1. */
function putToStorage(grant: MediaUploadGrant, file: Blob, opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal }): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(grant.method, grant.url);
    for (const [name, value] of Object.entries(grant.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) opts.onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new StorageUploadError(xhr.status)));
    xhr.onerror = () => reject(new StorageUploadError(0));
    xhr.onabort = () => reject(new StorageUploadError(0, true));
    if (opts.signal) {
      if (opts.signal.aborted) return reject(new StorageUploadError(0, true));
      opts.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(file);
  });
}

/**
 * Upload one file straight to storage (Story 3.5 API): hash it, ask for a grant, PUT it with progress, then complete
 * it. Resolves with the recorded asset (`uploaded`, later `scanned`/`failed`). API failures reject with `ApiError`
 * (429 carries `retryAfter`), the PUT with `StorageUploadError`.
 */
export async function uploadMedia(
  client: SessionClient,
  file: File,
  kind: MediaKind,
  opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal; contentType?: string } = {},
): Promise<MediaAsset> {
  const sha256 = await sha256Hex(file);
  if (opts.signal?.aborted) throw new StorageUploadError(0, true);
  const grant = await sendJson(client, 'POST', '/v1/media/uploads', { kind, content_type: opts.contentType ?? file.type, size_bytes: file.size, sha256 }, MediaUploadGrant);
  await putToStorage(grant, file, opts);
  opts.onProgress?.(1);
  return postJson(client, `/v1/media/uploads/${encodeURIComponent(grant.upload_id)}/complete`, MediaAsset);
}

/**
 * The current status of one asset, polled every 3 s while it is `uploaded` (waiting for inspection), for at most two
 * minutes after `since`. Disabled without an id.
 */
export function useMediaAssetStatus(id: string | null, opts: { enabled?: boolean; since?: number } = {}) {
  const session = useSession();
  const client = session?.client;
  const signedIn = session?.state.status === 'signed-in';
  const since = opts.since ?? 0;
  return useQuery({
    queryKey: queryKeys.media.asset(id ?? ''),
    queryFn: () => getJson(client!, `/v1/media/${encodeURIComponent(id!)}`, MediaAsset),
    enabled: Boolean(client) && signedIn && Boolean(id) && (opts.enabled ?? true),
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => (query.state.data?.status === 'uploaded' && Date.now() - since < MEDIA_STATUS_POLL_MAX_MS ? MEDIA_STATUS_POLL_MS : false),
  });
}
