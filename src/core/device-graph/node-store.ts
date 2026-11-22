/**
 * Node store for the device graph (spec §31): exact-soul reads and writes of flat nodes whose values
 * are scalars or links (`{ '#': soul }`), the shape Gun stores natively.
 *
 * Unlike `GraphStore.put`, a write never links its soul into parent nodes: `local/q/<key>` must
 * not add an entry to a `local/q` node, which would then hold every question on the device and
 * grow past one Radisk file (1 MB), where Gun answers in parts (OPEN-106 benchmark, 2026-11-02).
 * Lists that must be enumerable are written as bucketed index nodes instead (`index-buckets.ts`).
 */
import { gunNodeReader, type GunReadOptions } from '../graph-store';

export type GraphLink = { '#': string };
export type NodeValue = string | number | boolean | null | GraphLink;
export type GraphNode = Record<string, NodeValue>;

export interface NodeStore {
  /** The node, without Gun's metadata; null when it does not exist. */
  get(soul: string): Promise<GraphNode | null>;
  /** Merge these fields into the node (Gun semantics: a null field is deleted). */
  put(soul: string, value: GraphNode): Promise<void>;
}

export const link = (soul: string): GraphLink => ({ '#': soul });

export function isLink(value: unknown): value is GraphLink {
  return !!value && typeof value === 'object' && typeof (value as GraphLink)['#'] === 'string';
}

