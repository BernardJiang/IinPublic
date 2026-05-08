/**
 * FR-SP-1 / FR-SP-2 style numeric daily/weekly hard caps.
 *
 * Separate counters for:
 *  - sender's "sending" edges (sender -> receiver)
 *  - receiver's "receiving" edges (sender -> receiver)
 *
 * The same configured thresholds apply symmetrically to send + receive.
 *
 * Notes:
 *  - In-memory state only (server-side single process). E2E runs with isolated
 *    server workers, so this is stable for tests.
 *  - Resets are based on UTC day boundaries and UTC Monday-start week buckets.
 */
export type TalkEdgeQuotaLimits = {
  /** If <= 0, disables daily quotas. */
  daily: number;
  /** If <= 0, disables weekly quotas. */
  weekly: number;
};

export class DailyWeeklyTalkEdgeQuotaRateLimiter {
  private senderStateByUser = new Map<string, { dayStartMs: number; sentToday: number; weekStartMs: number; sentThisWeek: number }>();
  private receiverStateByUser = new Map<string, { dayStartMs: number; receivedToday: number; weekStartMs: number; receivedThisWeek: number }>();

  constructor(readonly limits: TalkEdgeQuotaLimits) {}

  resetForTesting(): void {
    this.senderStateByUser.clear();
    this.receiverStateByUser.clear();
  }

  checkEdgeQuotas(senderId: string, receiverId: string, nowMs: number): { ok: boolean; rejectedBy: string[] } {
    const rejectedBy: string[] = [];
    const dayLimit = this.limits.daily;
    const weekLimit = this.limits.weekly;

    const senderState = this.ensureSenderState(senderId, nowMs);
    const receiverState = this.ensureReceiverState(receiverId, nowMs);

    if (dayLimit > 0) {
      if (senderState.sentToday >= dayLimit) rejectedBy.push('daily_talk_send_rate_limit');
      if (receiverState.receivedToday >= dayLimit) rejectedBy.push('daily_talk_receive_rate_limit');
    }

    if (weekLimit > 0) {
      if (senderState.sentThisWeek >= weekLimit) rejectedBy.push('weekly_talk_send_rate_limit');
      if (receiverState.receivedThisWeek >= weekLimit) rejectedBy.push('weekly_talk_receive_rate_limit');
    }

    return { ok: rejectedBy.length === 0, rejectedBy };
  }

  consumeEdgeQuotas(senderId: string, receiverId: string, nowMs: number): void {
    const senderState = this.ensureSenderState(senderId, nowMs);
    const receiverState = this.ensureReceiverState(receiverId, nowMs);

    const dayLimit = this.limits.daily;
    const weekLimit = this.limits.weekly;
    if (dayLimit > 0) senderState.sentToday += 1;
    if (weekLimit > 0) senderState.sentThisWeek += 1;

    if (dayLimit > 0) receiverState.receivedToday += 1;
    if (weekLimit > 0) receiverState.receivedThisWeek += 1;
  }

  private ensureSenderState(userId: string, nowMs: number): {
    dayStartMs: number;
    sentToday: number;
    weekStartMs: number;
    sentThisWeek: number;
  } {
    const existing = this.senderStateByUser.get(userId);
    const dayStartMs = this.getUtcDayStartMs(nowMs);
    const weekStartMs = this.getUtcWeekStartMs(nowMs);
    if (!existing) {
      const next = { dayStartMs, sentToday: 0, weekStartMs, sentThisWeek: 0 };
      this.senderStateByUser.set(userId, next);
      return next;
    }
    if (existing.dayStartMs !== dayStartMs) {
      existing.dayStartMs = dayStartMs;
      existing.sentToday = 0;
    }
    if (existing.weekStartMs !== weekStartMs) {
      existing.weekStartMs = weekStartMs;
      existing.sentThisWeek = 0;
    }
    return existing;
  }

  private ensureReceiverState(userId: string, nowMs: number): {
    dayStartMs: number;
    receivedToday: number;
    weekStartMs: number;
    receivedThisWeek: number;
  } {
    const existing = this.receiverStateByUser.get(userId);
    const dayStartMs = this.getUtcDayStartMs(nowMs);
    const weekStartMs = this.getUtcWeekStartMs(nowMs);
    if (!existing) {
      const next = { dayStartMs, receivedToday: 0, weekStartMs, receivedThisWeek: 0 };
      this.receiverStateByUser.set(userId, next);
      return next;
    }
    if (existing.dayStartMs !== dayStartMs) {
      existing.dayStartMs = dayStartMs;
      existing.receivedToday = 0;
    }
    if (existing.weekStartMs !== weekStartMs) {
      existing.weekStartMs = weekStartMs;
      existing.receivedThisWeek = 0;
    }
    return existing;
  }

  private getUtcDayStartMs(nowMs: number): number {
    const d = new Date(nowMs);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }

  /**
   * Monday-start week bucket (UTC). Examples:
   *  - Mon -> same day start
   *  - Sun -> previous Monday
   */
  private getUtcWeekStartMs(nowMs: number): number {
    const dayStartMs = this.getUtcDayStartMs(nowMs);
    const d = new Date(nowMs);
    const utcDay = d.getUTCDay(); // 0=Sunday .. 6=Saturday
    const daysFromMonday = (utcDay + 6) % 7; // Monday->0 ... Sunday->6
    return dayStartMs - daysFromMonday * 24 * 60 * 60 * 1000;
  }
}

