import { Module } from '@nestjs/common';
import { ContentService } from './content.service.js';

/**
 * Content (Epic 3). Today only the batch link-count read the Products page needs. When Story 3.4 makes content call
 * catalog, use domain events or `forwardRef` so catalog -> content does not become a module cycle.
 */
@Module({ providers: [ContentService], exports: [ContentService] })
export class ContentModule {}
