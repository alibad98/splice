import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { HealthResponse } from '@slips/contracts';
import { createHttpApp } from '../../http.js';

describe('GET /v1/health', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.APP_VERSION = '9.9.9-test';
    app = await createHttpApp({ CORS_ORIGINS: 'http://localhost:3000' });
    await app.listen(0);
    baseUrl = await app.getUrl();
  });
  afterAll(async () => {
    await app?.close();
    delete process.env.APP_VERSION;
  });

  it('returns 200 with a body that parses as HealthResponse', async () => {
    const res = await fetch(`${baseUrl}/v1/health`, { headers: { Origin: 'http://localhost:3000' } });
    expect(res.status).toBe(200);
    const body = HealthResponse.parse(await res.json());
    expect(body.status).toBe('ok');
    expect(body.role).toBe('http');
    expect(body.version).toBe('9.9.9-test');
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
  });
});
