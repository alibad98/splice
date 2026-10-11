import { describe, expect, it } from 'vitest';
import { GROUP_POLICY, QUEUE_GROUPS, queueOptions, queuesFor } from './queues.js';

describe('queue policy', () => {
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
});
