import { defineConfig } from '@playwright/test';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const gunPort = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const webPort = gunPort - 8080 + 3001;

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'html',
  timeout: 180_000,
  expect: { timeout: 15_000 },

  use: {
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  webServer: [
    {
      command:
        `CHATROOM_MAX_CAPACITY=50 CHATROOM_ENABLE_FIFO=false E2E_GUN_MEMORY_ONLY=1 P2P_RATE_LIMIT_MAX_EVENTS=5000 PORT=${gunPort} node dist/server/server/index.js`,
      cwd: repoRoot,
      port: gunPort,
      timeout: 120_000,
      reuseExistingServer: process.env.E2E_REUSE_SERVERS === '1',
    },
    {
      command: `node scripts/e2e-static-web.mjs ${webPort}`,
      cwd: repoRoot,
      port: webPort,
      timeout: 30_000,
      reuseExistingServer: process.env.E2E_REUSE_SERVERS === '1',
    },
  ],
});
