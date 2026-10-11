/**
 * OPEN-38 wake ping. Direct Talk delivery is authoritative: Talk bodies never go to the server
 * mailbox. A phone whose page is frozen asleep therefore receives nothing, and its native
 * `MailboxWatcher` (which only counts envelope ids) has nothing to notice. When an author's direct
 * outbox holds a Talk for a receiver with no fresh presence, the author posts this content-free
 * encrypted envelope instead: it carries no Talk id, title or body, only "a room peer has
 * something for you". The receiver's watcher raises its "new activity" notification; opening the
 * app reconnects, and the direct scheduler then delivers the body. Draining the ping only deletes it.
 */
export const TALK_WAKE_PAYLOAD_KIND = 'talk-wake-v1' as const;
/** One ping per receiver per window, however many Talks are queued for it. */
export const TALK_WAKE_MIN_INTERVAL_MS = 30 * 60_000;
/** A ping older than this is pointless: the next send posts a fresh one. */
export const TALK_WAKE_TTL_MS = 24 * 60 * 60_000;

export type TalkWakePayload = {
  kind: typeof TALK_WAKE_PAYLOAD_KIND;
  senderId: string;
  at: string;
};

export function buildTalkWakePayload(senderId: string, now: Date = new Date()): TalkWakePayload {
  return { kind: TALK_WAKE_PAYLOAD_KIND, senderId, at: now.toISOString() };
}

/** Stable per sender, receiver and window, so a retried post never stacks duplicate pings. */
export function talkWakeEnvelopeId(senderId: string, recipientId: string, nowMs: number): string {
  const window = Math.floor(nowMs / TALK_WAKE_MIN_INTERVAL_MS);
  return `mbx_wake_${senderId}_${recipientId}_${window}`.slice(0, 200);
}

/** Per-receiver throttle on the sender. */
export class TalkWakeThrottle {
  private readonly lastAt = new Map<string, number>();

  constructor(private readonly maxEntries = 498) {}

  shouldWake(recipientId: string, nowMs: number): boolean {
    const last = this.lastAt.get(recipientId);
    if (last !== undefined && nowMs - last < TALK_WAKE_MIN_INTERVAL_MS) return false;
    this.lastAt.delete(recipientId);
    this.lastAt.set(recipientId, nowMs);
    while (this.lastAt.size > this.maxEntries) {
      const oldest = this.lastAt.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.lastAt.delete(oldest);
    }
    return true;
  }
}
