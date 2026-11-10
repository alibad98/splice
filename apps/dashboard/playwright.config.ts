import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:4174', launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {} },
  webServer: [
    { command: 'node scripts/prepare-preview.mjs && pnpm exec vite --config e2e/vite.config.ts', url: 'http://127.0.0.1:4174', reuseExistingServer: !process.env.CI },
    { command: 'pnpm exec next start --port 4175', url: 'http://127.0.0.1:4175/player-preview/index.html', reuseExistingServer: !process.env.CI },
  ],
});
