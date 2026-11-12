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
  CONTENT_SLIDE_ALT_REQUIRED,
  CTA_STYLES,
  MEDIA_NOT_ATTACHABLE,
  CONTENT_INVALID_TRANSITION,
  CONTENT_NO_PLACEMENT,
  CONTENT_MEDIA_NOT_READY,
  CONTENT_UNSUPPORTED_FORMAT,
  CONTENT_INVALID_LAYOUT,
  hasInvalidLayoutIssue,
  ContentCreateInput,
  ContentListQuery,
  ContentUpdateInput,
  TAB_STATUSES,
  isStoreDomainUrl,
  type ContentListResponse,
  type ContentAction,
  type ContentItem,
  type ContentProductSummary,
  type ContentSlide,
  type CtaStyle,
  type SlideInput,
  type Placement,
} from '@slips/contracts';
import { withStoreContext } from '@slips/db';
import type { Pool } from 'pg';
import { DB_POOL } from '../../infra.module.js';
import type { AuthenticatedRequest } from '../session/access.guard.js';
import { CatalogService, type ProductSummaryRow } from '../catalog/catalog.service.js';
import { IntegrationService } from '../integration/integration.service.js';
import { MediaService, type MediaAssetSummary } from '../media/media.service.js';
import {
  ContentLifecycle,
  ContentNotFoundError,
  InvalidContentFieldsError,
  InvalidTransitionError,
  SlideAltTextRequiredError,
  SlideAssetUnknownError,
  PublishEligibilityError,
  type SlideAssetInfo,
} from './content-lifecycle.js';
import { ContentRepository, type ContentItemRow, type SlideRow } from './content.repository.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A slide with its asset's current status (an asset media no longer knows reads as failed). */
export const toContentSlide = (s: SlideRow, asset: MediaAssetSummary | undefined): ContentSlide => ({
  id: s.id,
  media_asset_id: s.mediaAssetId,
  kind: s.kind,
  alt_text: s.altText,
  status: asset?.status ?? 'failed',
  failure_reason: asset ? asset.failure_reason : 'inspection_failed',
  source_url: asset?.source_url ?? null,
  poster_url: asset?.poster_url ?? null,
});

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
export const toContentItem = (row: ContentItemRow, product: ContentProductSummary | null = null, slides: ContentSlide[] = [], placements: Placement[] = []): ContentItem => ({
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
  status_reason: row.status === 'failed' ? (() => { const failed = slides.find(s => s.status === 'failed'); return failed?.failure_reason ? { code: failed.failure_reason, kind: failed.kind } : null; })() : row.status === 'draft' && row.autoPublish ? (row.format === 'reel' ? { code: 'unsupported_format' } : !placements.length ? { code: 'no_placement' } : null) : null,
  archived_from: row.archivedFrom,
  reactivate_to: row.reactivateTo,
  auto_publish: row.autoPublish,
  first_published_at: row.firstPublishedAt?.toISOString() ?? null,
  product,
  slides,
  placements,
  created_at: row.createdAt.toISOString(),
  updated_at: row.updatedAt.toISOString(),
});

/**
 * A body that fails the contract: 422 `content-invalid-layout` when a placement names a layout the pilot does not
 * deliver (Story 4.2 slice; nothing is written), otherwise 400 `invalid_body`.
 */
const invalidBody = (issues: readonly { path: readonly PropertyKey[] }[]): HttpException =>
  hasInvalidLayoutIssue(issues)
    ? new HttpException({ message: 'The layout is not available for this placement', code: 'invalid_layout', type: CONTENT_INVALID_LAYOUT }, HttpStatus.UNPROCESSABLE_ENTITY)
    : new BadRequestException({ message: 'The content item body is not valid', code: 'invalid_body' });

const PUBLISH_INELIGIBLE_TYPES = { unsupported_format: CONTENT_UNSUPPORTED_FORMAT, no_placement: CONTENT_NO_PLACEMENT, media_not_ready: CONTENT_MEDIA_NOT_READY } as const;

