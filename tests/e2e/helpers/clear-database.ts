import * as fs from 'fs';
import * as path from 'path';
import type { Page } from '@playwright/test';
import { gunBaseURL, workerIndex } from './ports';

/**
 * Clear all Gun.js databases (client, server disk, server memory).
 * Call this before each test suite to ensure a clean state.
 */
export async function clearGunDatabases() {
  console.log('🧹 Clearing Gun.js databases to start fresh...');

  // Clear client/server radata (Gun file storage); recreate dir so next run can write (avoids ENOENT).
  // Some CI / sandboxed environments disallow removing the mount-point directory
  // itself (EPERM on rmdir) even when its contents are removable, so fall back
  // to deleting the children individually.
  const radataPath = path.join(__dirname, '../../../radata');
  if (fs.existsSync(radataPath)) {
    try {
      fs.rmSync(radataPath, { recursive: true, force: true });
      console.log('  ✅ Cleared client database (radata/)');
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
        console.log('  ✅ Cleared client database contents (radata/*)');
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

  // Clear server database
  const serverDataPath = path.join(__dirname, '../../../data1.json');
  if (fs.existsSync(serverDataPath)) {
    fs.rmSync(serverDataPath, { recursive: true, force: true });
    console.log('  ✅ Cleared server database (data1.json)');
  }

  // Also check for data.json (alternative Gun database location)
  const altServerDataPath = path.join(__dirname, '../../../data.json');
  if (fs.existsSync(altServerDataPath)) {
    fs.rmSync(altServerDataPath, { recursive: true, force: true });
    console.log('  ✅ Cleared alternate server database (data.json)');
  }

  // Clear .tmp files created by Gun.js
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
      console.log(`  ✅ Cleared Gun.js server in-memory database (worker ${workerIndex()})`);
    } else {
      console.warn('  ⚠️ Failed to clear Gun.js server database:', response.statusText);
    }
  } catch (error) {
    console.warn(`  ⚠️ Could not connect to Gun.js server at ${clearUrl}`);
  }

  // Allow server and Gun to finish clearing before next test (longer after many suite clears / disk IO)
  await new Promise((resolve) => setTimeout(resolve, 1000));

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
 */
export async function injectIdbClear(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      indexedDB.deleteDatabase('gun-idb');
    } catch {
      // Non-fatal — the worker will create a fresh database regardless.
    }
  });
}
