import { Controller, Get } from '@nestjs/common';
import { HealthResponse } from '@slips/contracts';

export function buildHealth(version: string, now: Date = new Date()): HealthResponse {
  return HealthResponse.parse({ status: 'ok', role: 'http', version, time: now.toISOString() });
}

@Controller('v1/health')
export class HealthController {
  @Get()
  get(): HealthResponse {
    return buildHealth(process.env.APP_VERSION ?? '0.0.0');
  }
}
