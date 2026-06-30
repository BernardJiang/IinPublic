import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '..', '..', '..');

/**
 * Dedicated Playwright config for the S3 embedded-node specs.
 *
 * Why a separate config instead of folding into the root playwright.config.ts:
 * those specs spawn their OWN extra `dist/server/node-app/embedded-node.js`
 * process per test file (a real desktop/mobile-shell-style local node, not
 * part of the per-worker web/gun port-pair model the root config manages —
 * see docs/design/S3-embedded-node-shell.md), and need a prebuilt `dist/web`
 * rather than the webpack dev server. Keeping it separate means it can't
 * accidentally perturb the carefully-tuned light/heavy/mesh sharding in the
 * root config (see CLAUDE.md "E2E test infrastructure").
 *
 * This still needs ONE ordinary worker web+gun pair running (slot 0 / ports
 * 3001+8080) for the "browser peer" side and as the upstream Gun server the
 * embedded-node process peers to — same servers the root config spins up,
 * just for a single worker since these specs aren't run with parallelism.
 *
 * Usage: npm run test:e2e:embedded-node
 *   (builds dist/web + dist/server first; see package.json)
 */
const webrtcLaunchArgs = ['--disable-features=WebRtcHideLocalIpsWithMdns'];

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'html',
  timeout: 300_000,
  expect: { timeout: 10_000 },

  use: {
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    baseURL: 'http://127.0.0.1:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: true,
    launchOptions: { args: webrtcLaunchArgs },
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // Slot-0 web+gun pair (the "browser peer" origin, and the upstream Gun
  // server the embedded-node process under test peers to). Mirrors the root
  // config's per-worker servers but fixed to one pair — see ../../helpers/ports.ts.
  webServer: [
    {
      command:
        'CHATROOM_MAX_CAPACITY=50 CHATROOM_ENABLE_FIFO=false E2E_GUN_MEMORY_ONLY=1 P2P_RATE_LIMIT_MAX_EVENTS=5000 PORT=8080 node dist/server/server/index.js',
      cwd: repoRoot,
      port: 8080,
      timeout: 120_000,
      reuseExistingServer: process.env.E2E_REUSE_SERVERS === '1',
    },
    {
      // Reuses the same prebuilt dist/web the embedded-node process under
      // test serves, instead of recompiling via webpack — both peers should
      // be running the exact same SPA build.
      command: 'node scripts/e2e-static-web.mjs 3001',
      cwd: repoRoot,
      port: 3001,
      timeout: 30_000,
      reuseExistingServer: process.env.E2E_REUSE_SERVERS === '1',
    },
  ],
});
