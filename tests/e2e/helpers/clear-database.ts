import type { Page } from '@playwright/test';
import { gunBaseURL } from './ports';

/**
 * Clear all Gun.js databases (client IndexedDB + server in-memory graph).
 *
 * All E2E servers run with E2E_GUN_MEMORY_ONLY=1 (radisk:false, no disk persistence),
 * so no filesystem cleanup is needed. The HTTP endpoint clears the server's in-memory
 * graph, incomingTalksMap, and conversationsMap atomically. Each worker targets only
 * its own server port, so parallel workers never interfere.
 */
export async function clearGunDatabases() {
  const clearUrl = `${gunBaseURL()}/api/test/clear-database`;
  try {
    const response = await fetch(clearUrl, { method: 'POST' });
    if (!response.ok) {
      console.warn('  ⚠️ Failed to clear Gun.js server database:', response.statusText);
    }
  } catch (error) {
    console.warn(`  ⚠️ Could not connect to Gun.js server at ${clearUrl}:`, (error as Error).message);
  }
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
