/**
 * Room visit metrics as a CRDT G-Counter (docs/TODO.md L1).
 *
 * ## Why
 *
 * The previous design kept two shared Gun scalars (`chatrooms/<id>/visitCount`,
 * `chatrooms/<id>/uniqueVisitorCount`) and incremented them read-modify-write from
 * *both* the server and the browser. Two concurrent joins read the same N and both
 * wrote N+1; Gun's last-write-wins kept one, and the lost visit was unrecoverable
 * because no event log survived to rebuild from. The same scalars were also
 * incremented twice when a join traversed both paths.
 *
 * ## The structure
 *
 * A grow-only counter: **each user owns one slot and nobody ever writes another
 * user's slot.** There is no shared cell to race on, so concurrent writers cannot
 * lose an increment.
 *
 *     chatrooms/<roomId>/visitCounter/<userId> -> { userId, count, firstVisitedAt, lastVisitedAt }
 *
 * Both badges fall out of the same structure:
 *   - **visits**          = sum of every slot's `count`
 *   - **unique visitors** = number of slots with `count > 0`
 *
 * which is why the separate `uniqueVisitors/<userId>` node and both scalars can go.
 *
 * Merge takes the per-slot max, so it is commutative, associative, and idempotent —
 * replays, out-of-order sync, and double delivery all converge to the same value.
 *
 * ## Cost, stated plainly
 *
 * Summing slots is O(members-ever-in-room) instead of O(1). Callers that render a
 * room list should read a published aggregate (the same pattern as
 * `public/room-member-counts/<id>`) and only sum slots when no aggregate exists.
 * This module is the source of truth; the aggregate is a cache.
 */

export type VisitCounterSlot = {
  userId: string;
  /** Monotone: only ever increases, and only its owner writes it. */
  count: number;
  firstVisitedAt: string;
  lastVisitedAt: string;
};

/** Keyed by userId. Mirrors the shape of a Gun child-node map. */
export type VisitCounterState = Record<string, VisitCounterSlot>;

export type VisitTotals = {
  visitCount: number;
  uniqueVisitorCount: number;
};

const EMPTY_TOTALS: VisitTotals = { visitCount: 0, uniqueVisitorCount: 0 };

function toCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function earliest(a: string | undefined, b: string | undefined): string {
  if (!a) return b || '';
  if (!b) return a;
  return a < b ? a : b;
}

function latest(a: string | undefined, b: string | undefined): string {
  if (!a) return b || '';
  if (!b) return a;
  return a > b ? a : b;
}

/** True for a Gun child key that is metadata rather than a slot (`_`, `#`). */
function isSlotKey(key: string): boolean {
  return !!key && !key.startsWith('_') && key !== '#';
}

/** Coerce one raw Gun node into a slot, or null when it carries no usable count. */
export function readVisitSlot(userId: string, raw: unknown): VisitCounterSlot | null {
  if (!userId || !isSlotKey(userId)) return null;
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Partial<VisitCounterSlot>;
  const count = toCount(record.count);
  return {
    userId,
    count,
    firstVisitedAt: String(record.firstVisitedAt || ''),
    lastVisitedAt: String(record.lastVisitedAt || ''),
  };
}

/** Parse a raw Gun map of slots, skipping metadata keys and malformed children. */
export function readVisitCounterState(raw: unknown): VisitCounterState {
  if (!raw || typeof raw !== 'object') return {};
  const state: VisitCounterState = {};
  for (const [userId, value] of Object.entries(raw as Record<string, unknown>)) {
    const slot = readVisitSlot(userId, value);
    if (slot) state[userId] = slot;
  }
  return state;
}

/**
 * The slot this user should write after a visit. Monotone: never decreases, even if
 * the caller passes a stale `existing` (a slow or timed-out read can no longer clobber
 * a real count the way the old `readNumericRoomMetric` 700 ms default-to-0 could).
 */
export function incrementVisitSlot(
  existing: VisitCounterSlot | null | undefined,
  userId: string,
  now: string,
): VisitCounterSlot {
  const previous = existing && existing.userId === userId ? existing : null;
  return {
    userId,
    count: toCount(previous?.count) + 1,
    firstVisitedAt: previous?.firstVisitedAt || now,
    lastVisitedAt: latest(previous?.lastVisitedAt, now),
  };
}

/** Per-slot merge: max count, earliest first-seen, latest last-seen. */
export function mergeVisitSlot(a: VisitCounterSlot, b: VisitCounterSlot): VisitCounterSlot {
  return {
    userId: a.userId,
    count: Math.max(toCount(a.count), toCount(b.count)),
    firstVisitedAt: earliest(a.firstVisitedAt, b.firstVisitedAt),
    lastVisitedAt: latest(a.lastVisitedAt, b.lastVisitedAt),
  };
}

/**
 * Merge two counter states. Commutative, associative, and idempotent — the three
 * properties that make replay and out-of-order sync safe.
 */
export function mergeVisitCounters(
  a: VisitCounterState | undefined,
  b: VisitCounterState | undefined,
): VisitCounterState {
  const merged: VisitCounterState = { ...(a || {}) };
  for (const [userId, slot] of Object.entries(b || {})) {
    const existing = merged[userId];
    merged[userId] = existing ? mergeVisitSlot(existing, slot) : slot;
  }
  return merged;
}

/**
 * Both badges from one structure: total visits is the sum of slots, unique visitors
 * is the number of slots that have at least one visit.
 */
export function visitTotals(state: VisitCounterState | undefined): VisitTotals {
  if (!state) return { ...EMPTY_TOTALS };
  let visitCount = 0;
  let uniqueVisitorCount = 0;
  for (const slot of Object.values(state)) {
    const count = toCount(slot?.count);
    if (count <= 0) continue;
    visitCount += count;
    uniqueVisitorCount += 1;
  }
  return { visitCount, uniqueVisitorCount };
}

/** Gun path to one user's slot. */
export function visitCounterPath(chatroomId: string, userId: string): string[] {
  return ['chatrooms', chatroomId, 'visitCounter', userId];
}

/** Gun path to the whole counter map for a room. */
export function visitCounterMapPath(chatroomId: string): string[] {
  return ['chatrooms', chatroomId, 'visitCounter'];
}

/**
 * Published aggregate for cheap room-list rendering — a cache of `visitTotals`, not
 * the source of truth. Same pattern as `public/room-member-counts/<id>`.
 */
export function publishedVisitTotalsPath(chatroomId: string): string[] {
  return ['public', 'room-visit-counts', chatroomId];
}

/**
 * Seed a slot from a legacy scalar so existing rooms do not reset to zero on upgrade.
 * The historical per-user split is unrecoverable, so the whole legacy total is parked
 * in one synthetic slot; `unique` therefore reads as 1 for rooms with no new visits yet.
 */
export const LEGACY_VISIT_SLOT_ID = 'legacy-visit-total';

export function legacyMigrationState(legacyVisitCount: unknown, now: string): VisitCounterState {
  const count = toCount(legacyVisitCount);
  if (count <= 0) return {};
  return {
    [LEGACY_VISIT_SLOT_ID]: {
      userId: LEGACY_VISIT_SLOT_ID,
      count,
      firstVisitedAt: now,
      lastVisitedAt: now,
    },
  };
}
