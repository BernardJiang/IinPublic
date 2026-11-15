/**
 * Bucketed index lists (spec §31.8). An index that grows with the user's history (my Talks, a
 * person's events, a Talk's exchanges) is split into one node per month or per day of the event
 * time, plus a small directory node listing the buckets:
 *
 *   ix/<name>             { "2026-11": →ix/<name>/2026-11, … }      one entry per bucket
 *   ix/<name>/2026-11     { <eventId>: →ev/<eventId>, … }
 *
 * Why: Gun answers a node larger than one Radisk file (1 MB, about 7,000 links) in parts, so a
 * single 10,000-entry list read back with 3,800 entries at first (OPEN-106 benchmark, 2026-11-02).
 * Small buckets also let a screen load only the months it shows, so memory stays bounded.
 */
import { link, linkSoul, type NodeStore } from './node-store';

/** `hour` for the busiest list (every event, `ix/day`), `day` for arrivals, `month` otherwise. */
export type BucketSize = 'month' | 'day' | 'hour';

export function bucketOf(when: number, size: BucketSize): string {
  const iso = new Date(when).toISOString();
  return size === 'hour' ? iso.slice(0, 13) : size === 'day' ? iso.slice(0, 10) : iso.slice(0, 7);
}

/**
 * Folder links (`list → bucket`) this process has written or seen confirmed, per store. A list's
 * folder gets a link only when a new bucket starts (OPEN-114): writing the same link for every
 * entry rewrote an unchanged value 5–7 times per Talk. Lost on restart, when each bucket's link is
 * written once again. Only trimming removes folder links, and it says so (`forgetIndexFolder`); a
 * rebuild of the indexes starts with none remembered (`forgetIndexFolders`).
 */
const foldersWritten = new WeakMap<NodeStore, Set<string>>();
const FOLDERS_REMEMBERED_MAX = 50_000;
const folderKey = (listSoul: string, bucket: string) => `${listSoul}\n${bucket}`;

/** Every folder link may be gone (indexes being rebuilt after a loss): each is written again. */
export function forgetIndexFolders(store: NodeStore): void {
  foldersWritten.delete(store);
}

/** A folder link was removed (trimming): the next entry in that bucket writes it again. */
export function forgetIndexFolder(store: NodeStore, listSoul: string, bucket: string): void {
  foldersWritten.get(store)?.delete(folderKey(listSoul, bucket));
}

/** Add `key → target` to the list, in the bucket of `when`. Repeating it changes nothing. */
export async function addToIndex(
  store: NodeStore,
  listSoul: string,
  entry: { key: string; target: string; when: number },
  size: BucketSize = 'month',
): Promise<void> {
  const bucket = bucketOf(entry.when, size);
  const bucketSoul = `${listSoul}/${bucket}`;
  let written = foldersWritten.get(store);
  if (!written) { written = new Set(); foldersWritten.set(store, written); }
  const key = folderKey(listSoul, bucket);
  if (written.has(key)) { await store.put(bucketSoul, { [entry.key]: link(entry.target) }); return; }
  // Together, so both share one storage flush (Radisk confirms a write after ~250 ms of batching).
  await Promise.all([store.put(bucketSoul, { [entry.key]: link(entry.target) }), store.put(listSoul, { [bucket]: link(bucketSoul) })]);
  // Remembered once confirmed: a write that failed is tried again by the next entry.
  if (written.size >= FOLDERS_REMEMBERED_MAX) written.clear();
  written.add(key);
}

export async function removeFromIndex(store: NodeStore, listSoul: string, entry: { key: string; when: number }, size: BucketSize = 'month'): Promise<void> {
  await store.put(`${listSoul}/${bucketOf(entry.when, size)}`, { [entry.key]: null });
}

/**
 * The list's entries, newest bucket first, optionally only buckets in [from, to] (bucket names
 * compare as strings: "2026-10" < "2026-11"). Removed entries are left out.
 */
export async function readIndex(
  store: NodeStore,
  listSoul: string,
  options: { from?: string; to?: string; limitBuckets?: number } = {},
): Promise<Array<{ key: string; target: string; bucket: string }>> {
  const directory = await store.get(listSoul);
  if (!directory) return [];
  const buckets = Object.keys(directory)
    .filter((bucket) => linkSoul(directory[bucket]) && (!options.from || bucket >= options.from) && (!options.to || bucket <= options.to))
    .sort()
    .reverse()
    .slice(0, options.limitBuckets ?? Infinity);
  const out: Array<{ key: string; target: string; bucket: string }> = [];
  for (const bucket of buckets) {
    const node = await store.get(linkSoul(directory[bucket])!);
    // Keys are event ids, which sort by time: newest first within the bucket too.
    for (const key of Object.keys(node || {}).sort().reverse()) {
      const target = linkSoul(node![key]);
      if (target) out.push({ key, target, bucket });
    }
  }
  return out;
}
