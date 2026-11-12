import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { StoreManifest } from '@slips/contracts';
import { CatalogService } from '../catalog/catalog.service.js';
import { ContentService } from '../content/content.service.js';
import { MediaService } from '../media/media.service.js';
import { compileManifest } from './manifest-compiler.js';
import { toCompileSnapshot, toProductSummary } from './manifest-snapshot.js';

@Injectable()
export class PublishingService {
  constructor(
    @Inject(ContentService) private readonly content: ContentService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(MediaService) private readonly media: MediaService,
  ) {}

  /** One saved item in any live status, with its own placements and authenticated preview media (Story 3.10). */
  async previewContent(storeId: string, id: string): Promise<StoreManifest> {
    const saved = await this.content.getItemSnapshot(storeId, id);
    if (!saved) throw new NotFoundException({ message: 'Content not found', code: 'content_not_found' });
    const { productId, slides } = saved;
    const products = await this.catalog.getProductsByIds(storeId, productId ? [productId] : []);
    const p = productId ? products.get(productId) : undefined;
    const assets = await this.media.getPreviewMediaByIds(storeId, slides.map((slide) => slide.mediaAssetId));
    return compileManifest(storeId, [toCompileSnapshot(saved, p ? toProductSummary(p) : null, assets)]);
  }
}
