import { z } from 'zod';
import { JobMeta } from './job-meta.js';

/** Media kinds a merchant can upload (Story 3.5). */
export const MEDIA_KINDS = ['image', 'video'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export const MediaKind = z.enum(MEDIA_KINDS);

const MB = 1024 * 1024;

/**
 * Allowed content types, the size limit, the minimum shorter side (px) and, for videos, the maximum duration per kind. The
 * API, the worker and the uploader's browser pre-check (Story 3.6) share them.
 */
export const MEDIA_LIMITS = {
  image: { content_types: ['image/jpeg', 'image/png', 'image/webp'], max_bytes: 10 * MB, min_short_side: 1080 },
  video: { content_types: ['video/mp4', 'video/quicktime', 'video/webm'], max_bytes: 200 * MB, min_short_side: 720, max_duration_seconds: 90 },
} as const satisfies Record<MediaKind, { content_types: readonly string[]; max_bytes: number; min_short_side: number; max_duration_seconds?: number }>;

export type MediaContentType = (typeof MEDIA_LIMITS)[MediaKind]['content_types'][number];

/** True when `contentType` is allowed for `kind`. */
export const isAllowedMediaType = (kind: MediaKind, contentType: string): contentType is MediaContentType =>
  (MEDIA_LIMITS[kind].content_types as readonly string[]).includes(contentType);

/** A pre-signed upload URL is valid this long. */
export const MEDIA_UPLOAD_TTL_SECONDS = 15 * 60;
/**
 * How long after the URL expires a completion is still accepted: a PUT that started before expiry may finish later (up to
 * 200 MB on a slow link). After it, complete answers 410 even if an object of the same bytes exists at the shared key.
 */
export const MEDIA_UPLOAD_COMPLETE_GRACE_SECONDS = 30 * 60;
/** Window of the per-store upload-URL throttle. */
export const MEDIA_UPLOAD_WINDOW_SECONDS = 10 * 60;

/**
 * `[importing ->] uploaded -> scanned -> processed | failed`. Only `processed` assets are publishable; `processed` comes
 * from Story 3.8. `importing`: the worker is fetching an external link into storage (Story 3.7).
 */
export const MEDIA_ASSET_STATUSES = ['importing', 'uploaded', 'scanned', 'processed', 'failed'] as const;
export type MediaAssetStatus = (typeof MEDIA_ASSET_STATUSES)[number];
export const MediaAssetStatus = z.enum(MEDIA_ASSET_STATUSES);

/** Rendition profiles produced by `media.asset.process` (Story 3.8). */
export const RENDITION_PROFILES = ['480p', '720p', '1080p', 'poster', 'web'] as const;
export type RenditionProfile = (typeof RENDITION_PROFILES)[number];
export const RenditionProfile = z.enum(RENDITION_PROFILES);

/** Progressive MP4 target short-side tiers in pixels; never upscaled above the source video's shorter side (Story 3.8). */
export const VIDEO_RENDITION_TIERS = [480, 720, 1080] as const;
export type VideoRenditionTier = (typeof VIDEO_RENDITION_TIERS)[number];

/**
 * Why an asset `failed` (the dashboard maps each to friendly copy). The `fetch_*` reasons are imports (Story 3.7): the
 * address is not allowed (private, loopback, metadata...), the file is over the kind's limit, or the source answered an
 * error or could not be reached. `processing_failed` is set when `media.asset.process` exhausts its attempts (Story 3.8).
 */
export const MEDIA_FAILURE_REASONS = [
  'checksum_mismatch',
  'type_not_allowed',
  'type_mismatch',
  'corrupt',
  'image_too_large',
  'malware',
  'inspection_failed',
  'fetch_blocked',
  'fetch_too_large',
  'fetch_failed',
  'processing_failed',
] as const;
export type MediaFailureReason = (typeof MEDIA_FAILURE_REASONS)[number];
export const MediaFailureReason = z.enum(MEDIA_FAILURE_REASONS);

/** Problem `type` slugs of the media API. */
export const MEDIA_TYPE_NOT_ALLOWED = 'media-type-not-allowed';
export const MEDIA_TOO_LARGE = 'media-too-large';
export const MEDIA_UPLOAD_RATE_LIMITED = 'media-upload-rate-limited';
export const MEDIA_UPLOAD_MISSING = 'media-upload-missing';
export const MEDIA_UPLOAD_EXPIRED = 'media-upload-expired';
/**
 * An import link is not allowed (422, Story 3.7): not http/https, a port other than 80/443, user info, longer than
 * `MEDIA_IMPORT_URL_MAX`, or a host that is a blocked IP address (private, loopback, link-local, metadata...).
 */
export const MEDIA_URL_NOT_ALLOWED = 'media-url-not-allowed';
/** A slide references a media asset that is unknown to the store or `failed` (422, Story 3.6). */
export const MEDIA_NOT_ATTACHABLE = 'media-not-attachable';

/** Lower-case hex SHA-256 of the file. */
export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, 'sha256 must be 64 lower-case hex characters');

