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

/**
 * Parallel-worker configuration.
 *
 *   PW_WORKERS=1 (default) → single worker, same behaviour as before option B.
 *   PW_WORKERS=2+         → N workers, each with its own Gun server on 8080+i and
 *                           webpack dev-server on 3001+i. Tests pick the port from
 *                           TEST_PARALLEL_INDEX via helpers/ports.ts and the baseURL
 *                           fixture in helpers/fixtures.ts.
 *
 * A shared Gun graph would otherwise let one test's chatroom members or talks
 * bleed into another, so per-worker server isolation is the only safe way to go parallel.
 */
/** Accept `PW_WORKER` as a typo-alias for `PW_WORKERS`. */
const parsedWorkers = Number(process.env.PW_WORKERS ?? process.env.PW_WORKER);
const NUM_WORKERS = Number.isFinite(parsedWorkers) && parsedWorkers >= 1 ? Math.floor(parsedWorkers) : 1;
// Let helpers (e.g. clear-database) know whether multiple workers share disk paths.
process.env.PW_WORKERS = String(NUM_WORKERS);

const webServers = Array.from({ length: NUM_WORKERS }).flatMap((_, i) => {
  const gunPort = 8080 + i;
  const webPort = 3001 + i;
  return [
    {
      // In-memory server Gun only: disk radisk + graph clear races leave ghost chatroom members and break IN-list e2e.
      // High capacity + no FIFO: default capacity 3 evicts users when Gun map over-counts; Tom and Jerry must stay in the same room for broadcast/IN sync.
      command: `CHATROOM_MAX_CAPACITY=50 CHATROOM_ENABLE_FIFO=false E2E_GUN_MEMORY_ONLY=1 PORT=${gunPort} node dist/server/server/index.js`,
      port: gunPort,
      timeout: 120 * 1000,
      // Must spawn with E2E_GUN_MEMORY_ONLY + CHATROOM_* ; reusing a manually started dev:server ignores those env vars and keeps e2e flaky.
      reuseExistingServer: false,
    },
    {
      command: `CHATROOM_MAX_CAPACITY=50 CHATROOM_ENABLE_FIFO=false PORT=${webPort} npm run dev:web:e2e -- --port ${webPort}`,
      port: webPort,
      timeout: 120 * 1000,
      reuseExistingServer: false,
    },
  ];
});

export default defineConfig({
  testDir: './tests/e2e',
  // Keep tests in a file serial so shared beforeAll/afterAll and multi-step flows stay ordered.
  // Parallelism is across files only (different workers still use isolated ports + artifacts).
  // Playwright schedules files in lexicographic path order; put the slowest specs first (e.g.
  // `00-*.spec.ts`) so PW_WORKERS>1 starts long jobs immediately and avoids a single-worker tail.
  // Heavy suites that used to share one file (serial tests) are split into multiple `*.spec.ts`
  // files so each long flow can occupy its own worker in parallel.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: NUM_WORKERS,
  reporter: 'html',
  timeout: 300000,
  // Full `npm run test:e2e` keeps webpack + Gun warm for a long time; 30s was tight for multi-browser talks.
  expect: {
    timeout: 45_000,
  },

  use: {
    // Fallback baseURL for any tool that reads `use.baseURL` at config load.
    // Tests override this per-worker via the `test` fixture in tests/e2e/helpers/fixtures.ts
    // (which reads TEST_PARALLEL_INDEX, only set inside worker processes).
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: process.env.CI ? true : false,
    ...(launchOptions ? { launchOptions } : {}),
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: webServers,
});
