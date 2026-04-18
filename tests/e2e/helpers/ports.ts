/**
 * Per-worker port derivation for parallel Playwright runs.
 *
 * Background: the full e2e suite shares one Gun graph; running multiple workers against the
 * same server produces cross-test collisions (ghost chatroom members, duplicate talks, etc.).
 * Option B makes every worker spawn its own Gun server + webpack dev server on an offset port
 * and have every client connect only to its worker's server.
 *
 * Convention:
 *   worker 0 → web 3001 / gun 8080  (legacy default; unchanged single-worker behaviour)
 *   worker 1 → web 3002 / gun 8081
 *   worker N → web 3001+N / gun 8080+N
 *
 * `TEST_WORKER_INDEX` is set by Playwright inside each worker process. Outside a worker
 * (e.g. at config load) it is undefined; we fall back to 0 so nothing breaks.
 */

/** 0-based worker index; 0 when called outside a Playwright worker process. */
export function workerIndex(): number {
  const raw = process.env.TEST_WORKER_INDEX;
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Webpack dev-server port for this worker (3001 + index). */
export function webPort(idx: number = workerIndex()): number {
  return 3001 + idx;
}

/** Gun/API server port for this worker (8080 + index). */
export function gunPort(idx: number = workerIndex()): number {
  return 8080 + idx;
}

/** Base URL for the webpack dev server serving the bundle to this worker's browsers. */
export function webBaseURL(idx: number = workerIndex()): string {
  return `http://localhost:${webPort(idx)}`;
}

/** Base URL for the Gun HTTP/WS endpoint this worker's browsers should talk to. */
export function gunBaseURL(idx: number = workerIndex()): string {
  return `http://localhost:${gunPort(idx)}`;
}
