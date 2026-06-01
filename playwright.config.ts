import { defineConfig, devices } from '@playwright/test';

/** Milliseconds between browser actions (CLI has no --slow-mo). Example: `PW_SLOW_MO=1000 npm run test:e2e -- …` */
const pwSlowMo = process.env.PW_SLOW_MO;
const slowMoMs =
  pwSlowMo != null && pwSlowMo !== ''
    ? Number(pwSlowMo)
    : undefined;
const webrtcLaunchArgs = [
  '--disable-features=WebRtcHideLocalIpsWithMdns',
];
const launchOptions = {
  args: webrtcLaunchArgs,
  ...(typeof slowMoMs === 'number' && !Number.isNaN(slowMoMs) && slowMoMs >= 0
    ? { slowMo: slowMoMs }
    : {}),
};

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
const STAGE_PIPELINE = process.env.E2E_STAGE_PIPELINE === '1' || process.env.E2E_STAGE_PIPELINE === 'true';
const P2P_DIRECT_CHAT_ENABLED =
  process.env.P2P_DIRECT_CHAT_ENABLED === '0' ? '0' : '1';
const P0_DIRECT_TALK_DELIVERY = process.env.P0_DIRECT_TALK_DELIVERY === '1' ? '1' : '0';
const STAR_SERVER_PERSISTENCE =
  P0_DIRECT_TALK_DELIVERY === '1' || process.env.STAR_SERVER_PERSISTENCE === 'ephemeral'
    ? 'ephemeral'
    : process.env.STAR_SERVER_PERSISTENCE || 'durable';
const NUM_WORKERS = STAGE_PIPELINE
  ? 1
  : Number.isFinite(parsedWorkers) && parsedWorkers >= 1
    ? Math.floor(parsedWorkers)
    : 1;
// Let helpers (e.g. clear-database) know whether multiple workers share disk paths.
process.env.PW_WORKERS = String(NUM_WORKERS);

/**
 * Per-test ceiling. Parallel runs (PW_WORKERS≥4, target ~10 min suite @ 20 workers) use 2 min/test;
 * single-worker debug keeps 5 min. Helpers use E2E_ASSERT_TIMEOUT_MS (10s) for polls — fail fast.
 */
const E2E_ASSERT_TIMEOUT_MS = 10_000;
const E2E_TEST_TIMEOUT_MS = NUM_WORKERS >= 4 ? 120_000 : 300_000;

const webServers = Array.from({ length: NUM_WORKERS }).flatMap((_, i) => {
  const gunPort = 8080 + i;
  const webPort = 3001 + i;
  return [
    {
      // In-memory server Gun only: disk radisk + graph clear races leave ghost chatroom members and break IN-list e2e.
      // High capacity + no FIFO: default capacity 3 evicts users when Gun map over-counts; Tom and Jerry must stay in the same room for broadcast/IN sync.
      command: `CHATROOM_MAX_CAPACITY=50 CHATROOM_ENABLE_FIFO=false E2E_GUN_MEMORY_ONLY=1 P0_DIRECT_TALK_DELIVERY=${P0_DIRECT_TALK_DELIVERY} STAR_SERVER_PERSISTENCE=${STAR_SERVER_PERSISTENCE} P2P_DIRECT_CHAT_ENABLED=${P2P_DIRECT_CHAT_ENABLED} P2P_NODE_ENABLED=0 PORT=${gunPort} node dist/server/server/index.js`,
      port: gunPort,
      timeout: 120 * 1000,
      // Must spawn with E2E_GUN_MEMORY_ONLY + CHATROOM_* ; reusing a manually started dev:server ignores those env vars and keeps e2e flaky.
      reuseExistingServer: false,
    },
    {
      command: `CHATROOM_MAX_CAPACITY=50 CHATROOM_ENABLE_FIFO=false P0_DIRECT_TALK_DELIVERY=${P0_DIRECT_TALK_DELIVERY} STAR_SERVER_PERSISTENCE=${STAR_SERVER_PERSISTENCE} P2P_DIRECT_CHAT_ENABLED=${P2P_DIRECT_CHAT_ENABLED} P2P_NODE_ENABLED=0 PORT=${webPort} npm run dev:web:e2e -- --port ${webPort}`,
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
  /** One retry only — long multi-retry runs hid flakes and stretched suite past 30 min. */
  retries: 1,
  workers: NUM_WORKERS,
  reporter: 'html',
  timeout: E2E_TEST_TIMEOUT_MS,
  expect: {
    timeout: E2E_ASSERT_TIMEOUT_MS,
  },

  use: {
    actionTimeout: E2E_ASSERT_TIMEOUT_MS,
    navigationTimeout: 30_000,
    // Fallback baseURL for any tool that reads `use.baseURL` at config load.
    // Tests override this per-worker via the `test` fixture in tests/e2e/helpers/fixtures.ts
    // (which reads TEST_PARALLEL_INDEX, only set inside worker processes).
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: process.env.CI ? true : false,
    launchOptions,
  },

  projects: STAGE_PIPELINE
    ? [
        { name: 'stage0', testMatch: /staged\/stage0-bootstrap\// },
        { name: 'stage1', testMatch: /staged\/stage1-single-user\//, dependencies: ['stage0'] },
        { name: 'stage2', testMatch: /staged\/stage2-two-user\//, dependencies: ['stage1'] },
        {
          name: 'stage3',
          testMatch: [/staged\/_setup\/load-stage2\.setup\.ts/, /staged\/stage3-three-user\//],
          dependencies: ['stage2'],
        },
        {
          name: 'stage4',
          testMatch: [/staged\/_setup\/load-stage3\.setup\.ts/, /staged\/stage4-four-user\//],
          dependencies: ['stage3'],
        },
        {
          name: 'stage5',
          testMatch: [/staged\/_setup\/load-stage4\.setup\.ts/, /staged\/stage5-multi-user\//],
          dependencies: ['stage4'],
        },
      ]
    : [
        {
          name: 'chromium',
          use: { ...devices['Desktop Chrome'] },
          testIgnore: [
            /staged\/stage0-bootstrap\//,
            /staged\/_setup\//,
            /staged\/[^/]+\/(aaa-|zzz-)/,
            // Star-only regression; run via `npm run test:e2e:star` (P2P_DIRECT_CHAT_ENABLED=0).
            /00-p2p-star-baseline-storage\.spec\.ts/,
            // P0 mesh delivery: excluded from default `test:e2e`; included when P0_DIRECT_TALK_DELIVERY=1.
            ...(P0_DIRECT_TALK_DELIVERY === '1' ? [] : [/00i-p0-direct-talk-delivery\.spec\.ts/]),
          ],
        },
      ],

  webServer: webServers,
});
