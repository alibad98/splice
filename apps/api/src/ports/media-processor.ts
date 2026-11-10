// Media processor port (Story 3.8, AD-11). Runs only in the worker role: transcodes videos into progressive MP4
// renditions (`480p`, `720p`, `1080p` up to source resolution, never upscaled) + a `poster` (`image/webp`, `720x1280`),
// and encodes images into a web-optimized `web` rendition (`image/webp`). Never produces HLS (`m3u8` / `.ts`).
import type { RenditionProfile } from '@slips/contracts';

export interface ProcessedRendition {
  readonly profile: RenditionProfile;
  readonly contentType: 'video/mp4' | 'image/webp' | 'image/jpeg';
  readonly width: number;
  readonly height: number;
  readonly bytes: Buffer;
}

export interface MediaProbe {
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number | null;
  readonly hasVideoTrack: boolean;
}
export class UnparseableMediaError extends Error {}

export interface MediaProcessor {
  probe(bytes: Buffer, contentType: string): Promise<MediaProbe>;
  /** Produce progressive MP4 renditions (up to source short-side resolution) and a `720x1280` WebP `poster`. */
  processVideo(bytes: Buffer, contentType: string): Promise<ProcessedRendition[]>;
  /** Produce a web-optimized `web` rendition (`image/webp`, quality 82, longer side capped at 1920 px, metadata stripped). */
  processImage(bytes: Buffer, contentType: string): Promise<ProcessedRendition[]>;
}

export const MEDIA_PROCESSOR = Symbol('MediaProcessor');

