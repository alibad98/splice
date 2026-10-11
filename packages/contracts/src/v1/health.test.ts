import { describe, expect, it } from 'vitest';
import { HealthResponse } from './health.js';

describe('HealthResponse v1', () => {
  it('parses a valid body', () => {
    const body = { status: 'ok', role: 'http', version: '0.0.0', time: new Date().toISOString() };
    expect(HealthResponse.parse(body)).toEqual(body);
  });
  it('tolerates unknown fields (clients parse non-strict)', () => {
    const r = HealthResponse.safeParse({ status: 'ok', role: 'http', version: '1', time: new Date().toISOString(), extra: 1 });
    expect(r.success).toBe(true);
  });
  it('rejects an unknown status', () => {
    expect(HealthResponse.safeParse({ status: 'nope', role: 'http', version: '1', time: new Date().toISOString() }).success).toBe(false);
  });
});
