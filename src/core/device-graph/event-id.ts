/**
 * Event ids (spec §31.5, REQ-GRAPH-23): `<when, 13 digits>-<deviceId, 32 hex>-<counter, base36>`.
 * The device id is 128 random bits made once per install; the counter rises per install and is
 * persisted, so two events in one millisecond on one install still differ. No hash is involved, so
 * ids cannot collide (D16). Sorting ids sorts one device's events by time.
 */

const EVENT_ID = /^(\d{13})-([0-9a-f]{32})-([0-9a-z]+)$/;

export type EventIdParts = { when: number; deviceId: string; counter: number };

export function newDeviceId(randomBytes: (length: number) => Uint8Array): string {
  return Array.from(randomBytes(16), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function formatEventId(parts: EventIdParts): string {
  if (!/^[0-9a-f]{32}$/.test(parts.deviceId)) throw new Error('device id must be 32 hex characters');
  if (!Number.isSafeInteger(parts.when) || parts.when < 0 || parts.when > 9_999_999_999_999) throw new Error('event time out of range');
  if (!Number.isSafeInteger(parts.counter) || parts.counter < 0) throw new Error('event counter must be a non-negative integer');
  return `${String(parts.when).padStart(13, '0')}-${parts.deviceId}-${parts.counter.toString(36)}`;
}

export function parseEventId(id: string): EventIdParts | undefined {
  const match = EVENT_ID.exec(String(id || ''));
  if (!match) return undefined;
  return { when: Number(match[1]), deviceId: match[2]!, counter: parseInt(match[3]!, 36) };
}

/** Where the install's device id and counter are kept (settings, in the app). */
export type EventIdState = {
  load(): Promise<{ deviceId?: string | undefined; counter?: number | undefined }>;
  save(state: { deviceId: string; counter: number }): Promise<void>;
};

/**
 * Hands out event ids. The counter is reserved in blocks and persisted before any id of a block is
 * used, so a crash can skip numbers but never reuse one.
 */
export function createEventIdSource(options: {
  state: EventIdState;
  now?: () => number;
  randomBytes: (length: number) => Uint8Array;
  block?: number;
}) {
  const now = options.now ?? Date.now;
  const block = Math.max(1, options.block ?? 64);
  let deviceId: string | undefined;
  let next = 0;
  let reservedUntil = 0;
  let pending: Promise<void> = Promise.resolve();

  const reserve = async () => {
    if (!deviceId) {
      const saved = await options.state.load();
      deviceId = saved.deviceId && /^[0-9a-f]{32}$/.test(saved.deviceId) ? saved.deviceId : newDeviceId(options.randomBytes);
      next = Math.max(0, Math.floor(Number(saved.counter) || 0));
      reservedUntil = next;
    }
    if (next >= reservedUntil) {
      reservedUntil = next + block;
      await options.state.save({ deviceId, counter: reservedUntil });
    }
  };

  return {
    /** The next id, for an event happening now (or at `when`). Calls are serialized. */
    next(when?: number): Promise<string> {
      const result = pending.then(async () => {
        await reserve();
        const id = formatEventId({ when: Math.floor(when ?? now()), deviceId: deviceId!, counter: next });
        next += 1;
        return id;
      });
      pending = result.then(() => undefined, () => undefined);
      return result;
    },
    async deviceId(): Promise<string> {
      await pending;
      await reserve();
      return deviceId!;
    },
  };
}
