import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { PinoTelemetry } from './pino-telemetry.js';
import { TelemetryExceptionFilter } from './http.js';

function run(status: number) {
  let body: Record<string, unknown> = {};
  const res = { status: () => res, type: () => res, json: (b: Record<string, unknown>) => { body = b; } };
  const host = { switchToHttp: () => ({ getResponse: () => res }) };
  new TelemetryExceptionFilter(new PinoTelemetry({ role: 'http', level: 'silent' })).catch(new HttpException({ message: 'internal db detail' }, status), host as never);
  return body;
}

describe('problem+json detail', () => {
  it('omits detail for 5xx and keeps it for 4xx', () => {
    expect('detail' in run(500)).toBe(false);
    expect(run(400).detail).toBe('internal db detail');
  });
});
