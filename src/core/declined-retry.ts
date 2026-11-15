/**
 * A Talk turned away at the receiver's limit (`IncomingTalkBudget`, a minute's window) is forgotten
 * as sent, so it is owed to them again, but nothing asks again once my list stops changing (found
 * by the starter-tags spec: a tag or two never arrived). This offers it again once their minute
 * has room: one pending retry per person, spread a little so several senders do not all return
 * at once.
 */
export const DECLINED_RETRY_MS = 60_000;
export const DECLINED_RETRY_SPREAD_MS = 15_000;

export class DeclinedRetry {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly offerAgain: (peerId: string) => void,
    private readonly random: () => number = Math.random,
  ) {}

  /** Someone turned a Talk of mine away: offer what they are owed after their minute. */
  declined(peerId: string): void {
    if (!peerId || this.timers.has(peerId)) return;
    const delay = DECLINED_RETRY_MS + Math.floor(this.random() * DECLINED_RETRY_SPREAD_MS);
    this.timers.set(peerId, setTimeout(() => {
      this.timers.delete(peerId);
      this.offerAgain(peerId);
    }, delay));
  }

  stop(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
