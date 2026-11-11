// Store manifest compile (Story 4.4 pilot slice): the worker job behind `publishing.manifest.compile`.
import { gzipSync } from 'node:zlib';
import { MANIFEST_PLACEMENT_MAX_ITEMS, StoreManifest, isStoreDomainUrl } from '@slips/contracts';
import { requireStoreContext, withStoreContext } from '@slips/db';
import type { Pool } from 'pg';
import { Metric, type Telemetry } from '../../ports/telemetry.js';
import type { CatalogService } from '../catalog/catalog.service.js';
import type { ContentService } from '../content/content.service.js';
import type { IntegrationService } from '../integration/integration.service.js';
import type { MediaService } from '../media/media.service.js';
import { MANIFEST_GZIP_WARN_BYTES } from './manifest-inputs.js';
import { compileManifest, type CompileSnapshot } from './manifest-compiler.js';
import { toCompileSnapshot, toProductSummary } from './manifest-snapshot.js';

export type CompileOutcome =
  | { outcome: 'skipped_disconnected' }
  | { outcome: 'removed' }
  | { outcome: 'compiled' | 'emptied'; revision: number; items: number; sizeGzipBytes: number };

/**
 * Compiles one store's manifest into `store_manifests` in one store-context transaction:
 * - `disconnected`: nothing is written, the last manifest is kept;
 * - `uninstalled`: an empty manifest (no placements, no items) at the next revision;
 * - `purged` or unknown store: no row (any row is deleted), which readers treat as an empty manifest. The purged event
 *   fires after the store purge, so writing here would recreate the row the purge removed;
 * - `active`: live `published` Home Stories whose every slide asset is `processed` (at least one slide) and whose
 *   linked product (if any) exists and is not deleted, newest `first_published_at` first then id, at most 10, with public immutable
 *   rendition URLs. An open-link CTA whose URL is no longer on a synced store domain is dropped (fields null, warning).
 * The row is locked (`FOR UPDATE`, created at revision 0 when missing) before the inputs are read and the compile
 * writes `revision + 1`, so concurrent compiles serialize and the newest commit always holds the highest revision.
 * Other modules are read through their services only; they join this transaction.
 */
export class StoreManifestCompiler {
  constructor(
    private readonly pool: Pool,
    private readonly content: Pick<ContentService, 'getStoreManifestCandidates'>,
    private readonly catalog: Pick<CatalogService, 'getProductsByIds'>,
    private readonly media: Pick<MediaService, 'getPublishedMediaByIds'>,
    private readonly integration: Pick<IntegrationService, 'getLifecycleState' | 'getSyncedDomains'>,
    private readonly telemetry: Telemetry,
  ) {}

  async compile(storeId: string, options: { occurredAt?: Date } = {}): Promise<CompileOutcome> {
    const result = await withStoreContext(this.pool, storeId, async (): Promise<CompileOutcome> => {
      const tx = requireStoreContext();
      // Lock first, then read the lifecycle state: a lifecycle change committed while this compile waited is seen.
      const inserted = await tx.query('insert into store_manifests (store_id) values ($1) on conflict (store_id) do nothing returning id', [storeId]);
      await tx.query('select revision from store_manifests where store_id = $1 for update', [storeId]);
      const state = await this.integration.getLifecycleState(storeId);
      if (state === 'disconnected') {
        // Keep any existing manifest; drop only the placeholder row this compile created.
        if (inserted.rows.length > 0) await tx.query('delete from store_manifests where store_id = $1 and revision = 0', [storeId]);
        return { outcome: 'skipped_disconnected' };
      }
      if (state === 'purged' || state === null) {
        await tx.query('delete from store_manifests where store_id = $1', [storeId]);
        return { outcome: 'removed' };
      }
      const snapshots = state === 'active' ? await this.select(storeId) : [];
      const manifest = StoreManifest.parse(compileManifest(storeId, snapshots));
      const json = JSON.stringify(manifest);
      const sizeGzipBytes = gzipSync(json).length;
      const written = await tx.query<{ revision: string }>(
        `update store_manifests set revision = revision + 1, manifest = $2::jsonb, size_gzip_bytes = $3, compiled_at = now()
          where store_id = $1 returning revision::text as revision`,
        [storeId, json, sizeGzipBytes],
      );
      return { outcome: state === 'active' ? 'compiled' : 'emptied', revision: Number(written.rows[0]!.revision), items: manifest.items.length, sizeGzipBytes };
    });
    this.telemetry.counter(Metric.ManifestCompiles, { outcome: result.outcome });
    if (options.occurredAt && (result.outcome === 'compiled' || result.outcome === 'emptied')) {
      this.telemetry.observe(Metric.ManifestCompileLag, Math.max(0, (Date.now() - options.occurredAt.getTime()) / 1000));
    }
    if (result.outcome === 'skipped_disconnected') {
      this.telemetry.log.info('store manifest kept: store disconnected', { store_id: storeId });
      return result;
    }
    if (result.outcome === 'removed') {
      this.telemetry.log.info('store manifest removed: store purged or unknown', { store_id: storeId });
      return result;
    }
    this.telemetry.observe(Metric.ManifestSizeGzipKilobytes, result.sizeGzipBytes / 1024);
    if (result.sizeGzipBytes > MANIFEST_GZIP_WARN_BYTES) {
      this.telemetry.counter(Metric.ManifestOversize);
      this.telemetry.log.warn('store manifest above gzip budget', { store_id: storeId, size_gzip_bytes: result.sizeGzipBytes, budget_bytes: MANIFEST_GZIP_WARN_BYTES, revision: result.revision });
    }
    this.telemetry.log.info('store manifest compiled', { store_id: storeId, outcome: result.outcome, revision: result.revision, items: result.items, size_gzip_bytes: result.sizeGzipBytes });
    return result;
  }

  /** Eligible items for an active store, in manifest order and capped. */
  private async select(storeId: string): Promise<CompileSnapshot[]> {
    const candidates = await this.content.getStoreManifestCandidates(storeId);
    if (candidates.length === 0) return [];
    const media = await this.media.getPublishedMediaByIds(storeId, [...new Set(candidates.flatMap((c) => c.slides.map((s) => s.mediaAssetId)))]);
    const ready = candidates.filter((c) => c.item.format === 'story' && c.slides.length > 0 && c.slides.every((s) => media.has(s.mediaAssetId)));
    const productIds = [...new Set(ready.flatMap((c) => (c.productId ? [c.productId] : [])))];
    const products = await this.catalog.getProductsByIds(storeId, productIds);
    // A linked product must exist and be live: a deleted or missing one withholds the item.
    const selected = ready.filter((c) => !c.productId || products.get(c.productId)?.deleted === false).slice(0, MANIFEST_PLACEMENT_MAX_ITEMS);
    const domains = selected.some((c) => c.item.ctaAction === 'open_link') ? await this.integration.getSyncedDomains(storeId) : [];
    return selected.map((c) => {
      const product = c.productId ? products.get(c.productId) : undefined;
      const snapshot = toCompileSnapshot(c, product ? toProductSummary(product) : null, media);
      if (snapshot.cta_action === 'open_link' && !(snapshot.cta_url && isStoreDomainUrl(snapshot.cta_url, domains))) {
        this.telemetry.counter(Metric.ManifestCtaDropped);
        this.telemetry.log.warn('manifest cta dropped: link not on a synced store domain', { store_id: storeId, content_id: c.item.id });
        return { ...snapshot, cta_label: null, cta_action: null, cta_url: null };
      }
      return snapshot;
    });
  }
}
