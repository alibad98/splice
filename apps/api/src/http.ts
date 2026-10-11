import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PgDatabaseProbe } from './adapters/postgres/pg-probe.js';
import { ConfigFeatureFlags } from './adapters/feature-flags/config-flags.js';
import { requestTelemetry } from './adapters/telemetry/http.js';
import { NestTelemetryLogger } from './adapters/telemetry/nest-logger.js';
import { PinoTelemetry } from './adapters/telemetry/pino-telemetry.js';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';
import type { InfraDeps } from './infra.module.js';

export type HttpEnv = Pick<Env, 'CORS_ORIGINS'> & Partial<Pick<Env, 'DATABASE_URL' | 'APP_VERSION' | 'LOG_LEVEL' | 'FEATURE_FLAGS' | 'METRICS_TOKEN'>>;

/** Build the default adapters from env. Tests override pieces via `overrides`. */
export function buildInfra(env: HttpEnv, role: 'http' | 'worker', overrides: Partial<InfraDeps> = {}): InfraDeps & { telemetry: PinoTelemetry } {
  const version = env.APP_VERSION ?? '0.0.0';
  const telemetry = (overrides.telemetry as PinoTelemetry | undefined) ?? new PinoTelemetry({ level: env.LOG_LEVEL ?? 'info', role, version });
  return {
    telemetry,
    probe: overrides.probe ?? new PgDatabaseProbe(env.DATABASE_URL ?? 'postgres://localhost:5432/postgres'),
    flags: overrides.flags ?? new ConfigFeatureFlags(env.FEATURE_FLAGS),
    info: overrides.info ?? { version },
    metrics: overrides.metrics ?? { render: () => telemetry.registry.render(), token: env.METRICS_TOKEN },
  };
}

export async function createHttpApp(env: HttpEnv, overrides: Partial<InfraDeps> = {}): Promise<INestApplication> {
  const deps = buildInfra(env, 'http', overrides);
  const app = await NestFactory.create(AppModule.register(deps), { logger: new NestTelemetryLogger(deps.telemetry) });
  app.use(requestTelemetry(deps.telemetry));
  app.enableCors({ origin: env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean), exposedHeaders: ['x-request-id', 'x-trace-id'] });
  app.enableShutdownHooks();
  app.getHttpAdapter().getInstance().set('x-powered-by', false);
  const original = app.close.bind(app);
  app.close = async () => {
    await original();
    await deps.probe.close();
  };
  return app;
}
