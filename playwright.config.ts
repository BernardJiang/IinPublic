import { defineConfig, devices } from '@playwright/test';

/** Milliseconds between browser actions (CLI has no --slow-mo). Example: `PW_SLOW_MO=1000 npm run test:e2e -- …` */
const pwSlowMo = process.env.PW_SLOW_MO;
const slowMoMs =
  pwSlowMo != null && pwSlowMo !== ''
    ? Number(pwSlowMo)
    : undefined;
const launchOptions =
  typeof slowMoMs === 'number' && !Number.isNaN(slowMoMs) && slowMoMs >= 0
    ? { slowMo: slowMoMs }
    : undefined;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  timeout: 300000,

  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: false,
    ...(launchOptions ? { launchOptions } : {}),
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      command: 'npm run dev:server',
      port: 8080,
      timeout: 120 * 1000,
      reuseExistingServer: true,
    },
    {
      command: 'npm run dev:web:e2e',
      port: 3001,
      timeout: 120 * 1000,
      reuseExistingServer: true,
    },
  ],
});
