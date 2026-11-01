import { BadRequestException, Controller, Get, Inject, Query, Req } from '@nestjs/common';
import { PRODUCT_PAGE_SIZE, ProductListQuery, type CatalogSyncStatus, type CategoryListResponse, type ProductListResponse } from '@slips/contracts';
import type { AuthenticatedRequest } from '../session/access.guard.js';
import { ContentService } from '../content/content.service.js';
import { CatalogService } from './catalog.service.js';

/** Products page reads (Story 2.2). The store always comes from the merchant session, never from the request. */
@Controller('v1')
export class CatalogController {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(ContentService) private readonly content: ContentService,
  ) {}

  @Get('products')
  async products(@Req() req: AuthenticatedRequest, @Query() raw: unknown): Promise<ProductListResponse> {
    const parsed = ProductListQuery.safeParse(raw);
    if (!parsed.success) throw new BadRequestException({ message: 'The product list query is not valid', code: 'invalid_query' });
    const { q, category, sort, page } = parsed.data;
    const storeId = req.merchantSession!.storeId;
    const { rows, total } = await this.catalog.listProducts(storeId, { search: q || undefined, category: category || undefined, sort, limit: PRODUCT_PAGE_SIZE, offset: (page - 1) * PRODUCT_PAGE_SIZE });
    // One batch call for the whole page (no per-row reads).
    const links = rows.length > 0 ? await this.content.getLinkCountsByProductIds(storeId, rows.map((r) => r.id)) : new Map<string, number>();
    return {
      v: 1,
      total,
      page,
      page_size: PRODUCT_PAGE_SIZE,
      items: rows.map((r) => ({
        id: r.id,
        external_id: r.externalId,
        name: r.name,
        image_url: r.imageUrl,
        category_name: r.categoryName,
        more_categories: Math.max(0, r.categoryCount - 1),
        price_minor: r.priceMinor,
        sale_price_minor: r.salePriceMinor,
        currency: r.currency,
        tax_inclusive: r.taxInclusive,
        availability: r.availability,
        linked_content_count: links.get(r.id) ?? 0,
        attributed_orders: null,
      })),
    };
  }

  @Get('products/categories')
  async categories(@Req() req: AuthenticatedRequest): Promise<CategoryListResponse> {
    const rows = await this.catalog.listCategories(req.merchantSession!.storeId);
    return { v: 1, items: rows.map((r) => ({ external_id: r.externalId, name: r.name })) };
  }

  @Get('catalog/sync')
  async sync(@Req() req: AuthenticatedRequest): Promise<CatalogSyncStatus> {
    const s = await this.catalog.getSyncState(req.merchantSession!.storeId);
    return { v: 1, status: s.status, reason: s.reason, last_synced_at: s.lastSyncedAt?.toISOString() ?? null };
  }
}
