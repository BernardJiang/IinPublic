/**
 * Nearby v3's receiving limit (§3.7 "Balance"): people at the centre of a crowd are on far more
 * lists than C, so a phone admits at most `perMinute` new Talks a minute from people who are not
 * its contacts. An offer over the limit is not refused: it goes unanswered, and the sender's outbox
 * offers it again on its own schedule. Measured 2026-10-20 (native-app/39): a phone needs ~2.2–3 s
 * to accept one Talk, so about 20–25 a minute is what it can take.
 */
export class IncomingTalkBudget {
  private readonly admitted: number[] = [];

  constructor(private readonly perMinute: () => number) {}

  /** True (and counted) when one more new Talk fits in the last minute's budget. */
  tryAdmit(nowMs: number): boolean {
    while (this.admitted.length && nowMs - this.admitted[0]! >= 60_000) this.admitted.shift();
    if (this.admitted.length >= Math.max(1, Math.floor(this.perMinute()))) return false;
    this.admitted.push(nowMs);
    return true;
  }
}
