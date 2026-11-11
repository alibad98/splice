// The one `ManifestInputs` list (AD-18, Story 4.4 pilot slice): every committed event that can change what a store's
// manifest shows enqueues one debounced, single-flight compile for its store.
import { JobMeta, type EventName } from '@slips/contracts';
import { z } from 'zod';

/** Compile queue (realtime group): one compile per store per slot. */
export const MANIFEST_COMPILE_QUEUE = 'publishing.manifest.compile';

/** Debounce window: triggers within one window share a compile; a later one takes the next window (at most two queued). */
export const MANIFEST_COMPILE_SINGLETON_SECONDS = 10;

/** Gzip budget of a store manifest; above it the compile emits a size warning. */
export const MANIFEST_GZIP_WARN_BYTES = 15 * 1024;

/**
 * Events whose commit may change a store's manifest:
 * - content status and edits (AD-19): every transition into or out of `published`, field edits;
 * - media readiness of slides: an asset becoming `processed` or `failed`;
 * - linked product changes and deletion, and completed catalog syncs (snapshot refresh; guarantees are Story 4.6);
 * - store lifecycle (AD-20): install, reinstall, reconnect, disconnect, uninstall, purge.
 * Settings, plan, key retirement and schema-bump triggers arrive with their events (later stories).
 */
export const MANIFEST_INPUTS = [
  'content.item.published',
  'content.item.ended',
  'content.item.deactivated',
  'content.item.reactivated',
  'content.item.archived',
  'content.item.unarchived',
  'content.item.restored',
  'content.item.deleted',
  'content.item.edited',
  'media.asset.processed',
  'media.asset.failed',
  'catalog.product.updated',
  'catalog.product.deleted',
  'catalog.sync.completed',
  'integration.store.installed',
  'integration.store.reinstalled',
  'integration.store.reconnected',
  'integration.store.disconnected',
  'integration.store.uninstalled',
  'integration.store.purged',
] as const satisfies readonly EventName[];
export type ManifestInput = (typeof MANIFEST_INPUTS)[number];

/** `publishing.manifest.compile` payload: the store and when its triggering event occurred (compile lag). */
export const ManifestCompileJob = JobMeta.extend({ store_id: z.uuid(), occurred_at: z.iso.datetime() });
export type ManifestCompileJob = z.infer<typeof ManifestCompileJob>;
