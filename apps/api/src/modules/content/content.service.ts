import { Inject, Injectable } from '@nestjs/common';
import { withStoreContext } from '@slips/db';
import type { Pool } from 'pg';
import { DB_POOL } from '../../infra.module.js';
import { ContentRepository } from './content.repository.js';

/**
 * The content module's exported service (AD-2). Callers pass a whole page of product ids in one call (never one call
 * per row).
 */
@Injectable()
export class ContentService {
  private readonly repo = new ContentRepository();

  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /** Saved live item, link and ordered slides; no publication eligibility filtering or writes. */
  async getItemSnapshot(storeId: string, id: string) {
    return withStoreContext(this.pool, storeId, async () => {
      const item = await this.repo.findById(id);
      if (!item) return undefined;
      const link = await this.repo.findLink(id);
      const slides = await this.repo.liveSlides([id]);
      const placements = (await this.repo.placements([id])).map((p) => ({ type: p.type, layout: p.layout }));
      return { item, productId: link?.productId ?? null, slides, placements, firstPublishedAt: item.firstPublishedAt };
    });
  }

  /**
   * Store manifest candidates (Story 4.4 pilot): every live `published` Story with a Home placement, newest
   * `first_published_at` first, then id, each in the `getItemSnapshot` shape plus its placements and first publication.
   * No media or product eligibility here; publishing decides through the media and catalog owners. Joins the caller's
   * transaction when it already runs in this store's context.
   */
  async getStoreManifestCandidates(storeId: string) {
    return withStoreContext(this.pool, storeId, async () => {
      const items = await this.repo.publishedHomeStories();
      if (items.length === 0) return [];
      const ids = items.map((item) => item.id);
      const [links, slides, placements] = [await this.repo.linkedProductIds(ids), await this.repo.liveSlides(ids), await this.repo.placements(ids)];
      return items.map((item) => ({
        item,
        productId: links.get(item.id) ?? null,
        slides: slides.filter((slide) => slide.contentId === item.id),
        placements: placements.filter((p) => p.contentId === item.id).map((p) => ({ type: p.type, layout: p.layout })),
        firstPublishedAt: item.firstPublishedAt,
      }));
    });
  }

  /** Live (non-deleted) content items linked to each product (Story 3.4); every asked id is present, 0 when unlinked. */
  async getLinkCountsByProductIds(storeId: string, productIds: readonly string[]): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();
    const counts = await withStoreContext(this.pool, storeId, () => this.repo.linkCountsByProductIds(productIds));
    return new Map(productIds.map((id) => [id, counts.get(id) ?? 0]));
  }
}
