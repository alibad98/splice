import { BadRequestException, Body, Controller, Get, HttpCode, HttpException, HttpStatus, Inject, NotFoundException, Param, Post, Req, Res } from '@nestjs/common';
import {
  MEDIA_TOO_LARGE,
  MEDIA_TYPE_NOT_ALLOWED,
  MEDIA_UPLOAD_EXPIRED,
  MEDIA_UPLOAD_MISSING,
  MEDIA_UPLOAD_RATE_LIMITED,
  MediaUploadRequest,
  type MediaAsset,
  type MediaUploadGrant,
} from '@slips/contracts';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../session/access.guard.js';
import {
  MediaAssetNotFoundError,
  MediaService,
  MediaTooLargeError,
  MediaTypeNotAllowedError,
  MediaUploadExpiredError,
  MediaUploadMissingError,
  MediaUploadNotFoundError,
  MediaUploadRateLimitedError,
} from './media.service.js';

/** Merchant media endpoints (Story 3.5). The store comes from the merchant session only. */
@Controller('v1')
export class MediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}

  /** A pre-signed PUT URL for one image or video (15 minutes, store-scoped, size-limited, content-addressed). */
  @Post('media/uploads')
  @HttpCode(HttpStatus.CREATED)
  async issue(@Req() req: AuthenticatedRequest, @Body() raw: unknown, @Res({ passthrough: true }) res: Response): Promise<MediaUploadGrant> {
    const parsed = MediaUploadRequest.safeParse(raw);
    if (!parsed.success) throw new BadRequestException({ message: 'The upload request is not valid', code: 'invalid_body' });
    try {
      return await this.media.issueUpload(req.merchantSession!.storeId, parsed.data);
    } catch (err) {
      if (err instanceof MediaUploadRateLimitedError) res.setHeader('Retry-After', String(err.retryAfterSeconds));
      throw toHttpError(err);
    }
  }

  /** Records the uploaded file as an `uploaded` asset (idempotent); the worker then inspects it. */
  @Post('media/uploads/:upload_id/complete')
  @HttpCode(HttpStatus.OK)
  async complete(@Req() req: AuthenticatedRequest, @Param('upload_id') uploadId: string): Promise<MediaAsset> {
    try {
      return await this.media.completeUpload(req.merchantSession!.storeId, uploadId);
    } catch (err) {
      throw toHttpError(err);
    }
  }

  @Get('media/:id')
  async getById(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<MediaAsset> {
    try {
      return await this.media.getAsset(req.merchantSession!.storeId, id);
    } catch (err) {
      throw toHttpError(err);
    }
  }
}

function toHttpError(err: unknown): unknown {
  if (err instanceof MediaTypeNotAllowedError) {
    return new HttpException({ message: err.message, code: 'media_type_not_allowed', type: MEDIA_TYPE_NOT_ALLOWED }, HttpStatus.UNPROCESSABLE_ENTITY);
  }
  if (err instanceof MediaTooLargeError) {
    return new HttpException({ message: err.message, code: 'media_too_large', type: MEDIA_TOO_LARGE }, HttpStatus.UNPROCESSABLE_ENTITY);
  }
  if (err instanceof MediaUploadRateLimitedError) {
    return new HttpException({ message: err.message, code: 'media_upload_rate_limited', type: MEDIA_UPLOAD_RATE_LIMITED }, HttpStatus.TOO_MANY_REQUESTS);
  }
  if (err instanceof MediaUploadMissingError) {
    return new HttpException({ message: err.message, code: 'media_upload_missing', type: MEDIA_UPLOAD_MISSING }, HttpStatus.CONFLICT);
  }
  if (err instanceof MediaUploadExpiredError) {
    return new HttpException({ message: err.message, code: 'media_upload_expired', type: MEDIA_UPLOAD_EXPIRED }, HttpStatus.GONE);
  }
  if (err instanceof MediaUploadNotFoundError) return new NotFoundException({ message: err.message, code: 'media_upload_not_found' });
  if (err instanceof MediaAssetNotFoundError) return new NotFoundException({ message: err.message, code: 'media_not_found' });
  return err;
}
