import { Inject, Injectable } from '@nestjs/common';
import { withStoreContext, type CatalogSyncReason, type CatalogSyncStatus } from '@slips/db';
import type { Pool } from 'pg';
import { DB_POOL } from '../../infra.module.js';
import { CatalogRepository } from './catalog.repository.js';

export interface CatalogSyncView {
  status: CatalogSyncStatus | 'never';
  reason: CatalogSyncReason | null;
  lastSyncedAt: Date | null;
  startedAt: Date | null;
  created: number;
  updated: number;
}

/** The catalog module's exported service (AD-2): other modules and the dashboard read catalog state only through it. */
@Injectable()
export class CatalogService {
  private readonly repo = new CatalogRepository();

  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /** The store's latest sync run, for the Products page (Story 2.3). `never` before the first run. */
  async getSyncState(storeId: string): Promise<CatalogSyncView> {
    const row = await withStoreContext(this.pool, storeId, () => this.repo.getSyncState());
    if (!row) return { status: 'never', reason: null, lastSyncedAt: null, startedAt: null, created: 0, updated: 0 };
    return { status: row.status, reason: row.reason ?? null, lastSyncedAt: row.lastSyncedAt, startedAt: row.startedAt, created: row.createdCount, updated: row.updatedCount };
  }
}
