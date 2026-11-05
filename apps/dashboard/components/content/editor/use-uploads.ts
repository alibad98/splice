'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MediaAsset, MediaContentType, MediaKind } from '@slips/contracts';
import { ApiError } from '../../../lib/api/fetch';
import { StorageUploadError, uploadMedia } from '../../../lib/api/media';
import { useSession } from '../../session/SessionProvider';

/** At most this many files upload at once (Story 3.6); the rest wait their turn in drop order. */
export const UPLOAD_CONCURRENCY = 3;

/** Why an upload did not finish: the network or storage, the throttle (with the wait), or the API refused the file. */
export type UploadError = { kind: 'network' } | { kind: 'throttled'; minutes: number } | { kind: 'rejected' };

export interface UploadState {
  key: string;
  /** The local file, held for the session so Retry can upload it again. */
  file: File;
  kind: MediaKind;
  contentType: MediaContentType;
  /** Object URL of the file, the slide thumb during the session; revoked on remove and unmount. */
  previewUrl: string | null;
  phase: 'waiting' | 'uploading' | 'done' | 'error';
  /** 0..1 while uploading. */
  progress: number;
  error: UploadError | null;
  /** The recorded asset once completed (its status as last known). */
  asset: MediaAsset | null;
  /** When the upload completed (ms), so status polling can stop two minutes later. */
  completedAt: number | null;
}

export interface NewUpload {
  key: string;
  file: File;
  kind: MediaKind;
  contentType: MediaContentType;
}

const toUploadError = (err: unknown): UploadError => {
  if (err instanceof ApiError && err.status === 429) return { kind: 'throttled', minutes: Math.max(1, Math.ceil((err.retryAfter ?? 60) / 60)) };
  if (err instanceof ApiError && (err.status === 422 || err.status === 400)) return { kind: 'rejected' };
  return { kind: 'network' };
};

const createUrl = (file: File): string | null => {
  try {
    return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null;
  } catch {
    return null;
  }
};
const revokeUrl = (url: string | null) => {
  if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
};

/**
 * The editor's upload queue (Story 3.6): files upload in drop order, at most `UPLOAD_CONCURRENCY` at a time, with
 * progress. The listener given to `bind` is told when a file's asset is recorded. Failed uploads keep their file for
 * `retry`. Object URLs are revoked and uploads aborted on remove and on unmount.
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
      const run = client
        ? uploadMedia(client, u.file, u.kind, { contentType: u.contentType, signal: controller.signal, onProgress: (progress) => patch(u.key, { progress }) })
        : Promise.reject(new ApiError(0));
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

  /** Queue files (in this order) and start as many as the concurrency allows. */
  const add = useCallback(
    (files: readonly NewUpload[]) => {
      for (const f of files) {
        store.current.set(f.key, { ...f, previewUrl: createUrl(f.file), phase: 'waiting', progress: 0, error: null, asset: null, completedAt: null });
      }
      publish();
      pump();
    },
    [publish, pump],
  );

  /** Upload the held file again (a failed upload, or an asset that failed inspection). False when nothing is held. */
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
