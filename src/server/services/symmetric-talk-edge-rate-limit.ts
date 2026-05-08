/**
 * FR-SP-1 / FR-SP-2 style symmetric cooldown: one timestamp per user for both sending and receiving.
 * Bulk broadcasts touch each successful receiver immediately, then touch the sender once if any succeeded.
 */
export class SymmetricTalkEdgeRateLimiter {
  private lastEdgeByUser = new Map<string, number>();

  constructor(readonly cooldownMs: number) {}

  isCold(userId: string, now: number): boolean {
    if (this.cooldownMs <= 0) return true;
    const t = this.lastEdgeByUser.get(userId) ?? 0;
    return now - t >= this.cooldownMs;
  }

  touch(userId: string, now: number): void {
    if (this.cooldownMs <= 0) return;
    this.lastEdgeByUser.set(userId, now);
  }

  touchPair(senderId: string, receiverId: string, now: number): void {
    this.touch(senderId, now);
    this.touch(receiverId, now);
  }

  resetForTesting(): void {
    this.lastEdgeByUser.clear();
  }
}
