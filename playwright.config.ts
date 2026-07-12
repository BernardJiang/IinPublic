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

const NUM_WORKERS = STAGE_PIPELINE
  ? 1
  : Number.isFinite(parsedWorkers) && parsedWorkers >= 1
    ? Math.floor(parsedWorkers)
    : 1;

const explicitAssertTimeout = Number(process.env.E2E_ASSERT_TIMEOUT_MS || '');
const E2E_ASSERT_TIMEOUT_MS =
  Number.isFinite(explicitAssertTimeout) && explicitAssertTimeout > 0
    ? explicitAssertTimeout
    : NUM_WORKERS >= 16
      ? 30_000
      : NUM_WORKERS >= 8
        ? 20_000
        : 10_000;
// Let helpers (e.g. clear-database) know whether multiple workers share disk paths.
process.env.PW_WORKERS = String(NUM_WORKERS);

/**
 * Per-test ceiling. Parallel runs (PW_WORKERS≥4) use 2 min/test;
 * single-worker debug keeps 5 min. Helpers use E2E_ASSERT_TIMEOUT_MS (10s) for polls — fail fast.
 */
const E2E_TEST_TIMEOUT_MS = NUM_WORKERS >= 4 ? 120_000 : 300_000;
const FORCE_HEADLESS = !!process.env.CI || NUM_WORKERS >= 4;
// E2E_VIDEO=off disables failure videos explicitly (e.g. CPU-constrained sandboxes where
// recording overhead pushes specs past their runtime budget).
const VIDEO_MODE: 'off' | 'retain-on-failure' =
  process.env.E2E_VIDEO === 'off' || NUM_WORKERS >= 16 ? 'off' : 'retain-on-failure';
const E2E_P2P_NODE_ENABLED =
  process.env.E2E_P2P_NODE_ENABLED === '1' ||
  process.env.E2E_P2P_NODE_ENABLED === 'true'
    ? '1'
    : '0';

/**
 * Heavy multi-browser specs (4–10 real browser processes each). At high PW_WORKERS they
 * oversubscribe the machine and flake — see docs/testing/retry-dependence-inventory.md.
 * They run in a separate low-worker shard (`test:e2e:parallel` chains light → heavy):
 * E2E_SKIP_HEAVY=1 excludes them from the high-worker light run; the heavy run targets these
 * paths directly at PW_WORKERS=2, where E2E_ASSERT_TIMEOUT_MS is 10s and the machine is not
 * oversubscribed — so they pass within a small budget, no retries / inflated timeouts.
 */
const HEAVY_SPEC_PATTERNS = [
  /mass\//,
  /staged\/stage4-four-user\//,
  /staged\/stage5-multi-user\//,
  /talks-matching\//,
  // Multi-browser staged specs that race only under the high-worker light shard, not at
  // PW_WORKERS=2 (Gun peer-teardown ghost membership inflating headcount, and mesh
  // talk-delivery timing). They pass deterministically at low concurrency, so they ride the
  // same low-worker heavy shard as the rest — keeping the 20-worker light run fast and green.
  // See docs/testing/retry-dependence-inventory.md.
  /staged\/stage2-two-user\/01-login-two-users-headcount\.spec\.ts/,
  /staged\/stage3-three-user\/02-multi-user-headcount\.spec\.ts/,
  /staged\/stage3-three-user\/09-four-types-chatbot\.spec\.ts/,
];
const SKIP_HEAVY = process.env.E2E_SKIP_HEAVY === '1';

// E2E_RUN_ID (exported by scripts/run-test-all.sh) namespaces this invocation's blob reports
// under blob-report/<runId>/. A hung playwright process from an EARLIER run writes its blob
// only when it finally exits — without the namespace it would drop a stale zip into a later
// run's blob-report/ mid-merge (observed: a light phase that hung ~10h wrote its blob the
// moment the next day's run started, corrupting that run's merged report). Ad-hoc runs
// without E2E_RUN_ID keep the flat p<pid>-<ts> layout.
const E2E_RUN_ID = (process.env.E2E_RUN_ID || '').replace(/[^A-Za-z0-9._-]/g, '');
const BLOB_OUTPUT_DIR = `blob-report/${E2E_RUN_ID ? `${E2E_RUN_ID}/` : ''}p${process.pid}-${Date.now()}`;
const SKIP_FIND_SIMILAR = process.env.E2E_SKIP_FIND_SIMILAR === '1';
const SKIP_MESH_PING = process.env.E2E_SKIP_MESH_PING === '1';
const SKIP_MESH_BROADCAST = process.env.E2E_SKIP_MESH_BROADCAST === '1';
const SKIP_MESH_RESPONSE = process.env.E2E_SKIP_MESH_RESPONSE === '1';
const SKIP_MESH_CONTACTS = process.env.E2E_SKIP_MESH_CONTACTS === '1';
const SKIP_ALL_MESH = process.env.E2E_SKIP_ALL_MESH === '1';

