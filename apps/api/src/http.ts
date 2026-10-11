import { createHmac, randomBytes } from 'node:crypto';
import pg from 'pg';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PgDatabaseProbe } from './adapters/postgres/pg-probe.js';
import { ConfigFeatureFlags } from './adapters/feature-flags/config-flags.js';
import { requestTelemetry } from './adapters/telemetry/http.js';
import { NestTelemetryLogger } from './adapters/telemetry/nest-logger.js';
import { PinoTelemetry } from './adapters/telemetry/pino-telemetry.js';
import { EnvelopeTokenCipher } from './adapters/crypto/envelope-cipher.js';
import { SendOnlyEventSender } from './adapters/pgboss/send-only-producer.js';
import { SallaCommercePlatform, unconfiguredPlatform } from './adapters/salla/index.js';
import { sessionStoreData } from './modules/session/session.lifecycle.js';
import { denyAllAdminAccess } from './ports/admin-access.js';
import type { TokenCipher } from './ports/token-cipher.js';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';
import type { InfraDeps } from './infra.module.js';

export type HttpEnv = Pick<Env, 'CORS_ORIGINS'> &
  Partial<
    Pick<
      Env,
      | 'DATABASE_URL'
      | 'APP_VERSION'
      | 'LOG_LEVEL'
      | 'FEATURE_FLAGS'
      | 'METRICS_TOKEN'
      | 'NODE_ENV'
      | 'TOKEN_ENCRYPTION_KEY'
      | 'TOKEN_ENCRYPTION_KEY_ID'
      | 'OAUTH_STATE_SECRET'
      | 'SALLA_CLIENT_ID'
      | 'SALLA_CLIENT_SECRET'
      | 'SALLA_REDIRECT_URI'
      | 'SALLA_SCOPES'
      | 'SALLA_APP_ID'
      | 'SALLA_WEBHOOK_SECRET'
      | 'DASHBOARD_URL'
      | 'SESSION_COOKIE_DOMAIN'
    >
  >;

/** Fails closed on use when no master key is configured (local dev without the env var). */
function unconfiguredCipher(): TokenCipher {
  const fail = (): never => {
    throw new Error('TOKEN_ENCRYPTION_KEY is not configured');
  };
  return { keyId: 'unconfigured', encrypt: fail, decrypt: fail };
}

