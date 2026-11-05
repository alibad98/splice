import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  forwardRef,
} from '@nestjs/common';
import {
  CONTENT_CTA_URL_NOT_STORE_DOMAIN,
  CONTENT_PRODUCT_NOT_LINKABLE,
  CTA_STYLES,
  CONTENT_INVALID_TRANSITION,
  ContentCreateInput,
  ContentListQuery,
  ContentUpdateInput,
  TAB_STATUSES,
  isStoreDomainUrl,
  type ContentListResponse,
  type ContentAction,
  type ContentItem,
  type ContentProductSummary,
  type CtaStyle,
} from '@slips/contracts';
import { withStoreContext } from '@slips/db';
import type { Pool } from 'pg';
import { DB_POOL } from '../../infra.module.js';
import type { AuthenticatedRequest } from '../session/access.guard.js';
import { CatalogService, type ProductSummaryRow } from '../catalog/catalog.service.js';
import { IntegrationService } from '../integration/integration.service.js';
import { ContentLifecycle, ContentNotFoundError, InvalidContentFieldsError, InvalidTransitionError } from './content-lifecycle.js';
import { ContentRepository, type ContentItemRow } from './content.repository.js';

/** The API shape of a linked product as the catalog has it now. */
export const toProductSummary = (p: ProductSummaryRow): ContentProductSummary => ({
  id: p.id,
  name: p.name,
  image_url: p.imageUrl,
  price_minor: p.priceMinor,
  sale_price_minor: p.salePriceMinor,
  currency: p.currency,
  availability: p.availability,
  has_required_options: p.hasRequiredOptions,
  deleted: p.deleted,
});

/** `product`: the item's linked product summary, or null when it links none (or the catalog no longer knows the id). */
export const toContentItem = (row: ContentItemRow, product: ContentProductSummary | null = null): ContentItem => ({
  v: 1,
  id: row.id,
  title: row.title,
  format: row.format,
  cta_label: row.ctaLabel,
  cta_action: row.ctaAction,
  cta_url: row.ctaUrl,
  // A style outside the preset list (none are written since Story 3.3) reads as the default.
  cta_style: (CTA_STYLES as readonly (string | null)[]).includes(row.ctaStyle) ? (row.ctaStyle as CtaStyle) : null,
  status: row.status,
  archived_from: row.archivedFrom,
  reactivate_to: row.reactivateTo,
  auto_publish: row.autoPublish,
  first_published_at: row.firstPublishedAt?.toISOString() ?? null,
  product,
  created_at: row.createdAt.toISOString(),
  updated_at: row.updatedAt.toISOString(),
});

