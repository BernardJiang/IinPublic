/**
 * Keyed maps split into buckets (spec §31.8): a map keyed by a person or an atom, not by time (who
 * was sent a Talk, what passed between two people, everyone I exchanged with), spread over
 * `KEY_BUCKETS` nodes by a hash of the key, with a small directory node listing them:
 *
 *   <map>        { "0": →<map>/0, "a": →<map>/a, … }      the buckets that hold entries
 *   <map>/<b>    { <key>: <value>, … }
 *
 * Why: Gun answers a node larger than one Radisk file (1 MB, about 7,000 links) in parts, so a
 * single node must stay well under that (OPEN-106 benchmark, 2026-11-02). Sixteen buckets keep a
 * node under 5,000 entries up to about 80,000 keys; one key is one read. Time-ordered lists use
 * `index-buckets.ts` instead.
 */
import { portableSha256Hex } from '../../shared/portable-sha256';
import { link, linkSoul, type GraphNode, type NodeStore, type NodeValue } from './node-store';

export const KEY_BUCKETS = 16;
export const KEY_BUCKET_DOMAIN = 'iinpublic-key-bucket-v1';

/** The bucket of a key: one hex digit of its SHA-256. */
export function keyBucket(key: string): string {
  return portableSha256Hex(`${KEY_BUCKET_DOMAIN}\n${key}`).slice(0, 1);
}

export const keyedBucketSoul = (mapSoul: string, key: string) => `${mapSoul}/${keyBucket(key)}`;

/** Merge entries into the map (a null value removes its key), and list their buckets. */
export async function putKeyed(store: NodeStore, mapSoul: string, entries: Record<string, NodeValue>): Promise<void> {
  const byBucket = new Map<string, GraphNode>();
  for (const [key, value] of Object.entries(entries)) {
    const bucket = keyBucket(key);
    byBucket.set(bucket, { ...(byBucket.get(bucket) ?? {}), [key]: value });
  }
  if (!byBucket.size) return;
  const directory: GraphNode = Object.fromEntries([...byBucket.keys()].map((bucket) => [bucket, link(`${mapSoul}/${bucket}`)]));
  await Promise.all([
    ...[...byBucket].map(([bucket, node]) => store.put(`${mapSoul}/${bucket}`, node)),
    store.put(mapSoul, directory),
  ]);
}

/** One key's value, or undefined (one read). */
export async function getKeyed(store: NodeStore, mapSoul: string, key: string): Promise<NodeValue | undefined> {
  const value = (await store.get(keyedBucketSoul(mapSoul, key)))?.[key];
  return value === null ? undefined : value;
}

/** These keys' values, reading only their buckets. */
export async function getKeyedMany(store: NodeStore, mapSoul: string, keys: string[]): Promise<Record<string, NodeValue>> {
  const buckets = new Map<string, string[]>();
  for (const key of new Set(keys)) buckets.set(keyBucket(key), [...(buckets.get(keyBucket(key)) ?? []), key]);
  const out: Record<string, NodeValue> = {};
  await Promise.all([...buckets].map(async ([bucket, wanted]) => {
    const node = await store.get(`${mapSoul}/${bucket}`);
    for (const key of wanted) if (node?.[key] !== undefined && node[key] !== null) out[key] = node[key]!;
  }));
  return out;
}

/** The whole map (removed keys left out). */
export async function readKeyed(store: NodeStore, mapSoul: string): Promise<Record<string, NodeValue>> {
  const directory = await store.get(mapSoul);
  const out: Record<string, NodeValue> = {};
  await Promise.all(Object.values(directory ?? {}).map(async (value) => {
    const soul = linkSoul(value);
    const node = soul ? await store.get(soul) : null;
    for (const [key, entry] of Object.entries(node ?? {})) if (entry !== null && entry !== undefined) out[key] = entry;
  }));
  return out;
}
