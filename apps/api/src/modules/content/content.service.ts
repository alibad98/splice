import { Injectable } from '@nestjs/common';

/**
 * The content module's exported service (AD-2). Until content links exist (Epic 3), every product has 0 linked items.
 * Callers pass a whole page of product ids in one call (never one call per row).
 */
@Injectable()
export class ContentService {
  async getLinkCountsByProductIds(storeId: string, productIds: readonly string[]): Promise<Map<string, number>> {
    return new Map(productIds.map((id) => [id, 0]));
  }
}
