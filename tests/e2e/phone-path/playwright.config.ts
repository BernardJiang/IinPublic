import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import { PHONE_PATH_PORTS } from './phone-path-ports';

const repoRoot = path.resolve(__dirname, '..', '..', '..');

/**
 * Phone-path journeys (docs/testing/journey-coverage.md).
 *
 * Every other browser E2E spec talks straight to a desktop Node hub. Android does not: its
 * WebView talks to an embedded node on the phone, which relays shared data to the hub over
 * explicit HTTP and runs on Node 18 with no global WebCrypto. Three Android-only bugs on
 * 2026-10-13 (no `crypto.subtle`, Places never relayed to the hub, a relay timeout shorter than
 * the hub's empty-room read) passed the whole browser suite because none of that ran.
 *
 * This config runs:
 *   - one hub (`dist/server/server/index.js`, the same program as www.iinpublic.com);
 *   - two phone-like embedded nodes (scripts/e2e-phone-node.mjs: production relay mode, no
 *     global WebCrypto, fresh data dir), "phone A" and "phone B";
 * and specs drive a browser per user against a phone's origin (or the hub's, for a web user).
 *
 * `npm run test:e2e:phone-path:slow-hub` adds 400 ms to every hub API call, a mobile network's
 * round trip (src/server/middleware/e2e-latency.ts), on top of the hub's own slow Gun reads.
 *
 * Needs a prebuilt dist/ (`npm run build:embedded`); the npm script does that first.
 */
const hubDelay = process.env.E2E_HUB_API_DELAY_MS ? ` E2E_HUB_API_DELAY_MS=${process.env.E2E_HUB_API_DELAY_MS}` : '';
const reuse = process.env.E2E_REUSE_SERVERS === '1';

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../../../playwright-report-phone-path' }]],
  timeout: 240_000,
  expect: { timeout: 15_000 },
  outputDir: '../../../test-results/phone-path',

  use: {
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    headless: process.env.PW_HEADED !== '1',
    launchOptions: { args: ['--disable-features=WebRtcHideLocalIpsWithMdns'], slowMo: Number(process.env.PW_SLOW_MO || 0) },
  },

  projects: [{ name: 'phone-path', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      command:
        `E2E_GUN_MEMORY_ONLY=1 P2P_RATE_LIMIT_MAX_EVENTS=5000${hubDelay} ` +
        `PORT=${PHONE_PATH_PORTS.hub} node dist/server/server/index.js`,
      cwd: repoRoot,
      url: `http://127.0.0.1:${PHONE_PATH_PORTS.hub}/health`,
      timeout: 120_000,
      reuseExistingServer: reuse,
      stdout: process.env.PHONE_PATH_SERVER_LOGS === '1' ? 'pipe' : 'ignore',
    },
    {
      command: `node scripts/e2e-phone-node.mjs ${PHONE_PATH_PORTS.phoneA} ${PHONE_PATH_PORTS.hub}`,
      cwd: repoRoot,
      url: `http://127.0.0.1:${PHONE_PATH_PORTS.phoneA}/health`,
      timeout: 120_000,
      reuseExistingServer: reuse,
      stdout: process.env.PHONE_PATH_SERVER_LOGS === '1' ? 'pipe' : 'ignore',
    },
    {
      command: `node scripts/e2e-phone-node.mjs ${PHONE_PATH_PORTS.phoneB} ${PHONE_PATH_PORTS.hub}`,
      cwd: repoRoot,
      url: `http://127.0.0.1:${PHONE_PATH_PORTS.phoneB}/health`,
      timeout: 120_000,
      reuseExistingServer: reuse,
      stdout: process.env.PHONE_PATH_SERVER_LOGS === '1' ? 'pipe' : 'ignore',
    },
  ],
});
