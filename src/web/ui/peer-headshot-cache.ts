/**
 * Session cache of peers' profile photos, shared by the Contacts tab and the chatroom roster.
 *
 * A photo is a full base64 payload, so it is cached — but with a short TTL rather than for the whole
 * session: a peer who sets or changes their photo mid-session must show up for everyone else without a
 * reload. While a refresh is pending (or fails) the cached value keeps rendering, and a failed refresh
 * never downgrades a good photo to "none".
 */
export const PEER_HEADSHOT_TTL_MS = 45_000;

export type PeerHeadshotReader = (peerId: string) => Promise<{ headshot?: string | null } | null | undefined>;

export class PeerHeadshotCache {
  private values = new Map<string, string | null>();
  private fetchedAt = new Map<string, number>();
  private inFlight = new Map<string, Promise<string | null>>();

  constructor(
    private readonly ttlMs = PEER_HEADSHOT_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Synchronous read for rendering; never fetches. */
  get(peerId: string): string | null {
    return this.values.get(peerId) ?? null;
  }

  /** Cached value if still fresh, otherwise re-read through `reader` (deduplicating concurrent calls). */
  async resolve(peerId: string, reader: PeerHeadshotReader | null | undefined): Promise<string | null> {
    const cached = this.values.has(peerId) ? (this.values.get(peerId) ?? null) : undefined;
    const age = this.now() - (this.fetchedAt.get(peerId) ?? 0);
    if (cached !== undefined && age < this.ttlMs) return cached;
    if (!reader) return cached ?? null;
    const pending = this.inFlight.get(peerId);
    if (pending) return pending;

    const task = (async () => {
      try {
        const foundation = await reader(peerId);
        const headshot = foundation?.headshot ?? null;
        this.values.set(peerId, headshot);
        this.fetchedAt.set(peerId, this.now());
        return headshot;
      } catch {
        if (cached === undefined) this.values.set(peerId, null);
        this.fetchedAt.set(peerId, this.now());
        return cached ?? null;
      } finally {
        this.inFlight.delete(peerId);
      }
    })();
    this.inFlight.set(peerId, task);
    return task;
  }
}
