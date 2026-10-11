import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// Locally a pre-installed Chromium may be supplied via PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 720 },
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: { command: 'node e2e/server.mjs', url: 'http://127.0.0.1:4173/health', reuseExistingServer: !process.env.CI },
});