export function linkSoul(value: unknown): string | undefined {
  return isLink(value) ? value['#'] : undefined;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** How many souls a store remembers as fully read (beyond it, it starts over: only a speed-up). */
export const KNOWN_SOULS_MAX = 100_000;
/** Device graph souls keyed by a hash of their content (spec §31.4): they never change. Events are
 * not among them (sidecars such as `ev/<id>/x` change; e2e stage4/05 read a stale one). */
const UNCHANGING_SOUL = /^[^/]+\/(q|a|s|rev)\//;

/** How many nodes the RAM cache keeps (oldest used leave first). */
export const RAM_CACHE_MAX = 20_000;

const sameValue = (a: unknown, b: unknown): boolean =>
  a === b || (isLink(a) && isLink(b) && a['#'] === b['#']);

/**
 * A RAM copy of the device graph's nodes in front of Gun's disk (`cacheInRam`). Reads of a cached
 * node, or of one known to be absent, need no disk read or Gun read wait; writes update the copy
 * and go to Gun as before (Radisk batches them to disk). A write by anything else (the page, a
 * test editing records, a peer) evicts the copy: Gun's `put` event, fired for every field written
 * from any source, is compared with it. Unlike the old `remembersReads` it keeps its own copies,
 * never Gun's graph objects (which Gun changes and `.off()` deletes, OPEN-114).
 *
 * Five-phone starter tags (2026-11-21): ~6000 of 8450 storage operations in 3 minutes on a C10
 * were re-reads of the same few nodes (my Talks' indexes), keeping its node at 100 % CPU.
 */
function createRamCache(gun: any, max: number) {
  /** soul → the node as stored, or null when known to be absent. */
  const nodes = new Map<string, GraphNode | null>();
  const touch = (soul: string, node: GraphNode | null) => {
    nodes.delete(soul);
    nodes.set(soul, node);
    if (nodes.size > max) nodes.delete(nodes.keys().next().value as string);
  };
  /** Reads in flight: a write meanwhile (anyone's) means what they return may be old, so it is not kept. */
  const reading = new Map<string, { count: number; written: boolean }>();
  const written = (soul: string) => { const r = reading.get(soul); if (r) r.written = true; };
  /** Fields this store wrote that Gun has not reported yet: their `put` events are ours. */
  const own = new Map<string, Map<string, unknown>>();
  const isOwn = (soul: string, field: string, value: unknown): boolean => {
    const fields = own.get(soul);
    if (!fields || !fields.has(field) || !sameValue(fields.get(field), value)) return false;
    fields.delete(field);
    if (!fields.size) own.delete(soul);
    return true;
  };
  gun._?.on?.('put', function (this: any, msg: any) {
    // An answer to a read (`@` names the request: a load from disk or a peer's reply) changes
    // nothing; only writes, local or a peer's, are checked against the copy.
    if (msg?.['@']) { this.to.next(msg); return; }
    const put = msg?.put;
    const soul = put?.['#'];
    if (typeof soul === 'string' && isOwn(soul, put['.'], put[':'])) { this.to.next(msg); return; }
    if (typeof soul === 'string') written(soul);
    if (typeof soul === 'string' && nodes.has(soul)) {
      const node = nodes.get(soul);
      // Ours (the copy already holds it) or someone else's: then the copy is not trusted.
      if (!node || !(put['.'] in node) || !sameValue(node[put['.']], put[':'])) nodes.delete(soul);
    }
    this.to.next(msg);
  });
  return {
    has: (soul: string) => nodes.has(soul),
    get: (soul: string): GraphNode | null => {
      const node = nodes.get(soul) ?? null;
      if (nodes.has(soul)) touch(soul, node);
      return node ? { ...node } : null;
    },
    /** Around a disk read: what it returns is kept only if nothing wrote the node meanwhile. */
    async read(soul: string, load: () => Promise<GraphNode | null>): Promise<GraphNode | null> {
      const r = reading.get(soul) ?? { count: 0, written: false };
      if (!r.count) r.written = false;
      r.count += 1;
      reading.set(soul, r);
      try {
        const node = await load();
        if (!r.written) touch(soul, node ? { ...node } : null);
        return node;
      } finally {
        r.count -= 1;
        if (!r.count) reading.delete(soul);
      }
    },
    /** A write through this store: merged into the copy before Gun sees it. */
    write: (soul: string, value: GraphNode) => {
      let fields = own.get(soul);
      // Bounded: a write Gun never reports (same value, same state) must not stay forever.
      if (!fields && own.size >= max) own.delete(own.keys().next().value as string);
      if (!fields) own.set(soul, fields = new Map());
      for (const [field, v] of Object.entries(value)) fields.set(field, v);
      const r = reading.get(soul);
      // A read in flight may have started before this write: what it returns is not kept.
      if (r) r.written = true;
      if (!nodes.has(soul)) return; // unknown fields: read in full next time
      touch(soul, { ...(nodes.get(soul) ?? {}), ...value });
    },
    forget: (soul: string) => { nodes.delete(soul); },
  };
}

export function gunNodeStore(gun: any, options: { putTimeoutMs?: number; remembersReads?: boolean; cacheInRam?: boolean } & GunReadOptions = {}): NodeStore {
  const read = gunNodeReader(gun, options);
  const ram = options.cacheInRam === true ? createRamCache(gun, RAM_CACHE_MAX) : undefined;
  /**
   * Nodes this store read in full, for souls whose content never changes once written (content-
   * addressed questions, answers and structures): Gun's graph holds them, so the next
   * read is answered from it without Gun's read wait (OPEN-114: reads were most of a Talk exchange's
   * time, ~20 ms each). Mutable records (indexes, collections, conversations) and misses are always
   * read: something else may write them (e2e stage1/04 read a stale conversation record).
   */
  // Off unless asked for: e2e stage4/05 and stage1/04 read stale records with it on (OPEN-114).
  const known = options.remembersReads === true ? new Set<string>() : undefined;
  const strip = (data: any): GraphNode | null => {
    if (!data || typeof data !== 'object') return null;
    const { _: _meta, ...rest } = data;
    return rest as GraphNode;
  };
  return {
    get: async (soul) => {
      if (ram?.has(soul)) return ram.get(soul);
      if (known?.has(soul)) {
        const cached = gun._?.graph?.[soul];
        if (cached) return strip({ ...cached });
        known.delete(soul); // gone from the graph: read it again
      }
      if (ram) return ram.read(soul, async () => strip(await read(soul)));
      const data = await read(soul);
      if (known && data && typeof data === 'object' && UNCHANGING_SOUL.test(soul)) {
        if (known.size >= KNOWN_SOULS_MAX) known.clear();
        known.add(soul);
      }
      return strip(data);
    },
    put: (soul, value) => {
      if (ram) {
        // Write-behind: the write is done once it is in RAM (this copy and Gun's graph); Radisk puts
        // it on disk with the others in its next flush. A write the disk refuses is logged and its
        // copy dropped, so the next read goes to Gun.
        ram.write(soul, value);
        gun.get(soul).put(value, (ack: any) => {
          if (!ack?.err) return;
          ram.forget(soul);
          console.warn(`[node-store] disk refused ${soul}: ${String(ack.err)}`);
        });
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        // A timeout leaves the write uncertain; the caller must not treat it as stored.
        const timer = setTimeout(() => reject(new Error(`storage did not acknowledge write for ${soul}`)), options.putTimeoutMs ?? 8000);
        gun.get(soul).put(value, (ack: any) => {
          clearTimeout(timer);
          if (ack?.err) reject(new Error(String(ack.err)));
          else resolve();
        });
      });
    },
  };
}

/** An in-memory node store with Gun's merge and null-is-deleted semantics, for tests. */
export function memoryNodeStore(): NodeStore & { souls(): string[]; writes: number } {
  const nodes = new Map<string, GraphNode>();
  const store = {
    writes: 0,
    souls: () => [...nodes.keys()],
    get: async (soul: string) => {
      const node = nodes.get(soul);
      return node ? JSON.parse(JSON.stringify(node)) as GraphNode : null;
    },
    put: async (soul: string, value: GraphNode) => {
      store.writes += 1;
      nodes.set(soul, { ...(nodes.get(soul) ?? {}), ...JSON.parse(JSON.stringify(value)) as GraphNode });
    },
  };
  return store;
}
