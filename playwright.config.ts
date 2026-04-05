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
  // Full `npm run test:e2e` keeps webpack + Gun warm for a long time; 30s was tight for multi-browser talks.
  expect: {
    timeout: 45_000,
  },

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
      // In-memory server Gun only: disk radisk + graph clear races leave ghost chatroom members and break IN-list e2e.
      // High capacity + no FIFO: default capacity 3 evicts users when Gun map over-counts; Tom and Jerry must stay in the same room for broadcast/IN sync.
      command:
        'CHATROOM_MAX_CAPACITY=50 CHATROOM_ENABLE_FIFO=false E2E_GUN_MEMORY_ONLY=1 npm run dev:server',
      port: 8080,
      timeout: 120 * 1000,
      // Must spawn with E2E_GUN_MEMORY_ONLY + CHATROOM_* ; reusing a manually started dev:server ignores those env vars and keeps e2e flaky.
      reuseExistingServer: false,
    },
    {
      command: 'CHATROOM_MAX_CAPACITY=50 CHATROOM_ENABLE_FIFO=false npm run dev:web:e2e',
      port: 3001,
      timeout: 120 * 1000,
      reuseExistingServer: false,
    },
  ],
});
