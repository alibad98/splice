'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MediaAsset, MediaContentType, MediaKind } from '@slips/contracts';
import { ApiError } from '../../../lib/api/fetch';
import { StorageUploadError, importMedia, uploadMedia } from '../../../lib/api/media';
import { useSession } from '../../session/SessionProvider';

/** At most this many files upload at once (Story 3.6); the rest wait their turn in drop order. */
export const UPLOAD_CONCURRENCY = 3;

/** Why an upload did not finish: the network or storage, the throttle (with the wait), or the API refused the file. */
export type UploadError = { kind: 'network' } | { kind: 'throttled'; minutes: number } | { kind: 'rejected' };

/** What a row brings in: a local file to upload (Story 3.6) or an external link to import (Story 3.7). */
export type UploadSource = { type: 'file'; file: File; contentType: MediaContentType } | { type: 'link'; url: string };

export interface UploadState {
  key: string;
  /** The local file or the link, held for the session so Retry can upload or import it again. */
  source: UploadSource;
  kind: MediaKind;
  /** Object URL of the file, the slide thumb during the session (none for links); revoked on remove and unmount. */
  previewUrl: string | null;
  phase: 'waiting' | 'uploading' | 'done' | 'error';
  /** 0..1 while uploading (a link import has no progress). */
  progress: number;
  error: UploadError | null;
  /** The recorded asset once completed (its status as last known). */
  asset: MediaAsset | null;
  /** When the upload or import request completed (ms), so status polling can stop later. */
  completedAt: number | null;
}

export interface NewUpload {
  key: string;
  source: UploadSource;
  kind: MediaKind;
}

const toUploadError = (err: unknown): UploadError => {
  if (err instanceof ApiError && err.status === 429) return { kind: 'throttled', minutes: Math.max(1, Math.ceil((err.retryAfter ?? 60) / 60)) };
  if (err instanceof ApiError && (err.status === 422 || err.status === 400)) return { kind: 'rejected' };
  return { kind: 'network' };
};

const createUrl = (source: UploadSource): string | null => {
  if (source.type !== 'file') return null;
  try {
    return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(source.file) : null;
  } catch {
    return null;
  }
};
const revokeUrl = (url: string | null) => {
  if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
};

/**
 * The editor's upload queue (Story 3.6): files upload in drop order, at most `UPLOAD_CONCURRENCY` at a time, with
 * progress; links (Story 3.7) are queued the same way and only ask the API to import them. The listener given to `bind`
 * is told when a row's asset is recorded. Failed rows keep their file or link for `retry`. Object URLs are revoked and
 * uploads aborted on remove and on unmount.
 */
export function useUploads() {
  const session = useSession();
  const clientRef = useRef(session?.client);
  const onUploadedRef = useRef<(key: string, asset: MediaAsset) => void>(() => {});
  useEffect(() => {
    clientRef.current = session?.client;
  });
  /** Who hears about finished uploads (the slides list). */
  const bind = useCallback((listener: (key: string, asset: MediaAsset) => void) => {
    onUploadedRef.current = listener;
  }, []);

  const store = useRef(new Map<string, UploadState>());
  const controllers = useRef(new Map<string, AbortController>());
  const [uploads, setUploads] = useState<ReadonlyMap<string, UploadState>>(() => new Map());
  const publish = useCallback(() => setUploads(new Map(store.current)), []);

  const patch = useCallback(
    (key: string, change: Partial<UploadState>) => {
      const current = store.current.get(key);
      if (!current) return;
      store.current.set(key, { ...current, ...change });
      publish();
    },
    [publish],
  );

  const pump = useCallback(() => {
    let running = [...store.current.values()].filter((u) => u.phase === 'uploading').length;
    for (const u of [...store.current.values()]) {
      if (running >= UPLOAD_CONCURRENCY) break;
      if (u.phase !== 'waiting') continue;
      running += 1;
      const controller = new AbortController();
      controllers.current.set(u.key, controller);
      patch(u.key, { phase: 'uploading', progress: 0, error: null });
      const client = clientRef.current;
      const source = u.source;
      const run = !client
        ? Promise.reject(new ApiError(0))
        : source.type === 'file'
          ? uploadMedia(client, source.file, u.kind, { contentType: source.contentType, signal: controller.signal, onProgress: (progress) => patch(u.key, { progress }) })
          : importMedia(client, source.url, u.kind);
      run
        .then((asset) => {
          if (!store.current.has(u.key) || controller.signal.aborted) return;
          patch(u.key, { phase: 'done', progress: 1, asset, completedAt: Date.now() });
          onUploadedRef.current(u.key, asset);
        })
        .catch((err: unknown) => {
          if (!store.current.has(u.key) || (err instanceof StorageUploadError && err.aborted)) return;
          patch(u.key, { phase: 'error', error: toUploadError(err) });
        })
        .finally(() => {
          if (controllers.current.get(u.key) === controller) controllers.current.delete(u.key);
          pump();
        });
    }
  }, [patch]);

  /** Queue files or links (in this order) and start as many as the concurrency allows. A key already held is replaced. */
  const add = useCallback(
    (files: readonly NewUpload[]) => {
      for (const f of files) {
        revokeUrl(store.current.get(f.key)?.previewUrl ?? null);
        store.current.set(f.key, { ...f, previewUrl: createUrl(f.source), phase: 'waiting', progress: 0, error: null, asset: null, completedAt: null });
      }
      publish();
      pump();
    },
    [publish, pump],
  );

  /** Upload the held file, or import the held link, again (a failed row, or an asset that failed). False when nothing is held. */
  const retry = useCallback(
    (key: string): boolean => {
      const current = store.current.get(key);
      if (!current) return false;
      store.current.set(key, { ...current, phase: 'waiting', progress: 0, error: null, asset: null, completedAt: null });
      publish();
      pump();
      return true;
    },
    [publish, pump],
  );

  /** Record a newer status of the uploaded asset (from polling). */
  const setAsset = useCallback((key: string, asset: MediaAsset) => patch(key, { asset }), [patch]);

  /** Forget a row: abort its upload and revoke its thumb. */
  const remove = useCallback(
    (key: string) => {
      controllers.current.get(key)?.abort();
      controllers.current.delete(key);
      revokeUrl(store.current.get(key)?.previewUrl ?? null);
      store.current.delete(key);
      publish();
      pump();
    },
    [publish, pump],
  );

  useEffect(() => {
    const live = store.current;
    const running = controllers.current;
    return () => {
      for (const c of running.values()) c.abort();
      for (const u of live.values()) revokeUrl(u.previewUrl);
    };
  }, []);

  const active = [...uploads.values()].some((u) => u.phase === 'waiting' || u.phase === 'uploading');
  return { uploads, add, retry, remove, setAsset, bind, active };
}

export type Uploads = ReturnType<typeof useUploads>;
