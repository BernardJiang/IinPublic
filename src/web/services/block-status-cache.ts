/**
 * Remembers the hub's "is either of us blocked" answer per peer for a short time.
 *
 * Every incoming Talk checks it, twice (announcement and body), and on a phone the call goes
 * WebView → embedded node → hub: about 0.9 s each, the largest part of the ~2.4 s a C10 spent
 * accepting one Talk (measured 2026-10-18, native-app/39). The local block list is still checked
 * first by the caller, so blocking someone takes effect at once; a sender who blocked us stops
 * sending from their own app. Failed lookups are not remembered, and the caller drops a peer's
 * entry whenever this user blocks or unblocks them.
 */
export const BLOCK_STATUS_CACHE_MS = 60_000;

export class BlockStatusCache {
  private readonly answers = new Map<string, { blocked: boolean; at: number }>();
  private readonly inFlight = new Map<string, Promise<boolean | null>>();

  constructor(private readonly options: {
    /** The hub lookup: true/false, or null when it failed (not remembered). */
    fetchStatus: (peerId: string) => Promise<boolean | null>;
    ttlMs?: number;
    now?: () => number;
  }) {}

  async isBlocked(peerId: string): Promise<boolean> {
    const now = this.options.now?.() ?? Date.now();
    const cached = this.answers.get(peerId);
    if (cached && now - cached.at < (this.options.ttlMs ?? BLOCK_STATUS_CACHE_MS)) return cached.blocked;
    let lookup = this.inFlight.get(peerId);
    if (!lookup) {
      lookup = this.options.fetchStatus(peerId).catch(() => null);
      this.inFlight.set(peerId, lookup);
    }
    try {
      const blocked = await lookup;
      if (blocked !== null && this.inFlight.get(peerId) === lookup) {
        this.answers.set(peerId, { blocked, at: this.options.now?.() ?? Date.now() });
      }
      return blocked === true;
    } finally {
      if (this.inFlight.get(peerId) === lookup) this.inFlight.delete(peerId);
    }
  }

  invalidate(peerId: string): void {
    this.answers.delete(peerId);
    this.inFlight.delete(peerId);
  }
}
