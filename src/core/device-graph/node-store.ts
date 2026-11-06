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

export function gunNodeStore(gun: any, options: { putTimeoutMs?: number } & GunReadOptions = {}): NodeStore {
  const read = gunNodeReader(gun, options);
  return {
    get: async (soul) => {
      const data = await read(soul);
      if (!data || typeof data !== 'object') return null;
      const { _: _meta, ...rest } = data;
      return rest as GraphNode;
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
