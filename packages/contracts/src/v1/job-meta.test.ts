import { describe, expect, it } from 'vitest';
import { JobMeta } from './job-meta.js';

describe('JobMeta v1', () => {
  it('requires v and trace_id; store_id is optional', () => {
    expect(JobMeta.safeParse({ v: 1, trace_id: 't' }).success).toBe(true);
    expect(JobMeta.safeParse({ v: 1, trace_id: 't', store_id: 's' }).success).toBe(true);
    expect(JobMeta.safeParse({ v: 1 }).success).toBe(false);
    expect(JobMeta.safeParse({ v: 2, trace_id: 't' }).success).toBe(false);
  });
});
