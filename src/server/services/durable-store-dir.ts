import fs from 'fs';
import os from 'os';
import path from 'path';

/** Parent of every test server's throwaway store directories (outside the repo). */
export const E2E_DURABLE_STORE_ROOT = path.join(os.tmpdir(), 'iinpublic-e2e-radata');

const throwawayDirs = new Set<string>();
let cleanupInstalled = false;

function removeThrowawayDirs(): void {
  for (const dir of throwawayDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort: the next server on this port wipes it at start */
    }
  }
}

function installCleanup(): void {
  if (cleanupInstalled) return;
  cleanupInstalled = true;
  process.on('exit', removeThrowawayDirs);
  // Without a handler Node dies on these signals without running 'exit' handlers.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      removeThrowawayDirs();
      process.exit(signal === 'SIGINT' ? 130 : 143);
    });
  }
}

/**
 * Directory for a server-side radisk store (TechSupport mailbox, chatroom presence), keyed by PORT
 * so parallel servers never share one.
 *
 * Dev and production keep `<cwd>/<name>-<port>`: TechSupport questions must survive a relay restart.
 * A test server (E2E_GUN_MEMORY_ONLY=1, set by every E2E spawner) has no use for the data once it
 * stops — POST /api/test/clear-database already wipes both stores between tests — so it gets a
 * directory under the OS temp dir, wiped at start and removed when the process exits.
 */
export function durableStoreDir(name: string): string {
  const port = process.env.PORT || '8080';
  if (process.env.E2E_GUN_MEMORY_ONLY !== '1') return path.join(process.cwd(), `${name}-${port}`);
  const dir = path.join(E2E_DURABLE_STORE_ROOT, `${name}-${port}`);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* a stale directory must never stop the server from starting */
  }
  throwawayDirs.add(dir);
  installCleanup();
  return dir;
}
