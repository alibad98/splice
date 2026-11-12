import { describe, expect, it } from 'vitest';
import { EmbeddedSession, SessionInfo } from './session.js';

describe('session contracts', () => {
  it('parses an embedded bearer and defaults the version', () => {
    const s = EmbeddedSession.parse({ access_token: 'x', token_type: 'Bearer', expires_in: 900, expires_at: '2026-10-11T10:00:00.000Z' });
    expect(s.v).toBe(1);
  });
  it('rejects a non-bearer token type and a zero lifetime', () => {
    expect(EmbeddedSession.safeParse({ access_token: 'x', token_type: 'Basic', expires_in: 900, expires_at: '2026-10-11T10:00:00.000Z' }).success).toBe(false);
    expect(EmbeddedSession.safeParse({ access_token: 'x', token_type: 'Bearer', expires_in: 0, expires_at: '2026-10-11T10:00:00.000Z' }).success).toBe(false);
  });
  it('parses session info with optional direct-link fields', () => {
    const info = SessionInfo.parse({ mode: 'direct', store: { name: 'S' }, connection: { state: 'connected', store_name: 'S' }, expires_at: '2026-10-11T10:00:00.000Z', csrf_token: 'c' });
    expect(info.csrf_token).toBe('c');
    expect(info.open_in_platform_url).toBeUndefined();
  });
});

describe('session store domains (Story 3.3)', () => {
  const base = { mode: 'embedded', connection: { state: 'connected', store_name: 'S' }, expires_at: '2026-10-11T10:00:00.000Z' };
  it('carries the synced domains and defaults them to an empty list', () => {
    expect(SessionInfo.parse({ ...base, store: { name: 'S', domains: ['demo.salla.sa'] } }).store.domains).toEqual(['demo.salla.sa']);
    expect(SessionInfo.parse({ ...base, store: { name: 'S' } }).store.domains).toEqual([]);
    expect(SessionInfo.safeParse({ ...base, store: { name: 'S', domains: [1] } }).success).toBe(false);
  });
});
