import { createHash } from 'node:crypto';
import { z } from 'zod';
import { JobMeta, type StoreManifest } from '@slips/contracts';
import { withStoreContext } from '@slips/db';
import type { Pool } from 'pg';
import { uuidv7, type EventSender, type TxQueryable } from '../../events/outbox.js';
import type { CdnPurger } from '../../ports/cdn-purger.js';
import type { ObjectStorage } from '../../ports/object-storage.js';
import { Metric, type Telemetry } from '../../ports/telemetry.js';
import type { IntegrationService } from '../integration/integration.service.js';
import { lockStore } from '../integration/store-lifecycle.js';

export const MANIFEST_DELIVERY_QUEUE = 'publishing.manifest.deliver';
export const MANIFEST_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=60';
export const emptyManifest = (storeId = '00000000-0000-0000-0000-000000000000'): StoreManifest => ({ v: 1, store_id: storeId, placements: [], items: [] });
export const manifestPath = (platformStoreId: string): string => `/m/v1/salla/${encodeURIComponent(platformStoreId)}.json`;
export const manifestKey = (platformStoreId: string): string => manifestPath(platformStoreId).slice(1);
/** Stable recursively sorted JSON: jsonb key ordering and source object ordering cannot cause redundant delivery. */
export function canonicalManifest(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalManifest).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonicalManifest(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export const manifestHash = (manifest: StoreManifest): string => createHash('sha256').update(canonicalManifest(manifest)).digest('hex');
export const ManifestDeliveryJob = JobMeta.extend({
  store_id: z.uuid(), install_epoch: z.number().int().positive(), platform_store_id: z.string().min(1),
  revision: z.number().int().nonnegative(), cleanup: z.boolean().default(false), phase: z.enum(['upload', 'purge']).default('upload'),
  occurred_at: z.iso.datetime(),
});
export type ManifestDeliveryJob = z.infer<typeof ManifestDeliveryJob>;

export async function sendManifestDelivery(sender: EventSender, tx: TxQueryable, job: ManifestDeliveryJob): Promise<void> {
  const id = await sender.send(MANIFEST_DELIVERY_QUEUE, job, { id: uuidv7(), db: { executeSql: (sql, values) => tx.query(sql, values) } });
  if (!id) throw new Error('manifest delivery enqueue failed');
}

export class ManifestDelivery {
  constructor(private readonly pool: Pool, private readonly integration: Pick<IntegrationService, 'getManifestIdentity'>,
    private readonly storage: ObjectStorage, private readonly purger: CdnPurger, private readonly sender: EventSender, private readonly telemetry: Telemetry) {}

  /** Each phase commits independently. Failed purges never roll back a successful upload checkpoint. */
  async deliver(input: unknown, finalAttempt = false): Promise<void> {
    const job = ManifestDeliveryJob.parse(input);
    try {
      if (!job.cleanup && job.phase === 'upload') await this.prepareUpload(job);
      await withStoreContext(this.pool, job.store_id, async (tx) => {
        await lockStore(tx);
        const identity = await this.integration.getManifestIdentity(job.store_id);
        if (!identity || identity.installEpoch !== job.install_epoch || identity.platformStoreId !== job.platform_store_id) return;
        if (job.cleanup) {
          if (!['uninstalled', 'purged'].includes(identity.lifecycleState)) return;
          if (job.phase === 'upload') {
            await this.storage.put(manifestKey(job.platform_store_id), Buffer.from(canonicalManifest(emptyManifest(job.store_id))), 'application/json', { cacheControl: MANIFEST_CACHE_CONTROL });
            await sendManifestDelivery(this.sender, tx, { ...job, phase: 'purge' });
          } else await this.purge(job);
          return;
        }
        if (identity.lifecycleState === 'purged' || (identity.lifecycleState === 'disconnected' && job.phase === 'upload')) return;
        const result = await tx.query<{ revision: string; requested_at: Date; manifest: StoreManifest; content_hash: string; uploaded_hash: string | null; delivered_hash: string | null; install_epoch: number }>(
          `select d.*, m.manifest from manifest_deliveries d join store_manifests m using (store_id) where d.store_id=$1 for update of d, m`, [job.store_id]);
        const row = result.rows[0];
        if (!row || Number(row.revision) !== job.revision || row.install_epoch !== job.install_epoch) return;
        if (row.delivered_hash === row.content_hash && row.uploaded_hash === row.content_hash) return;
        // An uninstall can precede its asynchronous compile; an earlier active payload must never revive it.
        if (identity.lifecycleState === 'uninstalled' && row.manifest.items.length > 0) return;
        if (job.phase === 'upload') {
          if (row.uploaded_hash !== row.content_hash) {
            await this.storage.put(manifestKey(job.platform_store_id), Buffer.from(canonicalManifest(row.manifest)), 'application/json', { cacheControl: MANIFEST_CACHE_CONTROL });
            await tx.query('update manifest_deliveries set uploaded_hash=content_hash, failed=false where store_id=$1', [job.store_id]);
          }
          await sendManifestDelivery(this.sender, tx, { ...job, phase: 'purge' });
        } else {
          if (row.uploaded_hash !== row.content_hash) throw new Error('manifest upload checkpoint missing');
          await this.purge(job);
          await tx.query('update manifest_deliveries set delivered_hash=content_hash, delivered_at=now(), failed=false where store_id=$1', [job.store_id]);
          this.telemetry.observe(Metric.ManifestDeliveryLag, Math.max(0, (Date.now() - row.requested_at.getTime()) / 1000));
        }
      });
    } catch (error) {
      this.telemetry.counter(Metric.ManifestDeliveryFailures, { phase: job.phase, exhausted: String(finalAttempt) });
      if (finalAttempt && !job.cleanup) await withStoreContext(this.pool, job.store_id, (tx) => tx.query('update manifest_deliveries set failed=true where store_id=$1 and install_epoch=$2 and revision=$3 and delivered_hash is distinct from content_hash', [job.store_id, job.install_epoch, job.revision]));
      throw error;
    }
  }

  /** Commit uncertainty BEFORE PUT: a process death after storage accepts bytes must invalidate any old completion proof. */
  private async prepareUpload(job: ManifestDeliveryJob): Promise<void> {
    await withStoreContext(this.pool, job.store_id, async (tx) => {
      await lockStore(tx);
      const identity = await this.integration.getManifestIdentity(job.store_id);
      if (!identity || identity.installEpoch !== job.install_epoch || identity.platformStoreId !== job.platform_store_id || !['active','uninstalled'].includes(identity.lifecycleState)) return;
      const result = await tx.query<{ revision: string; install_epoch: number; manifest: StoreManifest; uploaded_hash: string | null; content_hash: string }>(
        'select d.*,m.manifest from manifest_deliveries d join store_manifests m using (store_id) where d.store_id=$1 for update of d,m', [job.store_id]);
      const row = result.rows[0];
      if (!row || Number(row.revision) !== job.revision || row.install_epoch !== job.install_epoch || (identity.lifecycleState === 'uninstalled' && row.manifest.items.length > 0)) return;
      if (row.uploaded_hash !== row.content_hash) await tx.query('update manifest_deliveries set uploaded_hash=null,delivered_hash=null,delivered_at=null where store_id=$1', [job.store_id]);
    });
  }

  private async purge(job: ManifestDeliveryJob): Promise<void> {
    await this.purger.purge(manifestPath(job.platform_store_id));
    this.telemetry.counter(Metric.ManifestPurges);
  }
}

export async function enqueueCompiledManifest(sender: EventSender, tx: TxQueryable, telemetry: Telemetry, identity: { platformStoreId: string; installEpoch: number }, storeId: string, revision: number, manifest: StoreManifest, occurredAt: Date): Promise<void> {
  const hash = manifestHash(manifest);
  await tx.query(`insert into manifest_deliveries (store_id,install_epoch,platform_store_id,revision,content_hash,requested_at)
    values ($1,$2,$3,$4,$5,$6) on conflict (store_id) do update set install_epoch=excluded.install_epoch,platform_store_id=excluded.platform_store_id,
    revision=excluded.revision,content_hash=excluded.content_hash,requested_at=case when manifest_deliveries.install_epoch=excluded.install_epoch and manifest_deliveries.delivered_hash is distinct from manifest_deliveries.content_hash then least(manifest_deliveries.requested_at,excluded.requested_at) else excluded.requested_at end,
    uploaded_hash=case when manifest_deliveries.install_epoch=excluded.install_epoch then manifest_deliveries.uploaded_hash end,
    delivered_hash=case when manifest_deliveries.install_epoch=excluded.install_epoch and manifest_deliveries.content_hash=excluded.content_hash then manifest_deliveries.delivered_hash end,
    delivered_at=case when manifest_deliveries.install_epoch=excluded.install_epoch and manifest_deliveries.content_hash=excluded.content_hash then manifest_deliveries.delivered_at end,failed=false`,
  [storeId, identity.installEpoch, identity.platformStoreId, revision, hash, occurredAt]);
  await sendManifestDelivery(sender, tx, { v: 1, trace_id: telemetry.context().trace_id ?? uuidv7(), store_id: storeId, install_epoch: identity.installEpoch, platform_store_id: identity.platformStoreId, revision, cleanup: false, phase: 'upload', occurred_at: occurredAt.toISOString() });
}

/** Privacy-preserving operational totals; forced tenant RLS remains unchanged for all direct reads. */
export async function pollManifestDeliveryStats(pool: Pool, telemetry: Telemetry): Promise<void> {
  const result = await pool.query<{ pending: string; failed: string; oldest_seconds: number }>('select * from manifest_delivery_stats()');
  const row = result.rows[0]!;
  telemetry.gauge(Metric.ManifestDeliveryPending, Number(row.pending));
  telemetry.gauge(Metric.ManifestDeliveryFailed, Number(row.failed));
  telemetry.gauge(Metric.ManifestDeliveryOldestAge, row.oldest_seconds);
}
