import { Controller, Get, Inject, Param, Req, Res } from '@nestjs/common';
import type { StoreManifest } from '@slips/contracts';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../session/access.guard.js';
import { PublishingService } from './publishing.service.js';

@Controller('v1/preview')
export class PreviewController {
  constructor(@Inject(PublishingService) private readonly publishing: PublishingService) {}

  @Get('content/:id')
  async content(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Res({ passthrough: true }) res: Response): Promise<StoreManifest> {
    res.setHeader('Cache-Control', 'private, no-store');
    return this.publishing.previewContent(req.merchantSession!.storeId, id);
  }
}