// Optional port-range offset so concurrent `playwright test` runs don't collide. Matches
// E2E_PORT_OFFSET in tests/e2e/helpers/ports.ts (default 0). web = 3001+offset+i, gun =
// 8080+offset+i; the browser derives its gun port from window.location.port so the offset
// carries through automatically (see web-gun-service.deriveGunHubUrl).
const PORT_OFFSET = (() => {
  const n = Number(process.env.E2E_PORT_OFFSET);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
})();

const webServers = Array.from({ length: NUM_WORKERS }).flatMap((_, i) => {
  const gunPort = 8080 + PORT_OFFSET + i;
  const webPort = 3001 + PORT_OFFSET + i;
  return [
    {
      // Mesh-talk default: server bootstraps discovery/signaling, then browsers exchange talks over WebRTC.
      // In-memory server Gun only: disk radisk + graph clear races leave ghost chatroom members and break IN-list e2e.
      // High capacity + no FIFO: default capacity 3 evicts users when Gun map over-counts; Tom and Jerry must stay in the same room for broadcast/IN sync.
      // P2P_RATE_LIMIT_MAX_EVENTS: the per-peer abuse limiter (default 200/min) is shared across
      // signaling/ack/relay/discovery POSTs; parallel multi-browser WebRTC reconnect cycles can
      // exceed it and 429s stall mesh formation. Raise it for E2E only.
      command: `CHATROOM_MAX_CAPACITY=50 CHATROOM_ENABLE_FIFO=false E2E_GUN_MEMORY_ONLY=1 P2P_NODE_ENABLED=${E2E_P2P_NODE_ENABLED} P2P_RATE_LIMIT_MAX_EVENTS=5000 NODE_OPTIONS=--max-old-space-size=8192 PORT=${gunPort} node dist/server/server/index.js`,
      port: gunPort,
      timeout: 120 * 1000,
      // Must spawn with E2E_GUN_MEMORY_ONLY + CHATROOM_* ; reusing a manually started dev:server ignores those env vars and keeps e2e flaky.
      reuseExistingServer: process.env.E2E_REUSE_SERVERS === '1',
    },
    {
      // E2E_STATIC_WEB=1: serve the pre-built dist/web/ bundle with a tiny dependency-free
      // static server (no webpack recompile on boot). Used by scripts/run-test-all.sh, which
      // builds dist/web once up front; far faster than re-running `webpack serve` per boot.
      command: process.env.E2E_STATIC_WEB === '1'
        ? `node scripts/e2e-static-web.mjs ${webPort}`
        : `CHATROOM_MAX_CAPACITY=50 CHATROOM_ENABLE_FIFO=false P2P_NODE_ENABLED=${E2E_P2P_NODE_ENABLED} PORT=${webPort} npm run dev:web:e2e -- --port ${webPort}`,
      port: webPort,
      timeout: 120 * 1000,
      reuseExistingServer: process.env.E2E_REUSE_SERVERS === '1',
    },
  ];
});