/** Build the default adapters from env. Tests override pieces via `overrides`. */
export function buildInfra(env: HttpEnv, role: 'http' | 'worker', overrides: Partial<InfraDeps> = {}): InfraDeps & { telemetry: PinoTelemetry } {
  const version = env.APP_VERSION ?? '0.0.0';
  const telemetry = (overrides.telemetry as PinoTelemetry | undefined) ?? new PinoTelemetry({ level: env.LOG_LEVEL ?? 'info', role, version });
  const databaseUrl = env.DATABASE_URL ?? 'postgres://localhost:5432/postgres';
  const pool = overrides.pool ?? new pg.Pool({ connectionString: databaseUrl, max: 4 });
  pool.on('error', () => undefined);
  const masterKey = env.TOKEN_ENCRYPTION_KEY;
  const cipher = overrides.cipher ?? (masterKey ? new EnvelopeTokenCipher({ [env.TOKEN_ENCRYPTION_KEY_ID ?? 'k1']: masterKey }, env.TOKEN_ENCRYPTION_KEY_ID ?? 'k1') : unconfiguredCipher());
  const platform =
    overrides.platform ??
    (env.SALLA_CLIENT_ID && env.SALLA_CLIENT_SECRET && env.SALLA_REDIRECT_URI
      ? new SallaCommercePlatform(
          {
            clientId: env.SALLA_CLIENT_ID,
            clientSecret: env.SALLA_CLIENT_SECRET,
            redirectUri: env.SALLA_REDIRECT_URI,
            ...(env.SALLA_SCOPES ? { scopes: env.SALLA_SCOPES } : {}),
            ...(env.SALLA_APP_ID ? { appId: env.SALLA_APP_ID } : {}),
            ...(env.SALLA_WEBHOOK_SECRET ? { webhookSecret: env.SALLA_WEBHOOK_SECRET } : {}),
          },
          telemetry,
        )
      : unconfiguredPlatform());
  return {
    telemetry,
    pool,
    events: overrides.events ?? new SendOnlyEventSender(databaseUrl, telemetry),
    cipher,
    platform,
    integration: overrides.integration ?? {
      dashboardUrl: env.DASHBOARD_URL ?? 'http://localhost:3000',
      // OAUTH_STATE_SECRET is required in production (env validation). In dev, fall back to a key derived from the
      // master key, then to a random per-process key (state then only survives within one process).
      stateSecret: env.OAUTH_STATE_SECRET
        ? createHmac('sha256', env.OAUTH_STATE_SECRET).update('slips/oauth-state/v1').digest()
        : masterKey
          ? createHmac('sha256', Buffer.from(masterKey, 'base64')).update('slips/oauth-state/v1').digest()
          : randomBytes(32),
      secureCookies: env.NODE_ENV === 'production',
    },
    session: overrides.session ?? {
      secret: createHmac('sha256', env.OAUTH_STATE_SECRET ?? (masterKey ? Buffer.from(masterKey, 'base64') : randomBytes(32))).update('slips/session-csrf/v1').digest(),
      secureCookies: env.NODE_ENV === 'production',
      ...(env.SESSION_COOKIE_DOMAIN ? { cookieDomain: env.SESSION_COOKIE_DOMAIN } : {}),
      embeddedTtlMs: 15 * 60_000,
      directMaxAgeMs: 30 * 24 * 3_600_000,
      idleMs: 12 * 3_600_000,
    },
    adminAccess: overrides.adminAccess ?? denyAllAdminAccess,
    lifecycles: overrides.lifecycles ?? [sessionStoreData],
    probe: overrides.probe ?? new PgDatabaseProbe(env.DATABASE_URL ?? 'postgres://localhost:5432/postgres'),
    flags: overrides.flags ?? new ConfigFeatureFlags(env.FEATURE_FLAGS),
    info: overrides.info ?? { version },
    metrics: overrides.metrics ?? { render: () => telemetry.registry.render(), token: env.METRICS_TOKEN },
  };
}

export async function createHttpApp(env: HttpEnv, overrides: Partial<InfraDeps> = {}): Promise<INestApplication> {
  const deps = buildInfra(env, 'http', overrides);
  const app = await NestFactory.create(AppModule.register(deps), { logger: new NestTelemetryLogger(deps.telemetry), rawBody: true });
  app.use(requestTelemetry(deps.telemetry));
  app.enableCors({
    origin: env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    credentials: true,
    allowedHeaders: ['authorization', 'content-type', 'x-csrf-token', 'x-slips-client', 'x-request-id'],
    exposedHeaders: ['x-request-id', 'x-trace-id'],
  });
  // The API is never framed (AD-12); merchant pages are framed by the dashboard app, whose policy allows only the platform origin.
  app.use((_req: unknown, res: { setHeader(n: string, v: string): void }, next: () => void) => {
    res.setHeader('content-security-policy', "frame-ancestors 'none'");
    next();
  });
  app.enableShutdownHooks();
  app.getHttpAdapter().getInstance().set('x-powered-by', false);
  // Routes match case-exactly, so /V1/Admin/... is a 404, never an unguarded alias of an admin route (the guard also lower-cases).
  app.getHttpAdapter().getInstance().set('case sensitive routing', true);
  const original = app.close.bind(app);
  app.close = async () => {
    await original();
    await deps.probe.close();
    await (deps.events as { close?: () => Promise<void> }).close?.();
    await deps.pool.end().catch(() => undefined);
  };
  return app;
}
