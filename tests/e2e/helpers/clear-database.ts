import type { Page } from '@playwright/test';
import { gunBaseURL } from './ports';
import { assertTechSupportBaseline } from './techsupport-baseline';
import { techSupportBaselineGraph } from '../../../src/shared/techsupport-graph';

/** Let in-memory graph swaps and any in-flight relay frames drain (parallel E2E). */
const SETTLE_AFTER_CLEAR_MS = 250;

const CLEAR_POST_MAX_ATTEMPTS = 12;

const CLEAR_POST_INITIAL_BACKOFF_MS = 80;

/** Poll until the Gun/API process for this worker answers /health (Playwright webServer startup). */
const HEALTH_POLL_INTERVAL_MS = 100;

const HEALTH_POLL_MAX_WAIT_MS = 25_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until `GET /health` succeeds on this worker's Gun port.
 * Use before destructive clears so we do not spam POSTs while the server is still binding.
 */
export async function waitForGunApiReady(maxWaitMs = HEALTH_POLL_MAX_WAIT_MS): Promise<void> {
  const healthUrl = `${gunBaseURL()}/health`;
  const deadline = Date.now() + maxWaitMs;
  let lastErr = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl, { method: 'GET' });
      if (res.ok) return;
      lastErr = `${res.status} ${res.statusText}`;
    } catch (e) {
      lastErr = (e as Error).message;
    }
    await sleep(HEALTH_POLL_INTERVAL_MS);
  }
  throw new Error(`waitForGunApiReady: ${healthUrl} not reachable after ${maxWaitMs}ms (${lastErr})`);
}

/**
 * Clear all Gun.js databases (client IndexedDB + server in-memory graph).
 *
 * All E2E servers run with E2E_GUN_MEMORY_ONLY=1 (radisk:false, no disk persistence),
 * so no filesystem cleanup is needed. The HTTP endpoint clears the server's in-memory
 * graph, incomingTalksMap, and conversationsMap atomically. Each worker targets only
 * its own server port, so parallel workers never interfere.
 *
 * **Synchronization:** polls `/health` first, retries `POST /api/test/clear-database` with
 * exponential backoff on network or 5xx errors, then waits a short settle window so Gun
 * sync teardown mid-clear is less likely to race the next test (`docs/TODO.md` P2).
 */
/** Clear Gun for an isolated spec; stage-pipeline clears still reseed the TechSupport baseline. */
export async function maybeClearGunDatabases(options: { seedTechSupportRoot?: boolean } = {}): Promise<void> {
  if (process.env.E2E_STAGE_PIPELINE === '1' || process.env.E2E_STAGE_PIPELINE === 'true') {
    await clearGunDatabases({ seedTechSupportRoot: options.seedTechSupportRoot });
    return;
  }
  await clearGunDatabases(options);
}

export async function clearGunDatabases(options: { seedTechSupportRoot?: boolean } = {}): Promise<void> {
  await waitForGunApiReady();

  const clearUrl = `${gunBaseURL()}/api/test/clear-database`;
  let lastErr = '';

  for (let attempt = 0; attempt < CLEAR_POST_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(clearUrl, { method: 'POST' });
      const raw = await response.text();
      let body: { success?: boolean; error?: string } = {};
      try {
        body = raw ? (JSON.parse(raw) as typeof body) : {};
      } catch {
        /* non-JSON body */
      }

      if (response.ok && body.success !== false) {
        await sleep(SETTLE_AFTER_CLEAR_MS);
        if (options.seedTechSupportRoot !== false) {
          await seedTechSupportRootBaseline();
          await verifyTechSupportBaseline('after clearGunDatabases');
        }
        return;
      }

      lastErr = body.error || `${response.status} ${response.statusText} ${raw.slice(0, 120)}`;
    } catch (error) {
      lastErr = (error as Error).message;
    }

    const backoff = Math.min(2000, CLEAR_POST_INITIAL_BACKOFF_MS * 2 ** attempt);
    await sleep(backoff);
  }

  // Rather than failing hard when the Gun server has already crashed under load
  // (common after long mass-exchange test sequences), log a warning and return.
  // This prevents clear-failure in finally blocks from masking actual test results.
  console.warn(
    `[clearGunDatabases] WARNING: POST ${clearUrl} failed after ${CLEAR_POST_MAX_ATTEMPTS} attempts (${lastErr}). Server may have crashed under load -- skipping cleanup.`,
  );
}

/**
 * Post-reset guard (docs/TODO.md K4): every seeded baseline must actually contain the
 * built-in TechSupport root. Cheap — the graph is at its smallest right after a clear.
 * Set `E2E_SKIP_BASELINE_GUARD=1` to opt out (e.g. when profiling reset cost).
 */
export async function verifyTechSupportBaseline(context: string): Promise<void> {
  if (process.env.E2E_SKIP_BASELINE_GUARD === '1') return;
  const res = await fetch(`${gunBaseURL()}/api/test/export-snapshot`);
  if (!res.ok) {
    throw new Error(`[techsupport-baseline] ${context}: export-snapshot failed: ${res.status}`);
  }
  const snapshot = (await res.json()) as { gunGraph?: Record<string, unknown> };
  assertTechSupportBaseline(snapshot.gunGraph, context);
}

export async function seedTechSupportRootBaseline(): Promise<void> {
  await waitForGunApiReady();

  const graph = techSupportBaselineGraph();

  const base = gunBaseURL();
  const res = await fetch(`${base}/api/test/import-snapshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      version: 1,
      gunGraph: graph,
      incomingTalks: {},
      conversations: {},
      talkResponses: {},
      statsIdx: { byDay: {}, byRegion: {}, byTalkAnswer: {} },
    }),
  });
  if (!res.ok) {
    throw new Error(`TechSupport snapshot seed failed: ${res.status} ${await res.text()}`);
  }
  await sleep(SETTLE_AFTER_CLEAR_MS);
}

/**
 * Inject an init script into `page` that deletes the Web Worker's IndexedDB
 * (`gun-idb`) before the app scripts run.  Call this **after** `context.newPage()`
 * but **before** `page.goto('/')` so the database is gone before the worker opens it.
 *
 * Use for tests that need a completely fresh Gun graph in the browser (no locally
 * cached data from a previous context/test-run leaking through the Worker's IDB).
 * Do NOT call this for "persistence" sub-tests where you want IDB to survive a
 * page close/reopen within the same BrowserContext.
 */
export async function injectIdbClear(page: Page): Promise<void> {
  await page.addInitScript(async () => {
    try {
      const dbs = await indexedDB.databases?.();
      if (dbs) {
        for (const db of dbs) {
          if (db.name?.startsWith('gun') || db.name === 'gun-idb') {
            indexedDB.deleteDatabase(db.name);
          }
        }
      }
      indexedDB.deleteDatabase('gun-idb');
    } catch {
      // Non-fatal — the worker will create a fresh database regardless.
    }
  });
}

/** Navigate to the web app and wait for Gun auth + main shell (custom BrowserContexts). */
export { gotoAppReady as gotoWebApp } from './timing';