export default defineConfig({
  testDir: './tests/e2e',
  // Light run (E2E_SKIP_HEAVY=1) excludes the heavy multi-browser specs; they run in their
  // own low-worker shard. Without the flag, the full set is collected (back-compat). Applies to
  // projects that don't define their own testIgnore; the chromium project re-applies it below.
  testIgnore: SKIP_HEAVY ? HEAVY_SPEC_PATTERNS : [],
  // Keep tests in a file serial so shared beforeAll/afterAll and multi-step flows stay ordered.
  // Parallelism is across files only (different workers still use isolated ports + artifacts).
  // Playwright schedules files in lexicographic path order; put the slowest specs first (e.g.
  // `00-*.spec.ts`) so PW_WORKERS>1 starts long jobs immediately and avoids a single-worker tail.
  // Heavy suites that used to share one file (serial tests) are split into multiple `*.spec.ts`
  // files so each long flow can occupy its own worker in parallel.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  /** Global retries: 0 — specs pin their own retries only when documented (see retry-dependence-inventory.md). */
  retries: 0,
  workers: NUM_WORKERS,
  // E2E_BLOB=1 makes every invocation emit a uniquely-named blob report (one process = one
  // file) into blob-report/ instead of overwriting playwright-report/. test:all sets it so the
  // many phase invocations (parallel light run + serial heavy/mesh runs) can be merged into a
  // single combined HTML report via `playwright merge-reports`. Without it, the normal single
  // 'html' report is used.
  // Each invocation writes to its OWN blob-report subdir — the blob reporter wipes its outputDir
  // on start, so a shared dir would let later phase runs clobber earlier ones. test:all then
  // flattens blob-report/*/*.zip into one dir and runs `merge-reports` to produce a single
  // combined HTML report covering every phase.
  reporter:
    process.env.E2E_BLOB === '1' || process.env.E2E_BLOB === 'true'
      // 'list' rides along so redirected phase logs (scripts/run-test-all.sh) carry one line
      // per finished test — the blob reporter alone is silent, which made long phases look hung.
      ? [['blob', {
          outputDir: BLOB_OUTPUT_DIR,
          fileName: `report-${process.pid}-${Date.now()}-${Math.round(Math.random() * 1e6)}.zip`,
        }], ['list']]
      : 'html',
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
    video: VIDEO_MODE,
    headless: FORCE_HEADLESS,
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
            // Server-snapshot reply triage scale tests; keep out of default P2P-only parallel runs until
            // creator replies read pair-edge responses instead of imported server talkResponsesMap state.
            /00v-creator-reply-triage-matrix\.spec\.ts/,
            /00ad-reply-triage-group-date\.spec\.ts/,
            // Server-owned aggregate talk analytics were removed with star persistence. These
            // scenarios return when the local ledger/IPFS aggregate index replaces /api/stats.
            /00-statistics-dashboard\.spec\.ts/,
            /06-survey-customer-satisfaction\.spec\.ts/,
            /07-survey-restaurants\.spec\.ts/,
            /08-route-job-seeking\.spec\.ts/,
            /10-stats-four-types\.spec\.ts/,
            /00i-survey-analytics-dashboard\.spec\.ts/,
            // S3 embedded-node: spawns its own extra dist/server/node-app/embedded-node.js
            // process and needs a prebuilt dist/web, so it runs under its own dedicated
            // Playwright config (tests/e2e/embedded-node/playwright.config.ts) instead of
            // this one's per-worker port-pair webServer array. Excluded here so the default
            // `chromium` project (and testIgnore-based explicit-path runs) never try to pick
            // it up — run it via `npm run test:e2e:embedded-node`.
            /embedded-node\//,
            // Native app E2E launches Electron and owns its own app-local ports/profile
            // directories; run it via `npm run test:e2e:native-app`.
            /native-app\//,
            // Quarantined machine-sensitive specs: run ONLY in the dedicated single-worker
            // sequential phase (E2E_RUN_ISOLATED=1, tests/e2e/isolated) — never alongside
            // any other shard. See scripts/run-test-all.sh wave 'isolated'.
            ...(process.env.E2E_RUN_ISOLATED === '1' ? [] : [/isolated\//]),
            // Heavy multi-browser specs run in their own low-worker shard (E2E_SKIP_HEAVY=1).
            ...(SKIP_HEAVY ? HEAVY_SPEC_PATTERNS : []),
            ...(SKIP_FIND_SIMILAR ? [/staged\/stage5-multi-user\/find-similar-people\.spec\.ts/] : []),
            ...(SKIP_MESH_PING ? [/talks-matching\/01-mesh-ping-overlay\.spec\.ts/] : []),
            ...(SKIP_MESH_BROADCAST ? [/talks-matching\/02-mesh-broadcast-announce\.spec\.ts/] : []),
            ...(SKIP_MESH_RESPONSE ? [/talks-matching\/03-mesh-response-match\.spec\.ts/] : []),
            ...(SKIP_MESH_CONTACTS ? [/talks-matching\/04-local-contacts\.spec\.ts/] : []),
            ...(SKIP_ALL_MESH ? [/talks-matching\//] : []),
          ],
        },
      ],

  webServer: webServers,
});
