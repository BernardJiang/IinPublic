/**
 * Chatroom membership liveness.
 *
 * Membership lives in Gun at `chatrooms/<room>/users/<userId>` and is written by the browser.
 * When a browser closes, its Gun peer can flush a final `isActive:true` write that no live peer
 * ever decrements — a "ghost" that inflates the room headcount (and, via the client-side
 * `e2e_capacity` path, mis-drives eviction). There is no server→userId mapping on Gun peer
 * disconnect, so ghosts cannot be reaped at the source.
 *
 * Instead, a live member refreshes a `lastSeen` heartbeat every {@link MEMBER_HEARTBEAT_MS};
 * the headcount counts a member only if it is active AND its heartbeat is within
 * {@link MEMBER_STALE_MS}. A departed peer stops heartbeating, so its ghost ages out of the
 * count within the stale window. Both the client count and the server's published count use
 * {@link isMemberRecordLive} so they agree.
 *
 * Tuning invariant: MEMBER_STALE_MS must comfortably exceed MEMBER_HEARTBEAT_MS plus Gun
 * replication lag (so a genuinely-live member is never dropped), yet stay below a headcount
 * assertion's budget (so a ghost clears in time). Records with no usable `lastSeen` are always
 * counted — we never drop a member we cannot prove stale (e.g. server/API-added members and
 * TechSupport, which carry no heartbeat).
 */
export const MEMBER_HEARTBEAT_MS = 4000;
export const MEMBER_STALE_MS = 12000;

export function isMemberRecordLive(
  data: { isActive?: unknown; lastSeen?: unknown } | null | undefined,
  now: number = Date.now(),
  staleMs: number = MEMBER_STALE_MS,
): boolean {
  if (!data || (data as { isActive?: unknown }).isActive !== true) return false;
  const raw = (data as { lastSeen?: unknown }).lastSeen;
  const ts =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string'
        ? Date.parse(raw)
        : NaN;
  // No usable heartbeat timestamp → keep counting; never drop a member we cannot prove is stale.
  if (!Number.isFinite(ts)) return true;
  return now - ts <= staleMs;
}
