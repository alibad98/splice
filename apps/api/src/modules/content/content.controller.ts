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
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  CONTENT_INVALID_TRANSITION,
  ContentCreateInput,
  ContentListQuery,
  TAB_STATUSES,
  type ContentListResponse,
  type ContentAction,
  type ContentItem,
} from '@slips/contracts';
import { withStoreContext } from '@slips/db';
import type { Pool } from 'pg';
import { DB_POOL } from '../../infra.module.js';
import type { AuthenticatedRequest } from '../session/access.guard.js';
import { ContentLifecycle, ContentNotFoundError, InvalidTransitionError } from './content-lifecycle.js';
import { ContentRepository, type ContentItemRow } from './content.repository.js';

export const toContentItem = (row: ContentItemRow): ContentItem => ({
  v: 1,
  id: row.id,
  title: row.title,
  format: row.format,
  cta_label: row.ctaLabel,
  cta_action: row.ctaAction,
  cta_url: row.ctaUrl,
  cta_style: row.ctaStyle,
  status: row.status,
  archived_from: row.archivedFrom,
  reactivate_to: row.reactivateTo,
  auto_publish: row.autoPublish,
  first_published_at: row.firstPublishedAt?.toISOString() ?? null,
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
  ) {}

  @Post('content')
  @HttpCode(HttpStatus.CREATED)
  async create(@Req() req: AuthenticatedRequest, @Body() raw: unknown): Promise<ContentItem> {
    const parsed = ContentCreateInput.safeParse(raw);
    if (!parsed.success) throw new BadRequestException({ message: 'The content item body is not valid', code: 'invalid_body' });
    const storeId = req.merchantSession!.storeId;
    const row = await withStoreContext(this.pool, storeId, (tx) => this.lifecycle.create(tx, storeId, parsed.data));
    return toContentItem(row);
  }

  /** Content list (Story 3.2): one page of the tab plus counts for every tab (counts ignore search and page). */
  @Get('content')
  async list(@Req() req: AuthenticatedRequest, @Query() raw: unknown): Promise<ContentListResponse> {
    const parsed = ContentListQuery.safeParse(raw);
    if (!parsed.success) throw new BadRequestException({ message: 'The content list query is not valid', code: 'invalid_query' });
    const { tab, q, sort, page, page_size } = parsed.data;
    const storeId = req.merchantSession!.storeId;
    const { rows, total, counts } = await withStoreContext(this.pool, storeId, async () => {
      const result = await this.repo.list({ statuses: TAB_STATUSES[tab], search: q || undefined, sort, limit: page_size, offset: (page - 1) * page_size });
      return { ...result, counts: await this.repo.countByTab() };
    });
    return { v: 1, total, page, page_size, counts, items: rows.map(toContentItem) };
  }

  @Get('content/:id')
  async getById(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<ContentItem> {
    const storeId = req.merchantSession!.storeId;
    const row = await withStoreContext(this.pool, storeId, () => this.repo.findById(id));
    if (!row) throw new NotFoundException({ message: 'Content item not found', code: 'content_not_found' });
    return toContentItem(row);
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
      return toContentItem(row);
    } catch (err) {
      if (err instanceof ContentNotFoundError) {
        throw new NotFoundException({ message: 'Content item not found', code: 'content_not_found' });
      }
      if (err instanceof InvalidTransitionError) {
        throw new HttpException({ message: err.message, code: 'invalid_transition', type: CONTENT_INVALID_TRANSITION }, HttpStatus.CONFLICT);
      }
      throw err;
    }
  }
}
