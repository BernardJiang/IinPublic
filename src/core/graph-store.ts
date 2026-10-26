/**
 * The device core's graph store (OPEN-91): the few operations the app logic needs from the
 * device's one Gun instance, behind an interface so the same logic runs over Gun in a Node.js
 * process (radisk on disk) or in a web worker (IndexedDB), and over a plain map in unit tests.
 *
 * Paths are slash-separated (`local/exchanges/<key>`); a value is a flat record (Gun stores no
 * nested arrays, so structured content travels as a JSON string field).
 */
export interface GraphStore {
  put(path: string, value: Record<string, unknown> | null): Promise<void>;
  get(path: string): Promise<Record<string, unknown> | null>;
  /** The keys of a node's children (`local/exchanges` → its record keys), nulled ones excluded. */
  childKeys(path: string): Promise<string[]>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A Gun-backed store. `gun` is a Gun instance (worker or Node). */
export function gunGraphStore(gun: any, options: { putTimeoutMs?: number; getTimeoutMs?: number; readWaitMs?: number } = {}): GraphStore {
  // Writes go through the chain, so each parent links its children (`childKeys` lists them).
  const ref = (path: string): any => path.split('/').filter(Boolean).reduce((node: any, part, i) => (i === 0 ? gun.get(part) : node.get(part)), null);
  // Reads ask for the node's soul directly: a chained node's soul is its path (`local/exchanges`).
  // Walking the chain on a cold start (after a reload) loses the first callback while Gun loads
  // each parent from storage; one direct lookup does not (found by e2e stage1/94).
  const soul = (path: string): string => path.split('/').filter(Boolean).join('/');
  // A node that does not exist answers at once (undefined); no answer at all means storage is slow
  // or busy — an error, so the caller can retry rather than mistake it for "nothing here".
  const once = (path: string): Promise<any> => new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; reject(new Error(`storage did not answer for ${path}`)); } }, options.getTimeoutMs ?? 6000);
    // Gun's `once` reports "not found" after ~99 ms by default; a cold worker reading IndexedDB
    // through radisk can take longer, which made the log look empty after a reload under load
    // (e2e stage1/94). A node that exists still answers as soon as it is loaded; only a missing one
    // waits the whole time (a new device's first start).
    gun.get(soul(path)).once((data: any) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(data ?? null);
    }, { wait: options.readWaitMs ?? 1500 });
  });
  return {
    put: (path, value) => new Promise((resolve, reject) => {
      // A peerless instance acks from its own storage; a missing ack is not a failed write.
      const timer = setTimeout(() => resolve(), options.putTimeoutMs ?? 8000);
      ref(path).put(value, (ack: any) => {
        clearTimeout(timer);
        if (ack?.err) reject(new Error(String(ack.err)));
        else resolve();
      });
    }),
    get: async (path) => {
      const data = await once(path);
      if (!data || typeof data !== 'object') return null;
      const { _: _meta, ...rest } = data;
      return rest;
    },
    childKeys: async (path) => {
      const node = await once(path);
      if (!node || typeof node !== 'object') return [];
      return Object.keys(node).filter((key) => key !== '_' && node[key] !== null);
    },
  };
}

/** An in-memory store with Gun's null-is-deleted semantics, for unit tests and the GUI fallback. */
export function memoryGraphStore(): GraphStore {
  const nodes = new Map<string, Record<string, unknown> | null>();
  const parentOf = (path: string): string => path.split('/').slice(0, -1).join('/');
  return {
    put: async (path, value) => { nodes.set(path, value === null ? null : { ...(nodes.get(path) ?? {}), ...value }); },
    get: async (path) => { const value = nodes.get(path); return value ? { ...value } : null; },
    childKeys: async (path) => [...nodes.entries()]
      .filter(([key, value]) => value !== null && parentOf(key) === path)
      .map(([key]) => key.slice(path.length + 1)),
  };
}
