/**
 * Per-worker port derivation for parallel Playwright runs.
 *
 * Background: the full e2e suite shares one Gun graph; running multiple workers against the
 * same server produces cross-test collisions (ghost chatroom members, duplicate talks, etc.).
 * Option B makes every worker spawn its own Gun server + webpack dev server on an offset port
 * and have every client connect only to its worker's server.
 *
 * Convention:
 *   parallel slot 0 → web 3001 / gun 8080  (legacy default; unchanged single-worker behaviour)
 *   parallel slot 1 → web 3002 / gun 8081
 *   parallel slot N → web 3001+N / gun 8080+N
 *
 * Use `TEST_PARALLEL_INDEX` (0 … workers−1), not `TEST_WORKER_INDEX`. The latter is a
 * monotonically increasing process id that changes when a worker restarts, so it would
 * point at the wrong dev server port after a retry.
 *
 * Outside a Playwright worker, `TEST_PARALLEL_INDEX` is unset; we fall back to 0.
 */

import * as path from 'path';

/**
 * Set once per Playwright worker from the `e2eWorkerSlot` fixture (workerInfo.parallelIndex).
 * Prefer this over reading env alone so slot is fixed before any `beforeAll` runs.
 */
let parallelSlotOverride: number | null = null;

export function setE2eParallelSlotFromWorker(n: number): void {
  parallelSlotOverride = n;
}

/** Stable 0..workers−1 slot for ports and filesystem artifacts (maps to spawned servers). */
export function parallelSlot(): number {
  if (parallelSlotOverride != null) return parallelSlotOverride;
  const raw = process.env.TEST_PARALLEL_INDEX;
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Webpack dev-server port for this worker (3001 + index). */
export function webPort(idx: number = parallelSlot()): number {
  return 3001 + idx;
}

/** Gun/API server port for this worker (8080 + index). */
export function gunPort(idx: number = parallelSlot()): number {
  return 8080 + idx;
}

/**
 * Use 127.0.0.1 (not "localhost") so every browser resolves the same loopback stack.
 * With multiple webpack/Gun pairs, mixed ::1 vs 127.0.0.1 origins can split Gun peers.
 */
export function webBaseURL(idx: number = parallelSlot()): string {
  return `http://127.0.0.1:${webPort(idx)}`;
}

/**
 * Initial app URL for most e2e browsers. The webpack client bundle does not receive
 * `CHATROOM_MAX_CAPACITY` / `E2E_GUN_MEMORY_ONLY`, so CONFIG would default to capacity 3
 * + FIFO on — out of sync with playwright.config servers (50 + FIFO off). URL params
 * override CONFIG in the browser (see `src/shared/config.ts` and `03-capacity-eviction.spec.ts`).
 */
/** True when Playwright spawned servers with mesh talk delivery (no server inbox authority). */
export function isDirectTalkDeliveryE2e(): boolean {
  return process.env.P0_DIRECT_TALK_DELIVERY === '1';
}

export function webAppURLStableChatroom(idx: number = parallelSlot()): string {
  const params = new URLSearchParams({ e2e_capacity: '50', e2e_fifo: 'false' });
  if (isDirectTalkDeliveryE2e()) {
    params.set('e2e_p0_talks', '1');
  }
  return `${webBaseURL(idx)}/?${params.toString()}`;
}

/** Base URL for the Gun HTTP/WS endpoint this worker's browsers should talk to. */
export function gunBaseURL(idx: number = parallelSlot()): string {
  return `http://127.0.0.1:${gunPort(idx)}`;
}

/** Isolated Playwright storage state dir (`test-storage/w{N}/`) so parallel workers never clobber JSON. */
export function e2eTestStorageDir(): string {
  return path.join(__dirname, '../../../test-storage', `w${parallelSlot()}`);
}

/** Isolated screenshot dir under `test-screenshots/w{N}/…`. */
export function e2eTestScreenshotsDir(...segments: string[]): string {
  return path.join(__dirname, '../../../test-screenshots', `w${parallelSlot()}`, ...segments);
}
