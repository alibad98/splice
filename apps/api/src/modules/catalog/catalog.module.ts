import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service.js';

/** Product catalog (Epic 2). The sync itself runs in the worker role (catalog-jobs). */
@Module({ providers: [CatalogService], exports: [CatalogService] })
export class CatalogModule {}
