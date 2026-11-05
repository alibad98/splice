import { Module, forwardRef } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { ContentController } from './content.controller.js';
import { IntegrationModule } from '../integration/integration.module.js';
import { ContentLifecycle } from './content-lifecycle.js';
import { ContentService } from './content.service.js';

/**
 * Content (Epic 3): content item model, status lifecycle (`ContentLifecycle`), merchant CRUD/lifecycle routes,
 * product links (Story 3.4, summaries read through `CatalogService`), and the batch link-count read the Products page
 * needs (`ContentService`). Catalog and content import each other, hence `forwardRef`.
 */
@Module({
  imports: [IntegrationModule, forwardRef(() => CatalogModule)],
  controllers: [ContentController],
  providers: [ContentService, ContentLifecycle],
  exports: [ContentService, ContentLifecycle],
})
export class ContentModule {}
