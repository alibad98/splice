import { Module } from '@nestjs/common';
import { ContentController } from './content.controller.js';
import { ContentLifecycle } from './content-lifecycle.js';
import { ContentService } from './content.service.js';

/**
 * Content (Epic 3): content item model, status lifecycle (`ContentLifecycle`), merchant CRUD/lifecycle routes,
 * and the batch link-count read the Products page needs (`ContentService`).
 */
@Module({
  controllers: [ContentController],
  providers: [ContentService, ContentLifecycle],
  exports: [ContentService, ContentLifecycle],
})
export class ContentModule {}
