import { z } from 'zod';
import { JobMeta } from './job-meta.js';

/** Media kinds a merchant can upload (Story 3.5). */
export const MEDIA_KINDS = ['image', 'video'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export const MediaKind = z.enum(MEDIA_KINDS);

const MB = 1024 * 1024;

/** Allowed content types and the size limit per kind; the API, the worker and the uploader (Story 3.6) share them. */
export const MEDIA_LIMITS = {
  image: { content_types: ['image/jpeg', 'image/png', 'image/webp'], max_bytes: 10 * MB },
  video: { content_types: ['video/mp4', 'video/quicktime', 'video/webm'], max_bytes: 200 * MB },
} as const satisfies Record<MediaKind, { content_types: readonly string[]; max_bytes: number }>;

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

/** `uploaded -> scanned -> processed | failed`. Only `processed` assets are publishable; `processed` comes from Story 3.8. */
export const MEDIA_ASSET_STATUSES = ['uploaded', 'scanned', 'processed', 'failed'] as const;
export type MediaAssetStatus = (typeof MEDIA_ASSET_STATUSES)[number];
export const MediaAssetStatus = z.enum(MEDIA_ASSET_STATUSES);

/** Why an asset `failed` (the dashboard maps each to friendly copy). */
export const MEDIA_FAILURE_REASONS = ['checksum_mismatch', 'type_not_allowed', 'type_mismatch', 'corrupt', 'image_too_large', 'malware', 'inspection_failed'] as const;
export type MediaFailureReason = (typeof MEDIA_FAILURE_REASONS)[number];
export const MediaFailureReason = z.enum(MEDIA_FAILURE_REASONS);

/** Problem `type` slugs of the media API. */
export const MEDIA_TYPE_NOT_ALLOWED = 'media-type-not-allowed';
export const MEDIA_TOO_LARGE = 'media-too-large';
export const MEDIA_UPLOAD_RATE_LIMITED = 'media-upload-rate-limited';
export const MEDIA_UPLOAD_MISSING = 'media-upload-missing';
export const MEDIA_UPLOAD_EXPIRED = 'media-upload-expired';

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

/** One media asset of the store. `failure_reason` is set only when `status` is `failed`. */
export const MediaAsset = z.object({
  v: z.literal(1).default(1),
  id: z.uuid(),
  kind: MediaKind,
  content_type: z.string(),
  size_bytes: z.number().int().positive(),
  status: MediaAssetStatus,
  failure_reason: MediaFailureReason.nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export type MediaAsset = z.infer<typeof MediaAsset>;

/** Worker queue (media group) that inspects an uploaded asset. */
export const MEDIA_INSPECT_QUEUE = 'media.asset.inspect';

/** Payload of a `media.asset.inspect` job: the envelope (store required) plus the asset. */
export const MediaInspectJob = JobMeta.extend({ store_id: z.uuid(), asset_id: z.uuid() });
export type MediaInspectJob = z.infer<typeof MediaInspectJob>;
