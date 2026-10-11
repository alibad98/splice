import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { Metric } from '../../ports/telemetry.js';
import { REDACTED, isSensitiveKey, redact } from './redact.js';
import { PinoTelemetry } from './pino-telemetry.js';

function makeTelemetry() {
  const lines: Array<Record<string, unknown>> = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      for (const l of chunk.toString().split('\n').filter(Boolean)) lines.push(JSON.parse(l) as Record<string, unknown>);
      cb();
    },
  });
  return { telemetry: new PinoTelemetry({ role: 'http', stream, level: 'debug' }), lines };
}

describe('redaction', () => {
  it('masks tokens, secrets, Authorization and shopper PII at any depth', () => {
    const out = redact({
      headers: { Authorization: 'Bearer abc.def.ghi', 'x-salla-signature': 'sig', 'content-type': 'json' },
      body: { access_token: 't', refresh_token: 'r', client_secret: 's', customer: { email: 'a@b.sa', phone: '+966500000000', first_name: 'Nora' } },
      list: [{ password: 'p' }],
      ok: 'visible',
    }) as {
      headers: Record<string, string>;
      body: Record<string, unknown>;
      list: Array<{ password: string }>;
      ok: string;
    };
    expect(out.headers.Authorization).toBe(REDACTED);
    expect(out.headers['x-salla-signature']).toBe(REDACTED);
    expect(out.headers['content-type']).toBe('json');
    expect(out.body.access_token).toBe(REDACTED);
    expect(out.body.refresh_token).toBe(REDACTED);
    expect(out.body.client_secret).toBe(REDACTED);
    expect(out.body.customer).toBe(REDACTED);
    expect(out.list[0]?.password).toBe(REDACTED);
    expect(out.ok).toBe('visible');
  });

  it('scrubs bearer tokens and JWTs from free text and errors', () => {
    const err = new Error('call failed with Bearer abc123.def-456 and eyJhbGciOi.eyJzdWIiOiJ4.sigpart');
    const out = redact(err) as { message: string };
    expect(out.message).not.toContain('abc123');
    expect(out.message).not.toContain('eyJhbGciOi');
  });

  it('survives cycles and detects sensitive keys case-insensitively', () => {
    const a: Record<string, unknown> = { name: 'x' };
    a.self = a;
    expect(() => redact(a)).not.toThrow();
    expect(isSensitiveKey('Set-Cookie')).toBe(true);
    expect(isSensitiveKey('API_KEY')).toBe(true);
    expect(isSensitiveKey('store_id')).toBe(false);
  });
});

describe('free-text and key coverage', () => {
  it('masks query-string credentials, emails, and strings inside arrays', () => {
    const url = 'GET /cb?code=abc123&access_token=at1&refresh_token=rt1&client_secret=cs1&token=t1&signature=sg1&password=pw1&ok=1';
    const out = redact({ url, list: ['mail nora@example.sa now', url] }) as { url: string; list: string[] };
    for (const leaked of ['abc123', 'at1', 'rt1', 'cs1', 't1&', 'sg1', 'pw1']) expect(out.url).not.toContain(leaked);
    expect(out.url).toContain('ok=1');
    expect(out.list[0]).not.toContain('nora@example.sa');
    expect(out.list[1]).not.toContain('abc123');
  });
  it('masks bare name, recipient, street and city keys', () => {
    const out = redact({ name: 'Nora', recipient: 'x', street: 'y', city: 'z', store_id: 's' }) as Record<string, string>;
    expect(out).toEqual({ name: REDACTED, recipient: REDACTED, street: REDACTED, city: REDACTED, store_id: 's' });
  });
  it('scrubs the log message string', () => {
    const { telemetry, lines } = makeTelemetry();
    telemetry.log.info('calling with Bearer abc123 for nora@example.sa');
    expect(JSON.stringify(lines)).not.toMatch(/abc123|nora@example/);
  });
});

describe('PinoTelemetry', () => {
  it('writes JSON logs carrying request_id, trace_id, store_id and job_id from context', () => {
    const { telemetry, lines } = makeTelemetry();
    telemetry.withContext({ request_id: 'req-1', trace_id: 'trace-1' }, () => {
      telemetry.setStoreId('store-9');
      telemetry.withContext({ job_id: 'job-3' }, () => telemetry.log.info('hello', { thing: 1 }));
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ msg: 'hello', request_id: 'req-1', trace_id: 'trace-1', store_id: 'store-9', job_id: 'job-3', thing: 1, role: 'http' });
  });

  it('redacts secrets in log fields and captured errors', () => {
    const { telemetry, lines } = makeTelemetry();
    telemetry.log.info('x', { authorization: 'Bearer secret-value', nested: { token: 'tok' } });
    telemetry.captureError(new Error('boom Bearer leaked-token'), { email: 'a@b.sa' });
    const text = JSON.stringify(lines);
    expect(text).not.toContain('secret-value');
    expect(text).not.toContain('"tok"');
    expect(text).not.toContain('leaked-token');
    expect(text).not.toContain('a@b.sa');
    expect(lines[1]).toMatchObject({ level: 50, captured: true });
  });

  it('exposes the required metrics in Prometheus text, even before any sample', () => {
    const { telemetry } = makeTelemetry();
    const text = telemetry.registry.render();
    for (const name of [
      Metric.ApiRequests,
      Metric.SallaApiFailures,
      Metric.WebhookFailures,
      Metric.QueueDepth,
      Metric.QueueOldestAgeSeconds,
      Metric.DeadLetterDepth,
      Metric.DashboardRequests,
    ]) {
      expect(text).toContain(`# TYPE ${name} `);
    }
    expect(text).toContain('slips_api_requests_total{outcome="server_error"} 0');
  });

  it('accepts a brand-new metric name without any port change', () => {
    const { telemetry } = makeTelemetry();
    telemetry.observe('slips_compile_lag_seconds', 2.5, { store: 'x' });
    telemetry.counter('slips_player_errors_total', { kind: 'load' });
    const text = telemetry.registry.render();
    expect(text).toContain('slips_compile_lag_seconds_count{store="x"} 1');
    expect(text).toContain('slips_player_errors_total{kind="load"} 1');
  });
});