/** Merchant content item lifecycle endpoints (Story 3.1). Store comes from the merchant session only. */
@Controller('v1')
export class ContentController {
  private readonly repo = new ContentRepository();

  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    @Inject(ContentLifecycle) private readonly lifecycle: ContentLifecycle,
    @Inject(IntegrationService) private readonly integration: IntegrationService,
    @Inject(forwardRef(() => CatalogService)) private readonly catalog: CatalogService,
  ) {}

  @Post('content')
  @HttpCode(HttpStatus.CREATED)
  async create(@Req() req: AuthenticatedRequest, @Body() raw: unknown): Promise<ContentItem> {
    const parsed = ContentCreateInput.safeParse(raw);
    if (!parsed.success) throw new BadRequestException({ message: 'The content item body is not valid', code: 'invalid_body' });
    const storeId = req.merchantSession!.storeId;
    await this.assertStoreDomain(storeId, parsed.data.cta_url);
    await this.assertLinkable(storeId, parsed.data.product_id);
    const row = await withStoreContext(this.pool, storeId, (tx) => this.lifecycle.create(tx, storeId, parsed.data));
    return (await this.withProducts(storeId, [row]))[0]!;
  }

  /**
   * Edit an item's title, format, CTA and linked product (Stories 3.3, 3.4); the status is unchanged. Archived items
   * answer 409 `invalid-transition`; an open-link URL off the store's synced domains answers 422
   * `cta-url-not-store-domain`; a product the catalog does not know (or has deleted) answers 422 `product-not-linkable`.
   */
  @Patch('content/:id')
  async update(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() raw: unknown): Promise<ContentItem> {
    const parsed = ContentUpdateInput.safeParse(raw);
    if (!parsed.success) throw new BadRequestException({ message: 'The content item body is not valid', code: 'invalid_body' });
    const storeId = req.merchantSession!.storeId;
    await this.assertStoreDomain(storeId, parsed.data.cta_url);
    await this.assertLinkable(storeId, parsed.data.product_id);
    let row: ContentItemRow;
    try {
      row = await withStoreContext(this.pool, storeId, (tx) => this.lifecycle.edit(tx, storeId, id, parsed.data));
    } catch (err) {
      if (err instanceof InvalidContentFieldsError) throw new BadRequestException({ message: err.message, code: 'invalid_body' });
      throw this.toHttpError(err);
    }
    return (await this.withProducts(storeId, [row]))[0]!;
  }

  /** A product to link must be one the store's catalog knows and has not deleted (checked before any write). */
  private async assertLinkable(storeId: string, productId: string | null | undefined): Promise<void> {
    if (productId == null) return;
    const product = (await this.catalog.getProductsByIds(storeId, [productId])).get(productId);
    if (product && !product.deleted) return;
    throw new HttpException(
      { message: 'The product can not be linked', code: 'product_not_linkable', type: CONTENT_PRODUCT_NOT_LINKABLE },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  /** API items for rows: their links in one content read, then every linked product in one catalog read. */
  private async withProducts(storeId: string, rows: readonly ContentItemRow[]): Promise<ContentItem[]> {
    if (rows.length === 0) return [];
    const links = await withStoreContext(this.pool, storeId, () => this.repo.linkedProductIds(rows.map((r) => r.id)));
    return this.attachProducts(storeId, rows, links);
  }

  /** One catalog read for every product the rows link (`links`: content id -> product id). */
  private async attachProducts(storeId: string, rows: readonly ContentItemRow[], links: ReadonlyMap<string, string>): Promise<ContentItem[]> {
    const products = await this.catalog.getProductsByIds(storeId, [...new Set(links.values())]);
    return rows.map((row) => {
      const product = products.get(links.get(row.id) ?? '');
      return toContentItem(row, product ? toProductSummary(product) : null);
    });
  }

  /** An open-link URL must be on one of the store's synced domains (read through the integration module). */
  private async assertStoreDomain(storeId: string, url: string | null | undefined): Promise<void> {
    if (url == null) return;
    const domains = await this.integration.getSyncedDomains(storeId);
    if (isStoreDomainUrl(url, domains)) return;
    throw new HttpException(
      { message: 'The link is not on one of the store domains', code: 'cta_url_not_store_domain', type: CONTENT_CTA_URL_NOT_STORE_DOMAIN },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  /** Content list (Story 3.2): one page of the tab plus counts for every tab (counts ignore search and page). */
  @Get('content')
  async list(@Req() req: AuthenticatedRequest, @Query() raw: unknown): Promise<ContentListResponse> {
    const parsed = ContentListQuery.safeParse(raw);
    if (!parsed.success) throw new BadRequestException({ message: 'The content list query is not valid', code: 'invalid_query' });
    const { tab, q, sort, page, page_size } = parsed.data;
    const storeId = req.merchantSession!.storeId;
    const { rows, total, counts, links } = await withStoreContext(this.pool, storeId, async () => {
      const result = await this.repo.list({ statuses: TAB_STATUSES[tab], search: q || undefined, sort, limit: page_size, offset: (page - 1) * page_size });
      return { ...result, counts: await this.repo.countByTab(), links: await this.repo.linkedProductIds(result.rows.map((r) => r.id)) };
    });
    return { v: 1, total, page, page_size, counts, items: await this.attachProducts(storeId, rows, links) };
  }

  @Get('content/:id')
  async getById(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<ContentItem> {
    const storeId = req.merchantSession!.storeId;
    const row = await withStoreContext(this.pool, storeId, () => this.repo.findById(id));
    if (!row) throw new NotFoundException({ message: 'Content item not found', code: 'content_not_found' });
    return (await this.withProducts(storeId, [row]))[0]!;
  }

  @Post('content/:id/archive')
  @HttpCode(HttpStatus.OK)
  async archive(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<ContentItem> {
    return this.applyTransition(req.merchantSession!.storeId, id, 'archive');
  }

  @Post('content/:id/undo-archive')
  @HttpCode(HttpStatus.OK)
  async undoArchive(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<ContentItem> {
    return this.applyTransition(req.merchantSession!.storeId, id, 'undo_archive');
  }

  @Post('content/:id/restore')
  @HttpCode(HttpStatus.OK)
  async restore(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<ContentItem> {
    return this.applyTransition(req.merchantSession!.storeId, id, 'restore');
  }

  @Delete('content/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<void> {
    await this.applyTransition(req.merchantSession!.storeId, id, 'delete');
  }

  private async applyTransition(storeId: string, id: string, action: ContentAction): Promise<ContentItem> {
    try {
      const row = await withStoreContext(this.pool, storeId, (tx) => this.lifecycle.apply(tx, storeId, id, action));
      return action === 'delete' ? toContentItem(row) : (await this.withProducts(storeId, [row]))[0]!;
    } catch (err) {
      throw this.toHttpError(err);
    }
  }

  private toHttpError(err: unknown): unknown {
    if (err instanceof ContentNotFoundError) {
      return new NotFoundException({ message: 'Content item not found', code: 'content_not_found' });
    }
    if (err instanceof InvalidTransitionError) {
      return new HttpException({ message: err.message, code: 'invalid_transition', type: CONTENT_INVALID_TRANSITION }, HttpStatus.CONFLICT);
    }
    return err;
  }
}