/**
 * `POST /v1/media/uploads` request body. The type and size limits are checked by the API (422 problems), not here, so a
 * disallowed type is a 422 `media-type-not-allowed` rather than a 400.
 */
export const MediaUploadRequest = z.strictObject({
  kind: MediaKind,
  content_type: z.string().min(1).max(255),
  size_bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  sha256: Sha256Hex,
});
export type MediaUploadRequest = z.infer<typeof MediaUploadRequest>;

/**
 * `POST /v1/media/uploads` response: PUT the file to `url` with `headers` before `expires_at`. The URL signs the
 * `Content-Length`, `Content-Type` and `x-amz-checksum-sha256` headers, so only that exact file is accepted.
 */
export const MediaUploadGrant = z.object({
  v: z.literal(1).default(1),
  upload_id: z.uuid(),
  url: z.string().min(1),
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
  expires_at: z.iso.datetime(),
});
export type MediaUploadGrant = z.infer<typeof MediaUploadGrant>;

/** Longest import link accepted (Story 3.7). */
export const MEDIA_IMPORT_URL_MAX = 2048;

/**
 * `POST /v1/media/imports` request body (Story 3.7): fetch the file at `url` as an asset of `kind`. The URL rules are
 * checked by the API (422 `media-url-not-allowed`), not here.
 */
export const MediaImportRequest = z.strictObject({
  kind: MediaKind,
  url: z.string().trim().min(1).max(MEDIA_IMPORT_URL_MAX),
});
export type MediaImportRequest = z.infer<typeof MediaImportRequest>;

/**
 * One media asset of the store. `failure_reason` is set only when `status` is `failed`. `content_type` and `size_bytes`
 * are null while an import is `importing`, and stay null when an import failed before its file was stored (Story 3.7).
 * `poster_url` is `/v1/media/:id/poster` when `status === 'processed'`, otherwise `null` (Story 3.8).
 */
export const MediaAsset = z.object({
  v: z.literal(1).default(1),
  id: z.uuid(),
  kind: MediaKind,
  content_type: z.string().nullable(),
  size_bytes: z.number().int().positive().nullable(),
  status: MediaAssetStatus,
  failure_reason: MediaFailureReason.nullable(),
  poster_url: z.string().nullable().default(null),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export type MediaAsset = z.infer<typeof MediaAsset>;

/** Worker queue (media group) that inspects an uploaded asset. */
export const MEDIA_INSPECT_QUEUE = 'media.asset.inspect';

/** Payload of a `media.asset.inspect` job: the envelope (store required) plus the asset. */
export const MediaInspectJob = JobMeta.extend({ store_id: z.uuid(), asset_id: z.uuid() });
export type MediaInspectJob = z.infer<typeof MediaInspectJob>;

/** Worker queue (media group) that fetches an imported link into storage (Story 3.7). */
export const MEDIA_IMPORT_QUEUE = 'media.asset.import';

/** Payload of a `media.asset.import` job: the envelope (store required) plus the `importing` asset. */
export const MediaImportJob = JobMeta.extend({ store_id: z.uuid(), asset_id: z.uuid() });
export type MediaImportJob = z.infer<typeof MediaImportJob>;

/** Worker queue (media group) that produces video renditions + poster or web-optimized image rendition (Story 3.8). */
export const MEDIA_PROCESS_QUEUE = 'media.asset.process';

/** Payload of a `media.asset.process` job: the envelope (store required) plus the `scanned` asset. */
export const MediaProcessJob = JobMeta.extend({ store_id: z.uuid(), asset_id: z.uuid() });
export type MediaProcessJob = z.infer<typeof MediaProcessJob>;
