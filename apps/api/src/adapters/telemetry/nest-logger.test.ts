import { describe, expect, it } from 'vitest';
import { NestTelemetryLogger } from './nest-logger.js';

describe('NestTelemetryLogger', () => {
  it('masks object messages and credential strings', () => {
    const msgs: string[] = [];
    const telemetry = { log: { info: (m: string) => msgs.push(m), warn: () => undefined, error: () => undefined, debug: () => undefined } };
    const logger = new NestTelemetryLogger(telemetry as never);
    logger.log({ token: 'x-secret-value' });
    logger.log('got Bearer abc123');
    expect(msgs.join(' ')).not.toMatch(/x-secret-value|abc123/);
  });
});
