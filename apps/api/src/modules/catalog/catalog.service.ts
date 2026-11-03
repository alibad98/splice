import { Inject, Injectable } from '@nestjs/common';
import { withStoreContext, type CatalogSyncReason, type CatalogSyncStatus } from '@slips/db';
import type { Pool } from 'pg';
import { publishEvent, uuidv7, type EventSender } from '../../events/outbox.js';
import { DB_POOL, EVENT_SENDER } from '../../infra.module.js';
import { TELEMETRY, type Telemetry } from '../../ports/telemetry.js';
import { STALE_RUN_MS } from './catalog-sync.js';
import { CatalogReadRepository, CatalogRepository, type ProductListFilter, type ProductListRow, type SyncStateRow } from './catalog.repository.js';

/** A merchant may ask for a sync at most once per this interval (Story 2.3). Decided here, never by the dashboard. */
export const SYNC_REQUEST_INTERVAL_MS = 60_000;

export interface CatalogSyncView {
  status: CatalogSyncStatus | 'never';
  runId: string | null;
  /** Only for `failed`: why the run stopped. */
  reason: CatalogSyncReason | null;
  lastSyncedAt: Date | null;
  startedAt: Date | null;
  created: number;
  updated: number;
}

/** Outcome of `requestSync`: a new run was queued, a run is already queued/running, or the last request was too recent. */
export type SyncRequestOutcome = { kind: 'queued'; view: CatalogSyncView } | { kind: 'in_progress'; view: CatalogSyncView } | { kind: 'rate_limited'; retryAfterSeconds: number };

export type { ProductListFilter, ProductListRow } from './catalog.repository.js';

const NEVER: CatalogSyncView = { status: 'never', runId: null, reason: null, lastSyncedAt: null, startedAt: null, created: 0, updated: 0 };

function toView(row: SyncStateRow | undefined, now: number): CatalogSyncView {
  if (!row) return NEVER;
  // A queued/running run untouched for the stale window is stranded (job lost, worker down): it reads as failed, the
  // same run requestSync treats as idle, so the dashboard stops waiting and offers a retry.
  const stranded = (row.status === 'queued' || row.status === 'running') && now - row.updatedAt.getTime() >= STALE_RUN_MS;
  if (stranded) return { status: 'failed', runId: row.runId, reason: 'internal', lastSyncedAt: row.lastSyncedAt, startedAt: row.startedAt, created: row.createdCount, updated: row.updatedCount };
  return {
    status: row.status,
    runId: row.runId,
    // Between attempts a running run keeps its last attempt's error; it is not a failure yet.
    reason: row.status === 'failed' ? (row.reason ?? null) : null,
    lastSyncedAt: row.lastSyncedAt,
    startedAt: row.startedAt,
    created: row.createdCount,
    updated: row.updatedCount,
  };
}

/** The catalog module's exported service (AD-2): other modules and the dashboard read catalog state only through it. */
@Injectable()
export class CatalogService {
  private readonly repo = new CatalogRepository();
  private readonly reads = new CatalogReadRepository();

  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    @Inject(EVENT_SENDER) private readonly events: EventSender,
    @Inject(TELEMETRY) private readonly telemetry: Telemetry,
  ) {}

  /** The store's latest sync run, for the Products page (Story 2.3). `never` before the first run. */
  async getSyncState(storeId: string, now: number = Date.now()): Promise<CatalogSyncView> {
    return toView(await withStoreContext(this.pool, storeId, () => this.repo.getSyncState()), now);
  }

  /**
   * A merchant asks for a sync (Story 2.3). In one store transaction: single-flight (a fresh `queued`/`running` run is
   * returned as is), then the rate limit (skipped after a failed run), then the run is recorded `queued` and `catalog.sync.requested` is published
   * through the outbox with the run id as its event id. The worker turns the event into the full-sync job; this never
   * waits for the sync itself.
   */
  async requestSync(storeId: string, now: number = Date.now()): Promise<SyncRequestOutcome> {
    return withStoreContext(this.pool, storeId, async (ctx): Promise<SyncRequestOutcome> => {
      await this.repo.lockSyncRequests();
      const state = await this.repo.lockSyncState();
      const active = state && (state.status === 'queued' || state.status === 'running') && now - state.updatedAt.getTime() < STALE_RUN_MS;
      if (active) return { kind: 'in_progress', view: toView(state, now) };
      // The failure toast offers Retry, so a failed run never holds the next request back; single-flight still applies.
      const sinceRequest = state?.requestedAt && state.status !== 'failed' ? now - state.requestedAt.getTime() : Infinity;
      if (sinceRequest < SYNC_REQUEST_INTERVAL_MS) return { kind: 'rate_limited', retryAfterSeconds: Math.max(1, Math.ceil((SYNC_REQUEST_INTERVAL_MS - sinceRequest) / 1000)) };
      const runId = uuidv7(now);
      const row = await this.repo.queueRun(runId, new Date(now));
      await publishEvent(ctx, this.events, this.telemetry, 'catalog.sync.requested', { v: 1, store_id: storeId, run_id: runId }, { eventId: runId });
      this.telemetry.log.info('catalog sync requested', { run_id: runId });
      return { kind: 'queued', view: toView(row, now) };
    });
  }

  /** A page of the store's products visible in Salla (hidden ones are excluded), with the total that match. */
  async listProducts(storeId: string, filter: ProductListFilter): Promise<{ rows: ProductListRow[]; total: number }> {
    return withStoreContext(this.pool, storeId, () => this.reads.listProducts(filter));
  }

  /** The store's categories, by name. */
  async listCategories(storeId: string): Promise<Array<{ externalId: string; name: string }>> {
    return withStoreContext(this.pool, storeId, () => this.reads.listCategories());
  }
}
