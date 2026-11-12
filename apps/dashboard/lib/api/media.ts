'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MediaAsset, MediaUploadGrant, type MediaKind } from '@slips/contracts';
import { useSession } from '../../components/session/SessionProvider';
import type { SessionClient } from '../session/session-client';
import { ApiError, apiUrl, getJson, postJson, sendJson } from './fetch';
import { queryKeys } from './query-keys';

/** How often an `importing` or `uploaded` asset is asked for again while it waits for its import or inspection (Stories 3.6, 3.7). */
export const MEDIA_STATUS_POLL_MS = 3_000;
/** Polling stops after this long; the slide keeps showing Processing and the next reload has the real status. */
export const MEDIA_STATUS_POLL_MAX_MS = 2 * 60_000;
/** Imports poll longer: the worker may take up to 2 minutes per fetch attempt and retries (Story 3.7). */
export const MEDIA_IMPORT_POLL_MAX_MS = 10 * 60_000;

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
 * Import the file at an external link (Story 3.7): the API records an `importing` asset that the worker fetches and then
 * inspects like an upload. API failures reject with `ApiError` (422 `media-url-not-allowed`, 429 with `retryAfter`).
 */
export function importMedia(client: SessionClient, url: string, kind: MediaKind): Promise<MediaAsset> {
  return sendJson(client, 'POST', '/v1/media/imports', { kind, url }, MediaAsset);
}

/** Resolve a `poster_url` from a media asset or content slide to a browser-usable URL, or `null` when absent (Story 3.8). */
export const posterUrl = (url: string | null | undefined, apiBase?: string): string | null => (url ? apiUrl(url, apiBase) : null);

/**
 * Resolve a `poster_url` for an `<img>` tag (Story 3.8): in embedded mode with an in-memory Bearer token (`hasBearer`),
 * fetches via `session.client.apiFetch` and creates a blob URL so the `Authorization` header is sent; in direct cookie
 * mode (or when no bearer is held), returns `posterUrl(url, session?.client?.apiBase)`.
 */
export function usePosterSrc(url: string | null | undefined): string | null {
  const session = useSession();
  const client = session?.client as (SessionClient & { apiBase?: string; hasBearer?: boolean }) | undefined;
  const useBearerFetch = Boolean(url && session?.state.status === 'signed-in' && session.state.mode === 'embedded' && client?.hasBearer);
  const [blobState, setBlobState] = useState<{ url: string; objectUrl: string } | null>(null);

  useEffect(() => {
    if (!url || !useBearerFetch || !client) return;
    let cancelled = false;
    let created: string | null = null;
    void client
      .apiFetch(url)
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (!blob || cancelled) return;
        created = URL.createObjectURL(blob);
        setBlobState({ url, objectUrl: created });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [client, url, useBearerFetch]);

  if (!url) return null;
  if (useBearerFetch) return blobState?.url === url ? blobState.objectUrl : null;
  return posterUrl(url, client?.apiBase);
}

/** Statuses that are still on their way (polled until `processed` or `failed`, Story 3.8). */
const PENDING_STATUSES: ReadonlySet<MediaAsset['status']> = new Set(['importing', 'uploaded', 'scanned']);
export const isPendingAssetStatus = (status: MediaAsset['status'] | undefined): boolean => status !== undefined && PENDING_STATUSES.has(status);

/**
 * The current status of one asset, polled every 3 s while it is `importing` or `uploaded` (waiting for its import or
 * inspection), for at most `maxMs` (two minutes by default) after `since`. Disabled without an id.
 */
export function useMediaAssetStatus(id: string | null, opts: { enabled?: boolean; since?: number; maxMs?: number } = {}) {
  const session = useSession();
  const client = session?.client;
  const signedIn = session?.state.status === 'signed-in';
  const since = opts.since ?? 0;
  const maxMs = opts.maxMs ?? MEDIA_STATUS_POLL_MAX_MS;
  return useQuery({
    queryKey: queryKeys.media.asset(id ?? ''),
    queryFn: () => getJson(client!, `/v1/media/${encodeURIComponent(id!)}`, MediaAsset),
    enabled: Boolean(client) && signedIn && Boolean(id) && (opts.enabled ?? true),
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => (isPendingAssetStatus(query.state.data?.status) && Date.now() - since < maxMs ? MEDIA_STATUS_POLL_MS : false),
  });
}
