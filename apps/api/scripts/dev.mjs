// Local dev: run the API as both process roles (AD-1) from one codebase.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const roles = ['http', 'worker'];
const children = roles.map((role) =>
  spawn('tsx', ['watch', 'src/main.ts'], { stdio: 'inherit', env: { ...process.env, ROLE: role }, shell: process.platform === 'win32' }),
);
let stopping = false;
const stop = () => {
  stopping = true;
  children.forEach((c) => { if (c.exitCode === null && c.signalCode === null) c.kill('SIGTERM'); });
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
children.forEach((c, i) => {
  c.on('error', (err) => {
    console.error(`[dev] failed to start ROLE=${roles[i]}:`, err.message);
    if (!stopping) process.exitCode = 1;
    stop();
  });
  c.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(`[dev] ROLE=${roles[i]} exited (${signal ?? code}); stopping`);
      process.exitCode = code || 1;
    }
    stop();
  });
});
