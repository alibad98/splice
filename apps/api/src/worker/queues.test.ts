import { MANIFEST_DELIVERY_QUEUE } from '../modules/publishing/manifest-delivery.js';
import { describe, expect, it } from 'vitest';
import { MANIFEST_COMPILE_QUEUE } from '../modules/publishing/manifest-inputs.js';
import { GROUP_POLICY, QUEUES, QUEUE_GROUPS, queueOptions, queuesFor } from './queues.js';

describe('queue policy', () => {
  it('registers manifest delivery in realtime and selects it for realtime workers', () => {
    expect(QUEUES.filter((q) => q.name === MANIFEST_DELIVERY_QUEUE)).toEqual([{ name: MANIFEST_DELIVERY_QUEUE, group: 'realtime' }]);
    expect(queuesFor(['realtime']).map((q) => q.name)).toContain(MANIFEST_DELIVERY_QUEUE);
  });
  it('defines exactly the realtime, media and batch groups', () => {
    expect([...QUEUE_GROUPS]).toEqual(['realtime', 'media', 'batch']);
    expect(Object.keys(GROUP_POLICY).sort()).toEqual(['batch', 'media', 'realtime']);
  });

  it('defaults to 5 attempts with 30 s -> 15 min exponential backoff', () => {
    for (const group of ['realtime', 'batch'] as const) {
      expect(queueOptions(group)).toEqual({ retryLimit: 4, retryDelay: 30, retryBackoff: true, retryDelayMax: 900 });
    }
  });

  it('gives media 3 attempts', () => {
    expect(queueOptions('media').retryLimit).toBe(2);
  });

  it('selects only queues in the requested groups', () => {
    const queues = [
      { name: 'integration.webhook', group: 'realtime' as const },
      { name: 'media.transcode', group: 'media' as const },
      { name: 'analytics.rollup', group: 'batch' as const },
    ];
    expect(queuesFor(['realtime', 'batch'], queues).map((q) => q.name)).toEqual(['integration.webhook', 'analytics.rollup']);
  });

  it('runs the store manifest compile in the realtime group (Story 4.4)', () => {
    expect(QUEUES.filter((q) => q.name === MANIFEST_COMPILE_QUEUE)).toEqual([{ name: 'publishing.manifest.compile', group: 'realtime' }]);
    expect(queuesFor(['realtime']).map((q) => q.name)).toContain(MANIFEST_COMPILE_QUEUE);
  });
});
