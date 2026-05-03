import * as fs from 'fs';
import * as path from 'path';
import type { Page } from '@playwright/test';
import { gunBaseURL, parallelSlot } from './ports';

/**
 * Clear all Gun.js databases (client, server disk, server memory).
 * Call this before each test suite to ensure a clean state.
 *
 * IMPORTANT: Each worker uses isolated disk paths to prevent cross-worker races.
 * The in-memory server clear is the primary mechanism (servers run with
 * E2E_GUN_MEMORY_ONLY=1 which disables radisk).
 */
export async function clearGunDatabases() {
  console.log('🧹 Clearing Gun.js databases to start fresh...');

  // Clear client radata — isolated per worker to prevent cross-worker races.
  const slot = parallelSlot();
  const radataPath = path.join(__dirname, `../../../radata_w${slot}`);
  if (fs.existsSync(radataPath)) {
    try {
      fs.rmSync(radataPath, { recursive: true, force: true });
      console.log(`  ✅ Cleared client database (radata_w${slot}/)`);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES') {
        for (const child of fs.readdirSync(radataPath)) {
          try {
            fs.rmSync(path.join(radataPath, child), { recursive: true, force: true });
          } catch {
            // Best-effort; skip files we can't remove.
          }
        }
        console.log(`  ✅ Cleared client database contents (radata_w${slot}/*)`);
      } else {
        throw err;
      }
    }
  }
  try {
    fs.mkdirSync(radataPath, { recursive: true });
  } catch {
    // Directory already exists — that's fine.
  }

  // Clear server disk files — isolated per worker.
  const serverDataPath = path.join(__dirname, `../../../data1_w${slot}.json`);
  if (fs.existsSync(serverDataPath)) {
    fs.rmSync(serverDataPath, { recursive: true, force: true });
    console.log(`  ✅ Cleared server database (data1_w${slot}.json)`);
  }

  const altServerDataPath = path.join(__dirname, `../../../data_w${slot}.json`);
  if (fs.existsSync(altServerDataPath)) {
    fs.rmSync(altServerDataPath, { recursive: true, force: true });
    console.log(`  ✅ Cleared alternate server database (data_w${slot}.json)`);
  }

  // Clear .tmp files in project root.
  const projectRoot = path.join(__dirname, '../../../');
  const tmpFiles = fs.readdirSync(projectRoot).filter((file) => file.endsWith('.tmp'));
  tmpFiles.forEach((file) => {
    fs.rmSync(path.join(projectRoot, file), { force: true });
  });
  if (tmpFiles.length > 0) {
    console.log(`  ✅ Cleared ${tmpFiles.length} .tmp files`);
  }

  // Clear Gun.js server in-memory database via API — each worker clears ONLY its own server,
  // so parallel workers don't wipe each other's state.
  const clearUrl = `${gunBaseURL()}/api/test/clear-database`;
  try {
    const response = await fetch(clearUrl, {
      method: 'POST',
    });
    if (response.ok) {
      console.log(`  ✅ Cleared Gun.js server in-memory database (parallel ${slot})`);
    } else {
      console.warn('  ⚠️ Failed to clear Gun.js server database:', response.statusText);
    }
  } catch (error) {
    console.warn(`  ⚠️ Could not connect to Gun.js server at ${clearUrl}`);
  }

  // Wait for the server to finish clearing and for Gun to propagate the empty graph.
  // 2 seconds is the minimum; Gun needs time to acknowledge the graph reset
  // and notify connected peers. If tests still fail in full suites, increase this.
  await new Promise((resolve) => setTimeout(resolve, 2000));

  console.log('✅ All databases cleared');
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
 *
 * NOTE: This also deletes any IndexedDB databases that match the 'gun' prefix
 * to ensure no stale Gun data survives across test runs.
 */
export async function injectIdbClear(page: Page): Promise<void> {
  await page.addInitScript(async () => {
    try {
      // Delete all Gun-related IndexedDB databases
      const dbs = await indexedDB.databases?.();
      if (dbs) {
        for (const db of dbs) {
          if (db.name?.startsWith('gun') || db.name === 'gun-idb') {
            indexedDB.deleteDatabase(db.name);
          }
        }
      }
      // Also explicitly delete the main Gun database
      indexedDB.deleteDatabase('gun-idb');
    } catch {
      // Non-fatal — the worker will create a fresh database regardless.
    }
  });
}
