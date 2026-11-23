import { defineConfig } from '@playwright/test';
import { NOW } from './e2e/clock';

// Browser end-to-end journeys (bun run e2e): the built app, served by
// scripts/e2e-serve.mjs with its own fresh local D1 and the clock fixed at NOW.
// Screen sizes are set per journey (e2e/clock.ts): the Board at desktop size,
// the Driver view at phone size.
const PORT = 8788;

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    browserName: 'chromium',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: `node scripts/e2e-serve.mjs ${PORT} ${NOW}`,
    url: `http://127.0.0.1:${PORT}/api/today`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
  },
});
