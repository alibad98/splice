import { z } from 'zod';
import { FLAG_DEFAULTS, type FlagName } from '../ports/feature-flags.js';
import { QUEUE_GROUPS, type QueueGroup } from '../worker/queues.js';

const queueGroups = z
  .preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().default(QUEUE_GROUPS.join(',')))
  .transform((raw, ctx) => {
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    const unknown = parts.filter((p) => !(QUEUE_GROUPS as readonly string[]).includes(p));
    if (unknown.length > 0) {
      ctx.addIssue({ code: 'custom', message: `unknown queue group(s): ${unknown.join(', ')} (allowed: ${QUEUE_GROUPS.join(', ')})` });
      return z.NEVER;
    }
    if (parts.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'must list at least one queue group' });
      return z.NEVER;
    }
    return [...new Set(parts)] as QueueGroup[];
  });

const featureFlags = z
  .string()
  .default('')
  .transform((raw, ctx) => {
    const out: Partial<Record<FlagName, boolean>> = {};
    for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
      const [name, value, ...extra] = part.split('=').map((s) => s.trim());
      if (!name || !(name in FLAG_DEFAULTS) || extra.length > 0 || (value !== 'true' && value !== 'false')) {
        ctx.addIssue({ code: 'custom', message: `invalid flag entry "${part}" (expected <known flag>=true|false; known: ${Object.keys(FLAG_DEFAULTS).join(', ')})` });
        return z.NEVER;
      }
      out[name as FlagName] = value === 'true';
    }
    return out;
  });

const emptyToUndefined = (v: unknown): unknown => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const masterKey = z.string().refine((v) => Buffer.from(v, 'base64').length === 32, { message: 'must be 32 bytes, base64 encoded' });

export const EnvSchema = z
  .object({
  ROLE: z.enum(['http', 'worker']),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  WORKER_QUEUES: queueGroups,
  APP_VERSION: z.string().default('0.0.0'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  FEATURE_FLAGS: featureFlags,
  /** Bearer token for the metrics endpoints; when unset they are disabled. */
  METRICS_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(16).optional()),
  /** Worker role only: port for its liveness and metrics server. */
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(3002),
  /** Master key (base64, 32 bytes) that wraps the data keys encrypting platform tokens. Required in production. Never logged. */
  TOKEN_ENCRYPTION_KEY: z.preprocess(emptyToUndefined, masterKey.optional()),
  /** Id stored beside each ciphertext so the master key can be rotated. */
  TOKEN_ENCRYPTION_KEY_ID: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/).default('k1'),
  /** Salla OAuth app credentials (Partners Portal). Required in production. */
  SALLA_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  SALLA_CLIENT_SECRET: z.preprocess(emptyToUndefined, z.string().min(8).optional()),
  SALLA_REDIRECT_URI: z.preprocess(emptyToUndefined, z.url().optional()),
  /** Space-separated OAuth scopes; the adapter has a minimal default. */
  SALLA_SCOPES: z.preprocess(emptyToUndefined, z.string().optional()),
  SALLA_APP_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  SALLA_WEBHOOK_SECRET: z.preprocess(emptyToUndefined, z.string().min(8).optional()),
  /** Where the merchant lands after install. */
  DASHBOARD_URL: z.url().default('http://localhost:3000'),
})
  .refine((e) => e.PORT !== e.WORKER_HEALTH_PORT, { path: ['WORKER_HEALTH_PORT'], message: 'must differ from PORT' })
  .superRefine((e, ctx) => {
    if (e.NODE_ENV !== 'production') return;
    for (const name of ['TOKEN_ENCRYPTION_KEY', 'SALLA_CLIENT_ID', 'SALLA_CLIENT_SECRET', 'SALLA_REDIRECT_URI'] as const) {
      if (!e[name]) ctx.addIssue({ code: 'custom', path: [name], message: 'is required in production' });
    }
  });
export type Env = z.infer<typeof EnvSchema>;

export class EnvError extends Error {
  constructor(readonly variables: string[], readonly details: string) {
    super(`Invalid environment: ${details}`);
    this.name = 'EnvError';
  }
}

/** Validate env at boot. Throws EnvError naming every missing or invalid variable. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(source);
  if (result.success) return result.data;
  const variables = [...new Set(result.error.issues.map((i) => String(i.path[0] ?? '?')))];
  const details = result.error.issues.map((i) => `${String(i.path[0] ?? '?')}: ${i.message}`).join('; ');
  throw new EnvError(variables, details);
}
