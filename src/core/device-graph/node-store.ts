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

export function gunNodeStore(gun: any, options: { putTimeoutMs?: number; remembersReads?: boolean } & GunReadOptions = {}): NodeStore {
  const read = gunNodeReader(gun, options);
  /**
   * Souls this store read in full (true) or found missing (false). Gun's graph then holds the node
   * and every later write to it (Gun merges each put into its graph, whichever store made it), so
   * the next read is answered from the graph, without Gun's read wait (OPEN-114: reads were most of
   * a Talk exchange's time, ~20 ms each). Only for souls this device alone writes (`local/`);
   * another person's souls arrive over a link and are always read.
   */
  const known = options.remembersReads === false ? undefined : new Map<string, boolean>();
  const strip = (data: any): GraphNode | null => {
    if (!data || typeof data !== 'object') return null;
    const { _: _meta, ...rest } = data;
    return rest as GraphNode;
  };
  return {
    get: async (soul) => {
      const seen = known?.get(soul);
      if (seen !== undefined) {
        const cached = gun._?.graph?.[soul];
        if (cached) return strip({ ...cached });
        if (seen === false) return null;
        // Found before but gone from the graph: read it again.
      }
      const data = await read(soul);
      // Shared graph souls (`g/…`) are written by others' links too: those are always read.
      if (known && !soul.startsWith('g/')) {
        if (known.size >= KNOWN_SOULS_MAX) known.clear();
        known.set(soul, !!data && typeof data === 'object');
      }
      return strip(data);
    },
    put: (soul, value) => new Promise((resolve, reject) => {
      // A timeout leaves the write uncertain; the caller must not treat it as stored.
      const timer = setTimeout(() => reject(new Error(`storage did not acknowledge write for ${soul}`)), options.putTimeoutMs ?? 8000);
      gun.get(soul).put(value, (ack: any) => {
        clearTimeout(timer);
        if (ack?.err) reject(new Error(String(ack.err)));
        else resolve();
      });
    }),
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
