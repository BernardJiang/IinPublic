/**
 * OPEN-73: an embedded phone node mirrors its hub's room roster into its own Gun graph. It did so
 * by rewriting every member with `lastSeen: now` on every sync (a 5 s poll per room plus each
 * member-list request), so each phone sent ~230 member-record writes a minute that Gun replicated
 * to the hub, the other phones and every subscribed page while nothing happened (measured
 * 2026-10-18). A member is rewritten only when new, when its name or traveler flag changed, or
 * when its last local write is older than a third of the membership lifetime.
 */
export class RelayMemberTouchThrottle {
  private readonly written = new Map<string, { at: number; signature: string }>();

  constructor(private readonly refreshMs: number) {}

  /** True when this member's local record should be rewritten now (and records the write). */
  shouldTouch(chatroomId: string, member: { userId: string; stageName?: string; isTraveler?: boolean }, now = Date.now()): boolean {
    const key = `${chatroomId}|${member.userId}`;
    const signature = `${member.stageName ?? ''}|${member.isTraveler === undefined ? '' : String(member.isTraveler)}`;
    const previous = this.written.get(key);
    if (previous && previous.signature === signature && now - previous.at < this.refreshMs) return false;
    this.written.set(key, { at: now, signature });
    return true;
  }

  /** Forget a member (they left), so a rejoin is written at once. */
  forget(chatroomId: string, userId?: string): void {
    if (userId) {
      this.written.delete(`${chatroomId}|${userId}`);
      return;
    }
    for (const key of [...this.written.keys()]) if (key.startsWith(`${chatroomId}|`)) this.written.delete(key);
  }
}
