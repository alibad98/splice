import { Controller, Get, Inject, Res } from '@nestjs/common';
import { HealthResponse } from '@slips/contracts';
import type { Response } from 'express';
import { APP_INFO, type AppInfo } from '../../infra.module.js';
import { Public } from '../session/public.decorator.js';
import { DATABASE_PROBE, type DatabaseProbe } from '../../ports/database-probe.js';

export function buildHealth(version: string, databaseUp: boolean, now: Date = new Date()): HealthResponse {
  return HealthResponse.parse({
    status: databaseUp ? 'ok' : 'degraded',
    role: 'http',
    version,
    time: now.toISOString(),
    checks: { database: databaseUp ? 'ok' : 'down' },
  });
}

@Public()
@Controller('v1/health')
export class HealthController {
  constructor(
    @Inject(DATABASE_PROBE) private readonly probe: DatabaseProbe,
    @Inject(APP_INFO) private readonly info: AppInfo,
  ) {}

  /** 200 when the database answers, 503 with `degraded` otherwise. */
  @Get()
  async get(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const body = buildHealth(this.info.version, await this.probe.isReachable());
    if (body.status !== 'ok') res.status(503);
    return body;
  }
}
