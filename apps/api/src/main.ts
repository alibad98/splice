import 'reflect-metadata';
import { TELEMETRY, type Telemetry } from './ports/telemetry.js';
import { EnvError, parseEnv, type Env } from './config/env.js';

function loadEnvOrExit(): Env {
  try {
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
