// Local dev: next dev on DASHBOARD_PORT (default 3000), read from the repo-root .env like the API's dev script.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const port = process.env.DASHBOARD_PORT || '3000';
const child = spawn('next', ['dev', '--port', port], { stdio: 'inherit', env: process.env, shell: process.platform === 'win32' });
const stop = () => {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('error', (err) => {
  console.error('[dev] failed to start next dev:', err.message);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
