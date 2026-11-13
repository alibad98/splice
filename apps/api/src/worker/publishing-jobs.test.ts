// Story 4.6 pilot slice: the publishing event handlers gate product events on a live content link; every other
// manifest input enqueues a compile unconditionally. Real link counting (deleted items excluded) is covered against
// PostgreSQL in `composition/store-manifest.test.ts`.
import { describe, expect, it, vi } from 'vitest';
import { PinoTelemetry } from '../adapters/telemetry/pino-telemetry.js';
import { EventHandlerRegistry } from '../events/dispatcher.js';
import type { TxQueryable } from '../events/outbox.js';
import { MANIFEST_COMPILE_QUEUE, MANIFEST_INPUTS } from '../modules/publishing/manifest-inputs.js';
import { registerPublishingEventHandlers } from './publishing-jobs.js';

const STORE = '11111111-1111-4111-8111-111111111111';
const LINKED = '22222222-2222-4222-8222-222222222222';
const UNLINKED = '33333333-3333-4333-8333-333333333333';
const tx = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as TxQueryable;

function setup() {
  const telemetry = new PinoTelemetry({ role: 'worker', level: 'silent' });
  const debug = vi.spyOn(telemetry.log, 'debug');
  const boss = { send: vi.fn<(queue: string, data: object, options?: Record<string, unknown>) => Promise<string | null>>(async () => 'job-id') };
  const counts = new Map([[LINKED, 2], [UNLINKED, 0]]);
  const content = { getLinkCountsByProductIds: vi.fn(async (_store: string, ids: readonly string[]) => new Map(ids.map((id) => [id, counts.get(id) ?? 0]))) };
  const registry = new EventHandlerRegistry();
  registerPublishingEventHandlers(registry, boss, telemetry, content);
  const run = (name: string, payload: Record<string, unknown>) => registry.handlersFor(name)[0]!.run({ id: 'event-1', name, payload: { v: 1, store_id: STORE, ...payload }, occurredAt: new Date().toISOString() } as never, tx);
  return { boss, content, debug, run };
}

describe('registerPublishingEventHandlers product gate', () => {
  it.each(['catalog.product.updated', 'catalog.product.deleted'])('%s: enqueues a compile for a linked product only', async (name) => {
    const { boss, content, debug, run } = setup();
    await run(name, { product_id: UNLINKED });
    expect(boss.send).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledTimes(1);
    expect(debug.mock.calls[0]![1]).toMatchObject({ event: name, store_id: STORE, product_id: UNLINKED });
    await run(name, { product_id: LINKED });
    expect(boss.send).toHaveBeenCalledTimes(1);
    expect(boss.send.mock.calls[0]![0]).toBe(MANIFEST_COMPILE_QUEUE);
    expect(content.getLinkCountsByProductIds).toHaveBeenLastCalledWith(STORE, [LINKED]);
  });

  it('every other manifest input enqueues without reading content links', async () => {
    const { boss, content, run } = setup();
    const others = MANIFEST_INPUTS.filter((name) => name !== 'catalog.product.updated' && name !== 'catalog.product.deleted');
    for (const name of others) await run(name, {});
    expect(boss.send).toHaveBeenCalledTimes(others.length);
    expect(content.getLinkCountsByProductIds).not.toHaveBeenCalled();
  });
});
