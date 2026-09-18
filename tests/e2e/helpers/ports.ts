/**
 * Per-worker port derivation for parallel Playwright runs.
 *
 * Background: the full e2e suite must not rely on one shared server inbox.
 * Every worker gets its own bootstrap/signaling server and webpack dev server,
 * then browsers exchange talks through the pair-direct mesh for that worker.
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

/**
 * Optional port-range offset so multiple `playwright test` processes can run CONCURRENTLY
 * without colliding on ports. Each concurrent phase sets a distinct E2E_PORT_OFFSET (e.g. 0,
 * 100, 200) and thereby gets its own web/gun port band: web = 3001+offset+slot, gun =
 * 8080+offset+slot. The browser derives its Gun hub from window.location.port
 * (gun = web - 3001 + 8080), so the same offset is preserved automatically — see
 * web-gun-service.deriveGunHubUrl. Default 0 keeps single-run behaviour unchanged.
 */
function portOffset(): number {
  const n = Number(process.env.E2E_PORT_OFFSET);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/** Stable 0..workers−1 slot for ports and filesystem artifacts (maps to spawned servers). */
export function parallelSlot(): number {
  if (parallelSlotOverride != null) return parallelSlotOverride;
  const raw = process.env.TEST_PARALLEL_INDEX;
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * WHATWG Fetch spec's blocked-ports list (https://fetch.spec.whatwg.org/#block-bad-port),
 * copied verbatim from Node's bundled undici (node_modules/undici/lib/web/fetch/constants.js —
 * re-check that file if this ever needs updating). Node's global `fetch()` throws "TypeError:
 * fetch failed" -> "Error: bad port" for any of these, unconditionally, regardless of whether a
 * real server is listening — a raw `http`/`net` client (e.g. Playwright's own webServer
 * readiness probe) is NOT subject to this, so a webServer can look perfectly healthy while every
 * `fetch()`-based health check in the test itself fails forever. Found the hard way: offset
 * arithmetic (TEST_ALL_PORT_OFFSET=1500 + cross-browser's own +500) landed exactly on 10080,
 * costing ~18 minutes of dead 90s-timeout retries per run until this was traced down.
 */
const FETCH_FORBIDDEN_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
  103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
  512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
  995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668,
  6669, 6679, 6697, 10080,
]);

/**
 * Fails immediately and loudly if `port` is on fetch()'s forbidden-ports list, instead of
 * letting it silently manifest later as every `fetch()`-based health check timing out. Call this
 * wherever a gun/web port is actually about to be used to start a server (playwright.config.ts's
 * webServer array; any ad-hoc script that derives its own offset).
 */
export function assertNotFetchForbiddenPort(port: number, label: string): void {
  if (FETCH_FORBIDDEN_PORTS.has(port)) {
    throw new Error(
      `${label}: computed port ${port} is on fetch()'s WHATWG-forbidden-ports list — every ` +
        `fetch()-based health check (e.g. waitForGunApiReady) will fail forever on this port, ` +
        `even though a raw http/net client (Playwright's own webServer probe) sees it as ` +
        `healthy. Change the offset that produced this port, it will never work as-is.`,
    );
  }
}

/** Web dev/static-server port for this worker (3001 + offset + index). */
export function webPort(idx: number = parallelSlot()): number {
  const port = 3001 + portOffset() + idx;
  assertNotFetchForbiddenPort(port, 'webPort');
  return port;
}

/** Gun/API server port for this worker (8080 + offset + index). */
export function gunPort(idx: number = parallelSlot()): number {
  const port = 8080 + portOffset() + idx;
  assertNotFetchForbiddenPort(port, 'gunPort');
  return port;
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
/** True when Playwright spawned servers with local mesh talk delivery (no server inbox authority). */
export function isDirectTalkDeliveryE2e(): boolean {
  return isMeshTalkDeliveryE2e();
}

/** Mesh talk delivery is always active — star delivery removed. */
export function isMeshTalkDeliveryE2e(): boolean {
  return true;
}

export function webAppURLStableChatroom(idx: number = parallelSlot()): string {
  const params = new URLSearchParams({ e2e_capacity: '50', e2e_fifo: 'false' });
  if (isDirectTalkDeliveryE2e()) {
    params.set('e2e_p0_talks', '1');
  }
  if (isMeshTalkDeliveryE2e()) {
    params.set('e2e_mesh_talks', '1');
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
