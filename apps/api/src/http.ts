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
import { DevSallaCommercePlatform, SallaCommercePlatform, unconfiguredPlatform } from './adapters/salla/index.js';
import { sessionStoreData } from './modules/session/session.lifecycle.js';
import { catalogStoreData } from './modules/catalog/catalog.lifecycle.js';
import { contentStoreData } from './modules/content/content.lifecycle.js';
import { mediaStoreData } from './modules/media/media.lifecycle.js';
import { S3ObjectStorage } from './adapters/storage/s3-storage.js';
import { EicarMalwareScanner } from './adapters/scanner/eicar-scanner.js';
import { SsrfSafeFetcher } from './adapters/fetch/ssrf-safe-fetcher.js';
import { DevMediaProcessor } from './adapters/media/dev-media-processor.js';
import { unconfiguredStorage, type ObjectStorage } from './ports/object-storage.js';
import type { Telemetry } from './ports/telemetry.js';
import { ConsoleMailer } from './adapters/mailer/console-mailer.js';
import { ownerInviteListener } from './modules/auth/owner-invite.js';
import { denyAllAdminAccess } from './ports/admin-access.js';

import type { TokenCipher } from './ports/token-cipher.js';
import { AppModule } from './app.module.js';
import { buildOpenApi, docsPage } from './docs/openapi.js';
import type { Env } from './config/env.js';
import { createWebhookRecorder } from './modules/integration/webhook-recorder.js';
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
      | 'API_DOCS'
      | 'WEBHOOK_RECORD_DIR'
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
      | 'S3_ENDPOINT'
      | 'S3_REGION'
      | 'S3_BUCKET'
      | 'S3_ACCESS_KEY'
      | 'S3_SECRET_KEY'
      | 'S3_FORCE_PATH_STYLE'
      | 'MEDIA_UPLOAD_RATE_LIMIT'
    >
  >;

/** Fails closed on use when no master key is configured (local dev without the env var). */
function unconfiguredCipher(): TokenCipher {
  const fail = (): never => {
    throw new Error('TOKEN_ENCRYPTION_KEY is not configured');
  };
  return { keyId: 'unconfigured', encrypt: fail, decrypt: fail };
}

/** S3 storage when the endpoint and keys are set (required in production); otherwise a storage that fails on use. */
function buildStorage(env: HttpEnv, telemetry: Telemetry): ObjectStorage {
  if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY || !env.S3_SECRET_KEY) return unconfiguredStorage();
  return new S3ObjectStorage({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION ?? 'us-east-1',
    bucket: env.S3_BUCKET ?? 'slips-media',
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE ?? true,
    corsOrigins: env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    warn: (message, fields) => telemetry.log.warn(message, fields),
  });
}

/** Development boot: create the media bucket when missing. A storage that is down only logs; uploads fail until it is up. */
export async function ensureDevBucket(storage: ObjectStorage, telemetry: Telemetry): Promise<void> {
  try {
    await storage.ensureBucket?.();
  } catch (err) {
    telemetry.log.warn('media bucket not ensured', { error: err instanceof Error ? err.message : String(err) });
  }
}

