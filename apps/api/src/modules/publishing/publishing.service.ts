import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CTA_STYLES, type CtaStyle, type ContentProductSummary, type StoreManifest } from '@slips/contracts';
import { CatalogService } from '../catalog/catalog.service.js';
import { ContentService } from '../content/content.service.js';
import { MediaService } from '../media/media.service.js';
import { compileManifest } from './manifest-compiler.js';

@Injectable()
export class PublishingService {
  constructor(
    @Inject(ContentService) private readonly content: ContentService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(MediaService) private readonly media: MediaService,
  ) {}

  async previewContent(storeId: string, id: string): Promise<StoreManifest> {
    const saved = await this.content.getItemSnapshot(storeId, id);
    if (!saved) throw new NotFoundException({ message: 'Content not found', code: 'content_not_found' });
    const { item, slides, productId } = saved;
    const products = await this.catalog.getProductsByIds(storeId, productId ? [productId] : []);
    const p = productId ? products.get(productId) : undefined;
    const product: ContentProductSummary | null = p ? {
      id: p.id, name: p.name, image_url: p.imageUrl, price_minor: p.priceMinor, sale_price_minor: p.salePriceMinor,
      currency: p.currency, availability: p.availability, has_required_options: p.hasRequiredOptions, deleted: p.deleted,
    } : null;
    const assets = await this.media.getPreviewMediaByIds(storeId, slides.map((slide) => slide.mediaAssetId));
    return compileManifest(storeId, [{
      id: item.id, title: item.title, format: item.format,
      cta_label: item.ctaLabel, cta_action: item.ctaAction, cta_url: item.ctaUrl,
      cta_style: (CTA_STYLES as readonly (string | null)[]).includes(item.ctaStyle) ? (item.ctaStyle as CtaStyle) : null,
      product,
      slides: slides.map((slide) => {
        const asset = assets.get(slide.mediaAssetId);
        return {
          id: slide.id, media_asset_id: slide.mediaAssetId, kind: slide.kind, alt_text: slide.altText,
          status: asset?.status ?? 'failed', source_url: asset?.source_url ?? null, poster_url: asset?.poster_url ?? null,
          renditions: asset?.renditions ?? [],
        };
      }),
    }]);
  }
}
