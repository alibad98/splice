import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { HealthResponse } from '@slips/contracts';
import { createHttpApp } from '../../http.js';
import type { DatabaseProbe } from '../../ports/database-probe.js';

function probe(up: boolean): DatabaseProbe & { up: boolean } {
  return { up, isReachable: async function (this: { up: boolean }) { return this.up; }, close: async () => undefined };
}

describe('GET /v1/health and /metrics', () => {
  let app: INestApplication;
  let baseUrl: string;
  const db = probe(true);

  beforeAll(async () => {
    app = await createHttpApp(
      { CORS_ORIGINS: 'http://localhost:3000', APP_VERSION: '9.9.9-test', LOG_LEVEL: 'silent', METRICS_TOKEN: 'metrics-token-1234567' },
      { probe: db },
    );
    await app.listen(0);
    baseUrl = await app.getUrl();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('returns 200 ok with a database check that parses as HealthResponse', async () => {
    const res = await fetch(`${baseUrl}/v1/health`, { headers: { Origin: 'http://localhost:3000' } });
    expect(res.status).toBe(200);
    const body = HealthResponse.parse(await res.json());
    expect(body).toMatchObject({ status: 'ok', role: 'http', version: '9.9.9-test', checks: { database: 'ok' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
  });

  it('returns 503 degraded when the database is unreachable', async () => {
    db.up = false;
    try {
      const res = await fetch(`${baseUrl}/v1/health`);
      expect(res.status).toBe(503);
      expect(HealthResponse.parse(await res.json())).toMatchObject({ status: 'degraded', checks: { database: 'down' } });
    } finally {
      db.up = true;
    }
  });

  it('echoes a valid x-request-id, replaces an invalid one, and honours traceparent', async () => {
    const good = await fetch(`${baseUrl}/v1/health`, { headers: { 'x-request-id': 'req-abcdef12', traceparent: `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01` } });
    expect(good.headers.get('x-request-id')).toBe('req-abcdef12');
    expect(good.headers.get('x-trace-id')).toBe('a'.repeat(32));
    const bad = await fetch(`${baseUrl}/v1/health`, { headers: { 'x-request-id': 'bad id with spaces' } });
    expect(bad.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('serves metrics only with the bearer token and counts requests', async () => {
    expect((await fetch(`${baseUrl}/metrics`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/metrics`, { headers: { authorization: 'Bearer wrong-token-123456' } })).status).toBe(401);
    expect((await fetch(`${baseUrl}/metrics`, { headers: { authorization: 'metrics-token-1234567' } })).status).toBe(401);
    const res = await fetch(`${baseUrl}/metrics`, { headers: { authorization: 'Bearer metrics-token-1234567' } });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/slips_api_requests_total\{outcome="success"\} [1-9]/);
    expect(text).toContain('slips_queue_depth');
  });

  it('answers unknown routes with problem+json and counts a client error', async () => {
    const res = await fetch(`${baseUrl}/nope`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    await new Promise((r) => setTimeout(r, 50));
    const metrics = await (await fetch(`${baseUrl}/metrics`, { headers: { authorization: 'Bearer metrics-token-1234567' } })).text();
    expect(metrics).toMatch(/slips_api_requests_total\{outcome="client_error"\} [1-9]/);
  });
});

describe('metrics endpoint when METRICS_TOKEN is unset', () => {
  it('is disabled (404)', async () => {
    const app = await createHttpApp({ CORS_ORIGINS: 'http://localhost:3000', LOG_LEVEL: 'silent' }, { probe: probe(true) });
    await app.listen(0);
    try {
      expect((await fetch(`${await app.getUrl()}/metrics`)).status).toBe(404);
    } finally {
      await app.close();
    }
  });
});
