import type { LoggerService } from '@nestjs/common';
import { redact, scrubString } from './redact.js';
import type { Telemetry } from '../../ports/telemetry.js';

/** Route Nest's own framework logs through telemetry so every line is JSON and redacted. */
export class NestTelemetryLogger implements LoggerService {
  constructor(private readonly telemetry: Telemetry) {}
  private text(message: unknown): string {
    return scrubString(typeof message === 'string' ? message : (JSON.stringify(redact(message)) ?? String(message)));
  }
  log(message: unknown, context?: string) {
    this.telemetry.log.info(this.text(message), { context });
  }
  error(message: unknown, ...rest: unknown[]) {
    this.telemetry.log.error(this.text(message), { detail: rest.length ? rest : undefined });
  }
  warn(message: unknown, context?: string) {
    this.telemetry.log.warn(this.text(message), { context });
  }
  debug(message: unknown, context?: string) {
    this.telemetry.log.debug(this.text(message), { context });
  }
  verbose(message: unknown, context?: string) {
    this.telemetry.log.debug(this.text(message), { context });
  }
}
