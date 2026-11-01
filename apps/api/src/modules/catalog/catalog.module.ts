import { Module } from '@nestjs/common';
import { ContentModule } from '../content/content.module.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';

/** Product catalog (Epic 2). The sync itself runs in the worker role (catalog-jobs); the http role serves the reads. */
@Module({ imports: [ContentModule], controllers: [CatalogController], providers: [CatalogService], exports: [CatalogService] })
export class CatalogModule {}
