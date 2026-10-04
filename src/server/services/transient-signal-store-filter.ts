/**
 * Keep WebRTC signaling frames (`p2p-signal/...`) out of an embedded node's Radisk and bounded in RAM.
 *
 * Embedded nodes persist their Gun graph on-device (`radisk: true`), and every Gun peer write —
 * the node's own page, and in OPEN-36 offline mode other phones' pages connected straight to this
 * node — went to disk unfiltered: `GunService`'s persistence filter only covers the server's own API
 * writes. Signaling frames piled up (~1 MB Radisk chunks per phone pair); every session re-subscribe
 * re-hydrated a pair's whole history into V8, and phones crashed with V8 out-of-memory
 * (`node::OOMErrorHandler`, P30/PH-1/C10/Honor, 2026-10-04). The boot-time quarantine in
 * embedded-node.ts only cleaned up after the fact.
 *
 * Two parts:
 * - Gun's store (gun/lib/store.js) passes each put down the handler chain first and then skips it
 *   if `msg._.rad` is set ("came from a read"). Flagging signaling puts there keeps them out of
 *   Radisk while they still merge into memory and relay to peers exactly as before.
 * - A periodic sweep drops signaling nodes from the in-memory graph once nobody has written to
 *   them for a while; frames are single-use and the sessions that need them are long done.
 */

export const TRANSIENT_SIGNAL_SOUL_PREFIX = 'p2p-signal';
const SWEEP_INTERVAL_MS = 60_000;
const IDLE_EVICT_MS = 5 * 60_000;

export function isTransientSignalSoul(soul: unknown): boolean {
  if (typeof soul !== 'string') return false;
  // `undefinedp2p-signal` is the same data written by an old path-prefix bug.
  const bare = soul.startsWith('undefined') ? soul.slice('undefined'.length) : soul;
  return bare === TRANSIENT_SIGNAL_SOUL_PREFIX || bare.startsWith(`${TRANSIENT_SIGNAL_SOUL_PREFIX}/`);
}

type GunLike = { on: (event: string, handler: (this: { to: { next: (value: unknown) => void } }, value: any) => void) => void };

let installed = false;

/** Must run before the Gun instance is created (it hooks every new root). Idempotent. */
export function installTransientSignalStoreFilter(Gun: GunLike, options: { sweepIntervalMs?: number; idleEvictMs?: number } = {}): void {
  if (installed) return;
  installed = true;
  Gun.on('create', function (this: { to: { next: (value: unknown) => void } }, root: any) {
    this.to.next(root);
    root.on('put', function (this: { to: { next: (value: unknown) => void } }, msg: any) {
      const soul = msg?.put?.['#'];
      if (isTransientSignalSoul(soul)) {
        msg._ = msg._ || {};
        msg._.rad = 1;
      }
      this.to.next(msg);
    });
    const timer = setInterval(() => sweepTransientSignalGraph(root, Date.now(), options.idleEvictMs ?? IDLE_EVICT_MS), options.sweepIntervalMs ?? SWEEP_INTERVAL_MS);
    (timer as { unref?: () => void }).unref?.();
  });
}

/** Drop signaling nodes whose newest field is older than `idleMs`. Returns how many were evicted. */
export function sweepTransientSignalGraph(root: any, now: number, idleMs: number): number {
  const graph = root?.graph;
  if (!graph || typeof graph !== 'object') return 0;
  let evicted = 0;
  for (const soul of Object.keys(graph)) {
    if (!isTransientSignalSoul(soul)) continue;
    const states = graph[soul]?._?.['>'] as Record<string, number> | undefined;
    const newest = states ? Math.max(0, ...Object.values(states).filter((value) => typeof value === 'number')) : 0;
    if (now - newest < idleMs) continue;
    delete graph[soul];
    evicted += 1;
  }
  return evicted;
}

/** Test hook: allow a fresh install in a new test file's module registry. */
export function resetTransientSignalStoreFilterForTests(): void {
  installed = false;
}