/** Build the default adapters from env. Tests override pieces via `overrides`. */
export function buildInfra(env: HttpEnv, role: 'http' | 'worker', overrides: Partial<InfraDeps> = {}): InfraDeps & { telemetry: PinoTelemetry } {
  const version = env.APP_VERSION ?? '0.0.0';
  const telemetry = (overrides.telemetry as PinoTelemetry | undefined) ?? new PinoTelemetry({ level: env.LOG_LEVEL ?? 'info', role, version });
  const databaseUrl = env.DATABASE_URL ?? 'postgres://localhost:5432/postgres';
  const pool = overrides.pool ?? new pg.Pool({ connectionString: databaseUrl, max: 4 });
  pool.on('error', () => undefined);
  const masterKey = env.TOKEN_ENCRYPTION_KEY;
  const devKey = Buffer.alloc(32, 7).toString('base64');
  const cipher =
    overrides.cipher ??
    (masterKey
      ? new EnvelopeTokenCipher({ [env.TOKEN_ENCRYPTION_KEY_ID ?? 'k1']: masterKey }, env.TOKEN_ENCRYPTION_KEY_ID ?? 'k1')
      : env.NODE_ENV === 'development'
        ? new EnvelopeTokenCipher({ k1: devKey }, 'k1')
        : unconfiguredCipher());
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
      : env.NODE_ENV === 'development'
        ? new DevSallaCommercePlatform()
        : unconfiguredPlatform());
  const recorder = env.NODE_ENV === 'production' ? undefined : createWebhookRecorder(env.WEBHOOK_RECORD_DIR);
  const dashboardUrl = env.DASHBOARD_URL ?? 'http://localhost:3000';
  const mailer = overrides.mailer ?? new ConsoleMailer(telemetry);
  const storage = overrides.storage ?? buildStorage(env, telemetry);
  return {
    telemetry,
    pool,
    events: overrides.events ?? new SendOnlyEventSender(databaseUrl, telemetry),
    cipher,
    platform,
    integration: overrides.integration ?? {
      dashboardUrl,
      // OAUTH_STATE_SECRET is required in production (env validation). In dev, fall back to a key derived from the
      // master key, then to a random per-process key (state then only survives within one process).
      stateSecret: env.OAUTH_STATE_SECRET
        ? createHmac('sha256', env.OAUTH_STATE_SECRET).update('slips/oauth-state/v1').digest()
        : masterKey
          ? createHmac('sha256', Buffer.from(masterKey, 'base64')).update('slips/oauth-state/v1').digest()
          : randomBytes(32),
      secureCookies: env.NODE_ENV === 'production',
      ...(recorder ? { webhookRecorder: recorder } : {}),
      ...(platform instanceof DevSallaCommercePlatform ? { devConsent: true } : {}),
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
    mailer,
    storage,
    // Development-only adapter: flags the EICAR test string. A real scanner is a deferred decision (no vendor chosen).
    scanner: overrides.scanner ?? new EicarMalwareScanner(),
    media: overrides.media ?? { uploadRateLimit: env.MEDIA_UPLOAD_RATE_LIMIT ?? 60 },
    // External media links are fetched by the worker only (Story 3.7).
    ...(role === 'worker' ? { fetcher: overrides.fetcher ?? new SsrfSafeFetcher(), processor: overrides.processor ?? new DevMediaProcessor() } : {}),
    lifecycles: overrides.lifecycles ?? [sessionStoreData, catalogStoreData, contentStoreData, mediaStoreData(storage)],
    installListeners: overrides.installListeners ?? [ownerInviteListener({ mailer, telemetry, dashboardUrl })],
    probe: overrides.probe ?? new PgDatabaseProbe(env.DATABASE_URL ?? 'postgres://localhost:5432/postgres'),
    flags: overrides.flags ?? new ConfigFeatureFlags(env.FEATURE_FLAGS),
    info: overrides.info ?? { version },
    metrics: overrides.metrics ?? { render: () => telemetry.registry.render(), token: env.METRICS_TOKEN },
  };
}

export async function createHttpApp(env: HttpEnv, overrides: Partial<InfraDeps> = {}): Promise<INestApplication> {
  const deps = buildInfra(env, 'http', overrides);
  if (env.NODE_ENV === 'development') await ensureDevBucket(deps.storage, deps.telemetry);
  const app = await NestFactory.create(AppModule.register(deps), { logger: new NestTelemetryLogger(deps.telemetry), rawBody: true });
  app.use(requestTelemetry(deps.telemetry));
  app.enableCors({
    origin: env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    credentials: true,
    allowedHeaders: ['authorization', 'content-type', 'x-csrf-token', 'x-slips-client', 'x-request-id'],
    exposedHeaders: ['x-request-id', 'x-trace-id', 'retry-after'],
  });
  // The API is never framed (AD-12); merchant pages are framed by the dashboard app, whose policy allows only the platform origin.
  app.use((_req: unknown, res: { setHeader(n: string, v: string): void }, next: () => void) => {
    res.setHeader('content-security-policy', "frame-ancestors 'none'");
    next();
  });
  // API docs (OpenAPI from the Zod contracts + Swagger UI). Public, read-only; off in production unless API_DOCS=true.
  if (env.API_DOCS ?? env.NODE_ENV !== 'production') {
    const http = app.getHttpAdapter().getInstance();
    http.get('/v1/openapi.json', (req: { protocol: string; get(h: string): string | undefined }, res: { json(b: unknown): void }) => res.json(buildOpenApi(`${req.protocol}://${req.get('host') ?? 'localhost'}`, deps.info.version)));
    http.get('/docs', (_req: unknown, res: { type(t: string): { send(b: string): void } }) => res.type('html').send(docsPage()));
  }
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
