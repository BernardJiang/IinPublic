export type RoomTopologyBounds = {
  users: number;
  roomCapacity: number;
  neighborLimit: number;
  minimumRoomCount: number;
  maximumCandidatesPerDevice: number;
  maximumDirectedLinks: number;
  maximumUndirectedLinks: number;
  globalPairCount: number;
};

/** Closed-form scale proof used by tests and diagnostics; it never constructs a global roster. */
export function roomTopologyBounds(
  users: number,
  roomCapacity: number,
  neighborLimit: number,
): RoomTopologyBounds {
  const n = Math.max(0, Math.floor(users));
  const c = Math.max(1, Math.floor(roomCapacity));
  const k = Math.max(0, Math.min(c - 1, Math.floor(neighborLimit)));
  return {
    users: n,
    roomCapacity: c,
    neighborLimit: k,
    minimumRoomCount: Math.ceil(n / c),
    maximumCandidatesPerDevice: Math.min(Math.max(0, n - 1), c - 1),
    maximumDirectedLinks: n * k,
    maximumUndirectedLinks: Math.ceil((n * k) / 2),
    globalPairCount: (n * Math.max(0, n - 1)) / 2,
  };
}

/** Deterministic synthetic partition; callers can sample any user without allocating N users. */
export function syntheticRoomForUser(userIndex: number, roomCapacity: number): number {
  if (!Number.isSafeInteger(userIndex) || userIndex < 0) throw new Error('user index must be a non-negative safe integer');
  const capacity = Math.max(1, Math.floor(roomCapacity));
  return Math.floor(userIndex / capacity);
}
