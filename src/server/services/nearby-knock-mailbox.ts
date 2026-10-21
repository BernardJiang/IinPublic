import { NEARBY_KNOCK_LIFETIME_MS, nearbyKnockChannel, verifyNearbyKnock, type NearbyKnock } from '../../shared/nearby-v3-knock';

/**
 * The hub's knock mailbox (§3.7 "Knocks"). A phone's embedded node reaches the hub over HTTP only,
 * so a knock written to Gun's `p2p-signal` never leaves the knocker's phone. Knocks for one key wait
 * here, for at most a knock's lifetime, until its holder reads them with a long poll. Kept in memory
 * only; a knock carries a signed card and nothing else.
 */
export const NEARBY_KNOCK_MAILBOX_PER_CHANNEL = 32;
const MAX_CHANNELS = 100_000;
export const NEARBY_KNOCK_MAX_WAIT_MS = 25_000;

type Stored = { seq: number; atMs: number; knock: NearbyKnock };

export class NearbyKnockMailbox {
  private seq = 0;
  private readonly channels = new Map<string, Stored[]>();
  private readonly waiters = new Map<string, Set<() => void>>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Verify and keep a knock for its recipient. Throws when it does not verify. */
  async post(value: unknown): Promise<void> {
    const toPub = typeof (value as { toPub?: unknown } | null)?.toPub === 'string' ? (value as { toPub: string }).toPub : '';
    const verification = await verifyNearbyKnock(value, { localPub: toPub, now: new Date(this.now()) });
    if (!verification.ok) throw new Error(verification.reason);
    const channel = nearbyKnockChannel(toPub);
    const nowMs = this.now();
    const kept = this.live(channel, nowMs);
    kept.push({ seq: ++this.seq, atMs: nowMs, knock: verification.knock });
    while (kept.length > NEARBY_KNOCK_MAILBOX_PER_CHANNEL) kept.shift();
    this.channels.delete(channel);
    this.channels.set(channel, kept);
    while (this.channels.size > MAX_CHANNELS) this.channels.delete(this.channels.keys().next().value as string);
    for (const wake of this.waiters.get(channel) ?? []) wake();
  }

  /**
   * Knocks for `channel` after `cursor`; waits up to `waitMs` for one when there are none. The
   * cursor in the answer is where the next read starts.
   */
  async read(channel: string, cursor: number, waitMs: number): Promise<{ knocks: NearbyKnock[]; cursor: number }> {
    // A cursor from before a hub restart is ahead of the new count: read from the start.
    if (cursor > this.seq) cursor = 0;
    const ready = () => this.live(channel, this.now()).filter((entry) => entry.seq > cursor);
    let found = ready();
    if (!found.length && waitMs > 0) {
      await new Promise<void>((resolve) => {
        const waiters = this.waiters.get(channel) ?? new Set<() => void>();
        const done = () => {
          clearTimeout(timer);
          waiters.delete(done);
          if (!waiters.size) this.waiters.delete(channel);
          resolve();
        };
        const timer = setTimeout(done, Math.min(waitMs, NEARBY_KNOCK_MAX_WAIT_MS));
        waiters.add(done);
        this.waiters.set(channel, waiters);
      });
      found = ready();
    }
    return {
      knocks: found.map((entry) => entry.knock),
      cursor: found.length ? found[found.length - 1]!.seq : Math.max(cursor, 0),
    };
  }

  clear(): void {
    this.channels.clear();
  }

  private live(channel: string, nowMs: number): Stored[] {
    const kept = (this.channels.get(channel) ?? []).filter((entry) => nowMs - entry.atMs < NEARBY_KNOCK_LIFETIME_MS);
    if (kept.length) this.channels.set(channel, kept);
    else this.channels.delete(channel);
    return kept;
  }
}
