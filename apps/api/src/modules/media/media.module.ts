import { Module } from '@nestjs/common';
import { MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';

/**
 * Media (Story 3.5): owns `media_assets` and `media_upload_grants`. Issues pre-signed upload URLs through the
 * `ObjectStorage` port, records completed uploads, and exports `MediaService` reads (`publishableAssetIds`,
 * `storedBytes`). Inspection (`MediaInspector`) runs in the worker only.
 */
@Module({
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
