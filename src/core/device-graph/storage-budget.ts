/**
 * The device graph's storage limit: 1 GB (owner decision 2026-11-03). Trimming old data is later
 * work; until it exists the limit is enforced by refusing what other people send once the store is
 * full. My own writes (my Talks, my answers, deletions) are never refused, so the app keeps working.
 *
 * How much is used comes from the host: the Radisk folder's size on a phone's Node, and
 * `navigator.storage.estimate()` in a browser. Reading it costs a directory walk, so it is cached.
 */

export const DEVICE_GRAPH_LIMIT_BYTES = 1_000_000_000;
/** From here on the app warns that the store is nearly full. */
export const DEVICE_GRAPH_NEAR_FRACTION = 0.9;

export type StorageLevel = 'ok' | 'near' | 'full' | 'unknown';
export type StorageStatus = { usedBytes?: number; limitBytes: number; level: StorageLevel };

export function storageLevel(usedBytes: number | undefined, limitBytes = DEVICE_GRAPH_LIMIT_BYTES): StorageLevel {
  if (typeof usedBytes !== 'number' || !Number.isFinite(usedBytes) || usedBytes < 0) return 'unknown';
  if (usedBytes >= limitBytes) return 'full';
  return usedBytes >= limitBytes * DEVICE_GRAPH_NEAR_FRACTION ? 'near' : 'ok';
}

export type StorageBudget = {
  status(): Promise<StorageStatus>;
  /** Whether content from other people may still be stored. */
  acceptsIncoming(): Promise<boolean>;
};

export function createStorageBudget(options: {
  usage: () => Promise<number | undefined>;
  limitBytes?: number;
  /** How long one reading of the usage is trusted. */
  cacheMs?: number;
  now?: () => number;
}): StorageBudget {
  const limitBytes = options.limitBytes ?? DEVICE_GRAPH_LIMIT_BYTES;
  const cacheMs = options.cacheMs ?? 60_000;
  const now = options.now ?? Date.now;
  let cached: { at: number; used: number | undefined } | undefined;
  let reading: Promise<number | undefined> | undefined;
  const used = async (): Promise<number | undefined> => {
    if (cached && now() - cached.at < cacheMs) return cached.used;
    reading ||= options.usage().catch(() => undefined).then((value) => {
      cached = { at: now(), used: value };
      reading = undefined;
      return value;
    });
    return reading;
  };
  return {
    async status() {
      const usedBytes = await used();
      const status: StorageStatus = { limitBytes, level: storageLevel(usedBytes, limitBytes) };
      if (typeof usedBytes === 'number') status.usedBytes = usedBytes;
      return status;
    },
    // An unknown size never blocks: a host that cannot measure keeps working.
    async acceptsIncoming() { return storageLevel(await used(), limitBytes) !== 'full'; },
  };
}
