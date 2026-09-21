/**
 * Deterministic chatroom-capacity rule shared by every peer (one unified capacity for all rooms).
 *
 * There is no referee: any peer computing this over the same member list gets the same answer.
 * The order is (joinedAt asc, userId asc) — a strict total order, so equal timestamps never
 * make two peers disagree. A missing/unparseable joinedAt sorts as the NEWEST so a malformed
 * record can never be picked for eviction ahead of a well-formed one.
 *
 * Monotone under partial views: if a peer that has only seen a subset of the members finds
 * itself in the overflow set, it is also in the overflow set of the full member list (an extra
 * older member raises both its rank and the overflow count by one; an extra newer member only
 * raises the count). So a stale view can only evict LATE, never wrongly.
 */

export interface CapacityMember {
  userId: string;
  joinedAt: string;
}

/** Notice written by the room's newest member to tell an overflow member to move down. */
export interface EvictionNotice {
  by: string;
  at: string;
  capacity: number;
  /** The evictee's `joinedAt` in that room — a notice for an earlier stay is ignored. */
  evicteeJoinedAt: string;
}

function joinedAtMs(member: CapacityMember): number {
  const ms = Date.parse(member.joinedAt);
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

/** Oldest first; ties broken by userId (plain code-unit compare, identical on every device). */
export function orderMembersFifo(members: readonly CapacityMember[]): CapacityMember[] {
  return [...members].sort((a, b) => {
    const diff = joinedAtMs(a) - joinedAtMs(b);
    if (diff !== 0 && !Number.isNaN(diff)) return diff < 0 ? -1 : 1;
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
  });
}

/** The members who must move down: the `n - capacity` oldest, or none when within capacity. */
export function overflowMembers(members: readonly CapacityMember[], capacity: number): CapacityMember[] {
  const cap = Math.max(1, Math.floor(capacity));
  const ordered = orderMembersFifo(members);
  return ordered.length > cap ? ordered.slice(0, ordered.length - cap) : [];
}

/**
 * Rooms with no child room (custom rooms, the deepest regional room) overflow the OTHER way:
 * the `n - capacity` NEWEST members move on to the next numbered room, so nobody already inside is
 * disturbed. Each such member checks only "am I in this set?" and moves itself. Also monotone under
 * partial views (an extra member can only push my position up), so a stale view never moves me
 * wrongly.
 */
export function splitOverflowMembers(members: readonly CapacityMember[], capacity: number): CapacityMember[] {
  const cap = Math.max(1, Math.floor(capacity));
  return orderMembersFifo(members).slice(cap);
}

/** The newest member owns overflow resolution for the room (sends the notices). */
export function capacityOwner(members: readonly CapacityMember[]): string | null {
  const ordered = orderMembersFifo(members);
  return ordered.length > 0 ? ordered[ordered.length - 1].userId : null;
}

/** True when `notice` targets the evictee's CURRENT stay in the room. */
export function isNoticeForStay(notice: Partial<EvictionNotice> | null | undefined, myJoinedAt: string | undefined): boolean {
  return !!notice && !!myJoinedAt && typeof notice.evicteeJoinedAt === 'string' && notice.evicteeJoinedAt === myJoinedAt;
}
