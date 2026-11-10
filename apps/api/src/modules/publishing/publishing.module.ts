import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { ContentModule } from '../content/content.module.js';
import { MediaModule } from '../media/media.module.js';
import { PreviewController } from './preview.controller.js';
import { PublishingService } from './publishing.service.js';

@Module({ imports: [ContentModule, CatalogModule, MediaModule], controllers: [PreviewController], providers: [PublishingService], exports: [PublishingService] })
export class PublishingModule {}