/** Merchant content item lifecycle endpoints (Story 3.1). Store comes from the merchant session only. */
@Controller('v1')
export class ContentController {
  private readonly repo = new ContentRepository();

  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    @Inject(ContentLifecycle) private readonly lifecycle: ContentLifecycle,
    @Inject(IntegrationService) private readonly integration: IntegrationService,
    @Inject(forwardRef(() => CatalogService)) private readonly catalog: CatalogService,
    @Inject(MediaService) private readonly media: MediaService,
  ) {}

  @Post('content')
  @HttpCode(HttpStatus.CREATED)
  async create(@Req() req: AuthenticatedRequest, @Body() raw: unknown): Promise<ContentItem> {
    const parsed = ContentCreateInput.safeParse(raw);
    if (!parsed.success) throw invalidBody(parsed.error.issues);
    const storeId = req.merchantSession!.storeId;
    await this.assertStoreDomain(storeId, parsed.data.cta_url);
    await this.assertLinkable(storeId, parsed.data.product_id);
    const kinds = await this.assertAttachable(storeId, parsed.data.slides, new Set());
    let row: ContentItemRow;
    try {
      row = await withStoreContext(this.pool, storeId, (tx) => this.lifecycle.create(tx, storeId, parsed.data, new Date(), kinds));
    } catch (err) {
      throw this.toHttpError(err);
    }
    return (await this.withProducts(storeId, [row]))[0]!;
  }

  /**
   * Edit an item's title, format, CTA and linked product (Stories 3.3, 3.4); the status is unchanged. Archived items
   * answer 409 `invalid-transition`; an open-link URL off the store's synced domains answers 422
   * `cta-url-not-store-domain`; a product the catalog does not know (or has deleted) answers 422 `product-not-linkable`.
   * `slides` replaces the item's slide list (Story 3.6): an asset media does not know for the store, or a `failed` one
   * that is not already a slide of the item, answers 422 `media-not-attachable`; an image slide without alt text 422
   * `slide-alt-text-required`.
   */
  @Patch('content/:id')
  async update(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() raw: unknown): Promise<ContentItem> {
    const parsed = ContentUpdateInput.safeParse(raw);
    if (!parsed.success) throw invalidBody(parsed.error.issues);
    const storeId = req.merchantSession!.storeId;
    await this.assertStoreDomain(storeId, parsed.data.cta_url);
    if (parsed.data.product_id != null && UUID_RE.test(id)) {
      // Re-sending the product the item already links is not a new link (it may have been hidden since).
      const links = await withStoreContext(this.pool, storeId, () => this.repo.linkedProductIds([id]));
      if (links.get(id) !== parsed.data.product_id) await this.assertLinkable(storeId, parsed.data.product_id);
    }
    let kinds: Map<string, SlideAssetInfo> = new Map();
    if (parsed.data.slides !== undefined && UUID_RE.test(id)) {
      // A slide the item already has stays attachable even if its asset failed since (the editor re-sends the list).
      const current = await withStoreContext(this.pool, storeId, () => this.repo.liveSlides([id]));
      kinds = await this.assertAttachable(storeId, parsed.data.slides, new Set(current.map((s) => s.mediaAssetId)));
    }
    let row: ContentItemRow;
    try {
      row = await withStoreContext(this.pool, storeId, (tx) => this.lifecycle.edit(tx, storeId, id, parsed.data, new Date(), kinds));
    } catch (err) {
      if (err instanceof InvalidContentFieldsError) throw new BadRequestException({ message: err.message, code: 'invalid_body' });
      throw this.toHttpError(err);
    }
    return (await this.withProducts(storeId, [row]))[0]!;
  }

  /** A product to link must be one the store's catalog knows, has not deleted and shows in the storefront (checked before any write). */
  private async assertLinkable(storeId: string, productId: string | null | undefined): Promise<void> {
    if (productId == null) return;
    const product = (await this.catalog.getProductsByIds(storeId, [productId])).get(productId);
    if (product && !product.deleted && product.visible) return;
    throw new HttpException(
      { message: 'The product can not be linked', code: 'product_not_linkable', type: CONTENT_PRODUCT_NOT_LINKABLE },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  /**
   * Every slide asset must be a store asset media knows; a `failed` one only when `existing` (already a live slide of the
   * item). One media read; returns asset id -> kind for the lifecycle (alt-text rule, `kind` copy). Checked before any write.
   */
  private async assertAttachable(storeId: string, slides: readonly SlideInput[] | undefined, existing: ReadonlySet<string>): Promise<Map<string, SlideAssetInfo>> {
    if (!slides || slides.length === 0) return new Map();
    const assets = await this.media.getAssetsByIds(storeId, slides.map((s) => s.media_asset_id));
    for (const s of slides) {
      const asset = assets.get(s.media_asset_id);
      if (!asset || (asset.status === 'failed' && !existing.has(s.media_asset_id))) {
        throw new HttpException(
          { message: 'The media can not be attached', code: 'media_not_attachable', type: MEDIA_NOT_ATTACHABLE },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
    }
    return new Map([...assets].map(([id, a]) => [id, { kind: a.kind, status: a.status }]));
  }

  /** API items for rows: their links and live slides in one content read, then one catalog read and one media read. */
  private async withProducts(storeId: string, rows: readonly ContentItemRow[]): Promise<ContentItem[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const { links, slides, placements } = await withStoreContext(this.pool, storeId, async () => ({
      links: await this.repo.linkedProductIds(ids),
      slides: await this.repo.liveSlides(ids),
      placements: await this.repo.placements(ids),
    }));
    return this.attachProducts(storeId, rows, links, slides, placements);
  }

  /**
   * One catalog read for every product the rows link (`links`: content id -> product id) and one media read for the
   * status of every slide asset (`slides`: the rows' live slides in order).
   */
  private async attachProducts(
    storeId: string,
    rows: readonly ContentItemRow[],
    links: ReadonlyMap<string, string>,
    slides: readonly SlideRow[],
    placements: readonly { contentId: string; type: 'home'; layout: Placement['layout'] }[],
  ): Promise<ContentItem[]> {
    const [products, assets] = await Promise.all([
      this.catalog.getProductsByIds(storeId, [...new Set(links.values())]),
      this.media.getAssetsByIds(storeId, [...new Set(slides.map((s) => s.mediaAssetId))]),
    ]);
    const byItem = new Map<string, ContentSlide[]>();
    for (const s of slides) {
      const list = byItem.get(s.contentId) ?? [];
      list.push(toContentSlide(s, assets.get(s.mediaAssetId)));
      byItem.set(s.contentId, list);
    }
    return rows.map((row) => {
      const product = products.get(links.get(row.id) ?? '');
      return toContentItem(row, product ? toProductSummary(product) : null, byItem.get(row.id) ?? [], placements.filter(p => p.contentId === row.id).map(p => ({ type: p.type, layout: p.layout })));
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
    const { rows, total, counts, links, slides, placements } = await withStoreContext(this.pool, storeId, async () => {
      const result = await this.repo.list({ statuses: TAB_STATUSES[tab], search: q || undefined, sort, limit: page_size, offset: (page - 1) * page_size });
      const ids = result.rows.map((r) => r.id);
      return { ...result, counts: await this.repo.countByTab(), links: await this.repo.linkedProductIds(ids), slides: await this.repo.liveSlides(ids), placements: await this.repo.placements(ids) };
    });
    return { v: 1, total, page, page_size, counts, items: await this.attachProducts(storeId, rows, links, slides, placements) };
  }

  @Get('content/:id')
  async getById(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<ContentItem> {
    const storeId = req.merchantSession!.storeId;
    const row = await withStoreContext(this.pool, storeId, () => this.repo.findById(id));
    if (!row) throw new NotFoundException({ message: 'Content item not found', code: 'content_not_found' });
    return (await this.withProducts(storeId, [row]))[0]!;
  }

  @Post('content/:id/duplicate')
  @HttpCode(HttpStatus.CREATED)
  async duplicate(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<ContentItem> {
    const storeId = req.merchantSession!.storeId;
    try {
      const row = await withStoreContext(this.pool, storeId, tx => this.lifecycle.duplicate(tx, storeId, id));
      return (await this.withProducts(storeId, [row]))[0]!;
    } catch (err) { throw this.toHttpError(err); }
  }

  @Post('content/:id/retry')
  @HttpCode(HttpStatus.OK)
  async retry(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<ContentItem> {
    const storeId = req.merchantSession!.storeId;
    try {
      const row = await withStoreContext(this.pool, storeId, tx => this.lifecycle.retry(tx, storeId, id));
      return (await this.withProducts(storeId, [row]))[0]!;
    } catch (err) { throw this.toHttpError(err); }
  }

  @Post('content/:id/archive')
  @HttpCode(HttpStatus.OK)
  async archive(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<ContentItem> {
    return this.applyTransition(req.merchantSession!.storeId, id, 'archive');
  }

  @Post('content/:id/publish')
  @HttpCode(HttpStatus.OK)
  async publish(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<ContentItem> {
    return this.applyTransition(req.merchantSession!.storeId, id, 'publish');
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
    if (err instanceof PublishEligibilityError) {
      return new HttpException({ message: err.message, code: err.reason, type: PUBLISH_INELIGIBLE_TYPES[err.reason] }, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    if (err instanceof ContentNotFoundError) {
      return new NotFoundException({ message: 'Content item not found', code: 'content_not_found' });
    }
    if (err instanceof InvalidTransitionError) {
      return new HttpException({ message: err.message, code: 'invalid_transition', type: CONTENT_INVALID_TRANSITION }, HttpStatus.CONFLICT);
    }
    if (err instanceof SlideAssetUnknownError) {
      return new HttpException({ message: 'The media can not be attached', code: 'media_not_attachable', type: MEDIA_NOT_ATTACHABLE }, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    if (err instanceof SlideAltTextRequiredError) {
      return new HttpException({ message: 'Image slides need alt text', code: 'slide_alt_text_required', type: CONTENT_SLIDE_ALT_REQUIRED }, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    return err;
  }
}
