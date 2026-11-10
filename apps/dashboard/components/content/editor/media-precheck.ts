import { MEDIA_LIMITS, isAllowedMediaType, type MediaContentType, type MediaKind } from '@slips/contracts';

/**
 * Browser pre-check of a file before it is uploaded (Story 3.6), from the shared contract limits. The server checks the
 * type again (3.5) and the video duration and resolution (3.9); this only spares the merchant a pointless upload.
 */

/** Why a file was refused; each maps to copy that names the file and the limit. */
export type PrecheckReason = 'type' | 'imageSize' | 'videoSize' | 'videoDuration' | 'imageResolution' | 'videoResolution' | 'unreadable';

export type PrecheckResult =
  | { ok: true; kind: MediaKind; contentType: MediaContentType }
  | { ok: false; reason: Exclude<PrecheckReason, 'imageResolution' | 'videoResolution'> }
  | { ok: false; reason: 'imageResolution' | 'videoResolution'; width: number; height: number };

/** What the browser could read about the file. `null` for a video it cannot decode (e.g. MOV in Firefox): those checks are skipped. */
export interface MediaMeta {
  width: number;
  height: number;
  /** Seconds; videos only. */
  duration?: number;
}

const EXTENSION_TYPES: Record<string, MediaContentType> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

/** The file's kind and allowed content type, or null when it is none of the allowed types. An empty `type` falls back to the extension. */
export function classify(file: { name: string; type: string }): { kind: MediaKind; contentType: MediaContentType } | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const type = (file.type || EXTENSION_TYPES[ext] || '').toLowerCase();
  for (const kind of ['image', 'video'] as const) {
    if (isAllowedMediaType(kind, type)) return { kind, contentType: type };
  }
  return null;
}

/** The type and size checks, which need no decoding. */
export function precheckBasics(file: { name: string; type: string; size: number }): PrecheckResult {
  const c = classify(file);
  if (!c) return { ok: false, reason: 'type' };
  if (file.size > MEDIA_LIMITS[c.kind].max_bytes) return { ok: false, reason: c.kind === 'image' ? 'imageSize' : 'videoSize' };
  return { ok: true, ...c };
}

/** The duration and resolution checks on the read metadata. `meta` null: an image is refused (unreadable), a video passes. */
export function precheckMeta(kind: MediaKind, meta: MediaMeta | null): PrecheckReason | null {
  if (!meta) return kind === 'image' ? 'unreadable' : null;
  if (kind === 'video') {
    if (meta.duration !== undefined && Number.isFinite(meta.duration) && meta.duration > MEDIA_LIMITS.video.max_duration_seconds) return 'videoDuration';
    if (meta.width > 0 && meta.height > 0 && Math.min(meta.width, meta.height) < MEDIA_LIMITS.video.min_short_side) return 'videoResolution';
    return null;
  }
  if (!(meta.width > 0 && meta.height > 0)) return 'unreadable';
  if (Math.min(meta.width, meta.height) < MEDIA_LIMITS.image.min_short_side) return 'imageResolution';
  return null;
}

/** How long a video may take to report its metadata before the checks are skipped. */
export const VIDEO_META_TIMEOUT_MS = 10_000;

/** Read an image's size (`Image`) or a video's size and duration (`<video>`); null when the browser cannot decode it. */
export function readMediaMeta(file: Blob, kind: MediaKind): Promise<MediaMeta | null> {
  const url = URL.createObjectURL(file);
  const done = (meta: MediaMeta | null) => {
    URL.revokeObjectURL(url);
    return meta;
  };
  return new Promise<MediaMeta | null>((resolve) => {
    if (kind === 'image') {
      const img = new Image();
      img.onload = () => resolve(done({ width: img.naturalWidth, height: img.naturalHeight }));
      img.onerror = () => resolve(done(null));
      img.src = url;
      return;
    }
    const video = document.createElement('video');
    const timer = setTimeout(() => resolve(done(null)), VIDEO_META_TIMEOUT_MS);
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => {
      clearTimeout(timer);
      resolve(done({ width: video.videoWidth, height: video.videoHeight, duration: video.duration }));
    };
    video.onerror = () => {
      clearTimeout(timer);
      resolve(done(null));
    };
    video.src = url;
  });
}

/** The metadata reader the pre-check uses (a seam: tests replace `read`, since jsdom decodes no media). */
export const mediaMetaReader = { read: readMediaMeta };

/** Every check for one file: basics first, then the metadata the browser can read. */
export async function precheckFile(file: File, read: typeof readMediaMeta = (f, k) => mediaMetaReader.read(f, k)): Promise<PrecheckResult> {
  const basics = precheckBasics(file);
  if (!basics.ok) return basics;
  let meta: MediaMeta | null;
  try {
    meta = await read(file, basics.kind);
  } catch {
    meta = null;
  }
  const reason = precheckMeta(basics.kind, meta);
  if (reason === 'imageResolution' || reason === 'videoResolution') {
    if (!meta) return { ok: false, reason: 'unreadable' };
    return { ok: false, reason, width: meta.width, height: meta.height };
  }
  return reason ? { ok: false, reason } : basics;
}
