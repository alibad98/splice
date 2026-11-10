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
      return { item, productId: link?.productId ?? null, slides };
    });
  }

  /** Live (non-deleted) content items linked to each product (Story 3.4); every asked id is present, 0 when unlinked. */
  async getLinkCountsByProductIds(storeId: string, productIds: readonly string[]): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();
    const counts = await withStoreContext(this.pool, storeId, () => this.repo.linkCountsByProductIds(productIds));
    return new Map(productIds.map((id) => [id, counts.get(id) ?? 0]));
  }
}
