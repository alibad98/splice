import { describe, expect, it } from 'vitest';
import { getHealth } from './health';

const okBody = { status: 'ok', role: 'http', version: '0.0.0', time: new Date().toISOString() };
const fakeFetch = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

describe('getHealth', () => {
  it('returns the parsed health on 200', async () => {
    const r = await getHealth(fakeFetch(200, okBody), 'http://api');
    expect(r).toEqual({ ok: true, health: okBody });
  });
  it('strips trailing slashes from the base URL', async () => {
    let url = '';
    const spy = (async (u: string) => { url = u; return Response.json(okBody); }) as unknown as typeof fetch;
    await getHealth(spy, 'http://api//');
    expect(url).toBe('http://api/v1/health');
  });
  it('reports non-2xx responses', async () => {
    expect(await getHealth(fakeFetch(500, {}), 'http://api')).toEqual({ ok: false, error: 'HTTP 500' });
  });
  it('shows a degraded 503 body instead of a bare status code', async () => {
    const degraded = { ...okBody, status: 'degraded', checks: { database: 'down' } };
    expect(await getHealth(fakeFetch(503, degraded), 'http://api')).toEqual({ ok: true, health: degraded });
  });
  it('reports bodies that do not match the contract', async () => {
    expect((await getHealth(fakeFetch(200, { status: 'weird' }), 'http://api')).ok).toBe(false);
  });
  it('reports network errors', async () => {
    const failing = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    expect(await getHealth(failing, 'http://api')).toEqual({ ok: false, error: 'ECONNREFUSED' });
  });
});
