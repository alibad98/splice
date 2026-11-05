import { describe, expect, it } from 'vitest';
import { EVENT_CATALOG } from './events.js';
import {
  MEDIA_FAILURE_REASONS,
  MEDIA_INSPECT_QUEUE,
  MEDIA_LIMITS,
  MEDIA_NOT_ATTACHABLE,
  MEDIA_TOO_LARGE,
  MEDIA_TYPE_NOT_ALLOWED,
  MEDIA_UPLOAD_EXPIRED,
  MEDIA_UPLOAD_MISSING,
  MEDIA_UPLOAD_RATE_LIMITED,
  MEDIA_UPLOAD_TTL_SECONDS,
  MediaAsset,
  MediaInspectJob,
  MediaUploadGrant,
  MediaUploadRequest,
  isAllowedMediaType,
} from './media.js';

const id = '11111111-1111-4111-8111-111111111111';
const sha = 'ab'.repeat(32);

describe('media limits', () => {
  it('allow JPG/PNG/WebP images up to 10 MB and MP4/MOV/WebM videos up to 200 MB; never SVG', () => {
    expect(MEDIA_LIMITS.image).toEqual({ content_types: ['image/jpeg', 'image/png', 'image/webp'], max_bytes: 10 * 1024 * 1024, min_short_side: 1080 });
    expect(MEDIA_LIMITS.video).toEqual({
      content_types: ['video/mp4', 'video/quicktime', 'video/webm'],
      max_bytes: 200 * 1024 * 1024,
      min_short_side: 720,
      max_duration_seconds: 90,
    });
    expect(MEDIA_NOT_ATTACHABLE).toBe('media-not-attachable');
    expect(isAllowedMediaType('image', 'image/png')).toBe(true);
    expect(isAllowedMediaType('image', 'image/svg+xml')).toBe(false);
    expect(isAllowedMediaType('image', 'video/mp4')).toBe(false);
    expect(isAllowedMediaType('video', 'video/quicktime')).toBe(true);
    expect(MEDIA_UPLOAD_TTL_SECONDS).toBe(900);
  });

  it('problem slugs are stable', () => {
    expect([MEDIA_TYPE_NOT_ALLOWED, MEDIA_TOO_LARGE, MEDIA_UPLOAD_RATE_LIMITED, MEDIA_UPLOAD_MISSING, MEDIA_UPLOAD_EXPIRED]).toEqual([
      'media-type-not-allowed',
      'media-too-large',
      'media-upload-rate-limited',
      'media-upload-missing',
      'media-upload-expired',
    ]);
  });
});

describe('MediaUploadRequest', () => {
  const ok = { kind: 'image', content_type: 'image/jpeg', size_bytes: 2 * 1024 * 1024, sha256: sha };
  it('accepts a well-formed request (type limits are the API 422s, not shape errors)', () => {
    expect(MediaUploadRequest.safeParse(ok).success).toBe(true);
    expect(MediaUploadRequest.safeParse({ ...ok, content_type: 'image/svg+xml' }).success).toBe(true);
  });
  it('rejects bad kinds, sizes, hashes and unknown keys', () => {
    expect(MediaUploadRequest.safeParse({ ...ok, kind: 'audio' }).success).toBe(false);
    expect(MediaUploadRequest.safeParse({ ...ok, size_bytes: 0 }).success).toBe(false);
    expect(MediaUploadRequest.safeParse({ ...ok, size_bytes: 1.5 }).success).toBe(false);
    expect(MediaUploadRequest.safeParse({ ...ok, sha256: sha.toUpperCase() }).success).toBe(false);
    expect(MediaUploadRequest.safeParse({ ...ok, sha256: 'abc' }).success).toBe(false);
    expect(MediaUploadRequest.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });
});

describe('MediaUploadGrant and MediaAsset', () => {
  it('parse the API shapes', () => {
    expect(MediaUploadGrant.parse({ upload_id: id, url: 'https://s3/x', method: 'PUT', headers: { 'content-type': 'image/png' }, expires_at: '2026-11-05T10:15:00.000Z' }).v).toBe(1);
    const asset = { v: 1, id, kind: 'video', content_type: 'video/mp4', size_bytes: 10, status: 'failed', failure_reason: 'malware', created_at: '2026-11-05T10:00:00.000Z', updated_at: '2026-11-05T10:00:00.000Z' };
    expect(MediaAsset.safeParse(asset).success).toBe(true);
    expect(MediaAsset.safeParse({ ...asset, status: 'ready' }).success).toBe(false);
    expect(MediaAsset.safeParse({ ...asset, failure_reason: 'virus' }).success).toBe(false);
    expect(MEDIA_FAILURE_REASONS).toContain('inspection_failed');
  });
});

describe('media jobs and events', () => {
  it('the inspect job requires the store and the asset', () => {
    expect(MEDIA_INSPECT_QUEUE).toBe('media.asset.inspect');
    expect(MediaInspectJob.safeParse({ v: 1, trace_id: 't', store_id: id, asset_id: id }).success).toBe(true);
    expect(MediaInspectJob.safeParse({ v: 1, trace_id: 't', asset_id: id }).success).toBe(false);
  });

  it('media.asset.* events are owned by media', () => {
    expect(EVENT_CATALOG['media.asset.uploaded'].owner).toBe('media');
    expect(EVENT_CATALOG['media.asset.uploaded'].schema.safeParse({ v: 1, store_id: id, asset_id: id, kind: 'image', content_type: 'image/png', size_bytes: 1 }).success).toBe(true);
    expect(EVENT_CATALOG['media.asset.scanned'].schema.safeParse({ v: 1, store_id: id, asset_id: id, kind: 'video', size_bytes: 9 }).success).toBe(true);
    expect(EVENT_CATALOG['media.asset.failed'].schema.safeParse({ v: 1, store_id: id, asset_id: id, reason: 'type_mismatch' }).success).toBe(true);
    expect(EVENT_CATALOG['media.asset.failed'].schema.safeParse({ v: 1, store_id: id, asset_id: id, reason: 'nope' }).success).toBe(false);
  });
});
