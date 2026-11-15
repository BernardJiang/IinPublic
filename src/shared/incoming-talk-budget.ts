/**
 * Nearby v3's receiving limit (§3.7 "Balance"): people at the centre of a crowd are on far more
 * lists than C, so a phone lets in at most `perMinute` new people a minute who are not its contacts
 * (OPEN-114: people, not Talks — each one's batch counts once). An offer over the limit is not refused: it goes unanswered, and the sender's outbox
 * offers it again on its own schedule. Measured 2026-10-20 (native-app/39): a phone needs ~2.2–3 s
 * to accept one Talk, so about 20–25 a minute is what it can take.
 */
/** One person's Talks within a minute after they were let in, at most this many times the limit. */
export const PER_SENDER_FACTOR = 10;

export class IncomingTalkBudget {
  private readonly admitted: number[] = [];
  /** People let in during the last minute: when, and how many of their Talks since. */
  private readonly senders = new Map<string, { at: number; count: number }>();

  constructor(private readonly perMinute: () => number) {}

  /** True (and counted) when one more new Talk fits in the last minute's budget. */
  tryAdmit(nowMs: number): boolean {
    while (this.admitted.length && nowMs - this.admitted[0]! >= 60_000) this.admitted.shift();
    if (this.admitted.length >= Math.max(1, Math.floor(this.perMinute()))) return false;
    this.admitted.push(nowMs);
    return true;
  }

  /**
   * One Talk from this person (OPEN-114). The limit counts people, not Talks: two people meeting
   * send each other everything in one go, so a newcomer's whole batch takes one place in the
   * minute's budget. Their further Talks within that minute pass, up to `PER_SENDER_FACTOR` times
   * the limit, so one person cannot flood a phone either.
   */
  tryAdmitFrom(senderId: string, nowMs: number): boolean {
    for (const [id, seen] of this.senders) if (nowMs - seen.at >= 60_000) this.senders.delete(id);
    const seen = this.senders.get(senderId);
    if (seen) {
      if (seen.count >= Math.max(1, Math.floor(this.perMinute())) * PER_SENDER_FACTOR) return false;
      seen.count += 1;
      return true;
    }
    if (!this.tryAdmit(nowMs)) return false;
    this.senders.set(senderId, { at: nowMs, count: 1 });
    return true;
  }
}
