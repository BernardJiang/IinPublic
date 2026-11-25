/**
 * People an offer is waiting for: the core answered `waiting` because it has no link (no keys) to
 * them yet. When their link opens, what waited is offered again (`onReady`).
 *
 * OPEN-111 (a): the link can open while the offer is still in the core. Then `opened()` fires
 * before `add()` and finds nobody waiting, and the offer waited until the person reconnected.
 * `add()` therefore checks whether the link is open already. That re-check runs at most once per
 * `recheckMs` per person, so a core that keeps answering `waiting` cannot loop.
 */
export class GraphWaitingOffers {
  private readonly waiting = new Set<string>();
  private readonly rechecked = new Map<string, number>();

  constructor(private readonly options: {
    isOpen: (userId: string) => boolean;
    onReady: (userId: string) => void;
    now?: () => number;
    recheckMs?: number;
  }) {}

  /** An offer came back waiting for these people. */
  add(userIds: readonly string[]): void {
    for (const userId of userIds) this.waiting.add(userId);
    const now = this.options.now?.() ?? Date.now();
    const recheckMs = this.options.recheckMs ?? 5_000;
    for (const userId of userIds) {
      if (!this.options.isOpen(userId)) continue;
      if (now - (this.rechecked.get(userId) ?? -Infinity) < recheckMs) continue;
      this.rechecked.set(userId, now);
      this.opened(userId);
    }
  }

  /** Their link opened: offer what waited. False when nothing waited. */
  opened(userId: string): boolean {
    if (!this.waiting.delete(userId)) return false;
    this.options.onReady(userId);
    return true;
  }

  /** Taken over by the caller (a neighbor connected and catches up itself). */
  take(userId: string): boolean {
    return this.waiting.delete(userId);
  }

  peers(): string[] {
    return [...this.waiting];
  }
}
