import { BadRequestException, Controller, Get, HttpCode, HttpException, HttpStatus, Inject, Post, Query, Req, Res, forwardRef } from '@nestjs/common';
import { CATALOG_SYNC_RATE_LIMITED, ProductListQuery, type CatalogSyncStatus, type CategoryListResponse, type ProductListResponse } from '@slips/contracts';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../session/access.guard.js';
import { ContentService } from '../content/content.service.js';
import { CatalogService, type CatalogSyncView } from './catalog.service.js';

const syncStatus = (s: CatalogSyncView): CatalogSyncStatus => ({ v: 1, status: s.status, run_id: s.runId, reason: s.reason, last_synced_at: s.lastSyncedAt?.toISOString() ?? null });

/** Products page reads (Story 2.2). The store always comes from the merchant session, never from the request. */
@Controller('v1')
export class CatalogController {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(forwardRef(() => ContentService)) private readonly content: ContentService,
  ) {}

  @Get('products')
  async products(@Req() req: AuthenticatedRequest, @Query() raw: unknown): Promise<ProductListResponse> {
    const parsed = ProductListQuery.safeParse(raw);
    if (!parsed.success) throw new BadRequestException({ message: 'The product list query is not valid', code: 'invalid_query' });
    const { q, category, sort, page, page_size } = parsed.data;
    const storeId = req.merchantSession!.storeId;
    const { rows, total } = await this.catalog.listProducts(storeId, { search: q || undefined, category: category || undefined, sort, limit: page_size, offset: (page - 1) * page_size });
    // One batch call for the whole page (no per-row reads).
    const links = rows.length > 0 ? await this.content.getLinkCountsByProductIds(storeId, rows.map((r) => r.id)) : new Map<string, number>();
    return {
      v: 1,
      total,
      page,
      page_size,
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
        has_required_options: r.hasRequiredOptions,
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
    return syncStatus(await this.catalog.getSyncState(req.merchantSession!.storeId));
  }

  /**
   * Manual sync (Story 2.3): 202 with the queued run, or with the run already queued/running (nothing new is queued).
   * Too soon after the previous request: 429 `sync-rate-limited` with `Retry-After`. Cookie sessions need the CSRF
   * token (AccessGuard). The sync itself runs in the worker.
   */
  @Post('catalog/sync')
  @HttpCode(HttpStatus.ACCEPTED)
  async requestSync(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response): Promise<CatalogSyncStatus> {
    const outcome = await this.catalog.requestSync(req.merchantSession!.storeId);
    if (outcome.kind === 'rate_limited') {
      res.setHeader('Retry-After', String(outcome.retryAfterSeconds));
      throw new HttpException({ message: 'A sync was requested moments ago. Try again shortly', code: 'sync_rate_limited', type: CATALOG_SYNC_RATE_LIMITED }, HttpStatus.TOO_MANY_REQUESTS);
    }
    return syncStatus(outcome.view);
  }
}
