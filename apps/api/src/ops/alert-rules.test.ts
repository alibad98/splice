import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../../..');
const file = JSON.parse(readFileSync(resolve(repoRoot, 'ops/alert-rules.json'), 'utf8')) as {
  rules: Array<{ id: string; expr: string; threshold: number; owner: string; runbook: string; window: string }>;
};

describe('alert rules', () => {
  it('covers the 5-minute API error rate and webhook dead-lettering', () => {
    const ids = file.rules.map((r) => r.id);
    expect(ids).toContain('api-error-rate-5m');
    expect(ids).toContain('webhook-dead-lettered');
    expect(file.rules.find((r) => r.id === 'api-error-rate-5m')).toMatchObject({ window: '5m' });
  });

  it('gives every rule an owner, a threshold and an existing runbook under docs/runbooks', () => {
    for (const rule of file.rules) {
      expect(rule.owner, rule.id).toMatch(/\S/);
      expect(typeof rule.threshold, rule.id).toBe('number');
      expect(rule.runbook, rule.id).toMatch(/^docs\/runbooks\/.+\.md$/);
      expect(existsSync(resolve(repoRoot, rule.runbook)), `${rule.id} runbook exists`).toBe(true);
      expect(readFileSync(resolve(repoRoot, rule.runbook), 'utf8'), rule.id).toContain(rule.id);
    }
  });

  it('only references metrics the telemetry registry declares', async () => {
    const { PinoTelemetry } = await import('../adapters/telemetry/pino-telemetry.js');
    const exposed = new PinoTelemetry({ role: 'http', level: 'silent' }).registry.render();
    for (const rule of file.rules) {
      for (const name of rule.expr.match(/slips_[a-z_]+/g) ?? []) expect(exposed, `${rule.id}: ${name}`).toContain(`# TYPE ${name} `);
    }
  });
});
