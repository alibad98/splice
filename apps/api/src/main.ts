import 'reflect-metadata';
import { TELEMETRY, type Telemetry } from './ports/telemetry.js';
import { EnvError, parseEnv, type Env } from './config/env.js';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function loadEnvOrExit(): Env {
  try {
    try {
      const envPath = fileURLToPath(new URL('../../../.env', import.meta.url));
      if (existsSync(envPath)) {
        const content = readFileSync(envPath, 'utf8');
        for (const line of content.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const match = trimmed.match(/^([\w.-]+)\s*=\s*(.*)$/);
          const key = match?.[1];
          if (key !== undefined) {
            let value = (match?.[2] ?? '').trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
              value = value.slice(1, -1);
            }
            process.env[key] = value;
          }
        }
      }
    } catch (e) {
      console.warn('[boot] failed to reload .env:', e);
    }
    return parseEnv(process.env);
  } catch (err) {
    if (err instanceof EnvError) {
      console.error(`[boot] ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

async function main() {
  const env = loadEnvOrExit();
  if (env.ROLE === 'http') {
    const { createHttpApp } = await import('./http.js');
    const app = await createHttpApp(env);
    await app.listen(env.PORT);
    app.get<Telemetry>(TELEMETRY).log.info('http listening', { port: env.PORT });
  } else {
    const { startWorker } = await import('./worker/worker.js');
    await startWorker(env);
  }
}

main().catch((err: unknown) => {
  console.error('[boot] fatal', err);
  process.exit(1);
});
