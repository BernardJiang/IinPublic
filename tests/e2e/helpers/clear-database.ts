import type { Page } from '@playwright/test';
import { gunBaseURL } from './ports';

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
/** Skip Gun clear when `E2E_STAGE_PIPELINE=1` (sequential stage accumulation). */
export async function maybeClearGunDatabases(): Promise<void> {
  if (process.env.E2E_STAGE_PIPELINE === '1' || process.env.E2E_STAGE_PIPELINE === 'true') {
    return;
  }
  await clearGunDatabases();
}

export async function clearGunDatabases(): Promise<void> {
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
        return;
      }

      lastErr = body.error || `${response.status} ${response.statusText} ${raw.slice(0, 120)}`;
    } catch (error) {
      lastErr = (error as Error).message;
    }

    const backoff = Math.min(2000, CLEAR_POST_INITIAL_BACKOFF_MS * 2 ** attempt);
    await sleep(backoff);
  }

  throw new Error(
    `clearGunDatabases: POST ${clearUrl} failed after ${CLEAR_POST_MAX_ATTEMPTS} attempts (${lastErr})`,
  );
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
