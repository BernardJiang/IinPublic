import { isPlaceRoomId } from './place-rooms';

/**
 * The flat room list that replaced the chatroom tree: every room (Nearby group or Place) with at
 * least one person online, nearest first.
 *
 * Where a room is: a Place is at its public pin. A Nearby group is at the mean of its members'
 * public map points (shared/public-location.ts) — never a precise position. A group none of whose
 * members has a dot yet has no position and is listed after every placed room.
 */
export type ActiveRoomSummary = {
  roomId: string;
  kind: 'nearby' | 'place';
  memberCount: number;
  latitude?: number;
  longitude?: number;
  /** Place display name; Nearby groups are named on the device from their position. */
  name?: string;
  distanceMeters?: number;
  /** Compass bearing from the viewer, 0 = north, clockwise. */
  bearingDegrees?: number;
  /** Nearby group's partition path (public signed control data): where a tap should travel. */
  partitionPath?: string;
};

export type ActiveRoomsView = {
  /** Distinct people online in any room (TechSupport is a Contact and never counted). */
  totalOnline: number;
  totalRooms: number;
  rooms: ActiveRoomSummary[];
  /** True when more rooms follow this page. */
  hasMore: boolean;
};

/** Nearest (default), most people first, or fewest people first (a room with space). */
export type ActiveRoomSort = 'nearest' | 'busiest' | 'most-room';
export const ACTIVE_ROOM_SORTS: readonly ActiveRoomSort[] = ['nearest', 'busiest', 'most-room'];
export const isActiveRoomSort = (value: unknown): value is ActiveRoomSort =>
  ACTIVE_ROOM_SORTS.includes(value as ActiveRoomSort);

export const ACTIVE_ROOMS_PAGE = 30;
export const ACTIVE_ROOMS_MAX_PAGE = 200;

export function metersBetween(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const radians = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * radians;
  const dLon = (b.longitude - a.longitude) * radians;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDegrees(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const radians = Math.PI / 180;
  const y = Math.sin((to.longitude - from.longitude) * radians) * Math.cos(to.latitude * radians);
  const x = Math.cos(from.latitude * radians) * Math.sin(to.latitude * radians)
    - Math.sin(from.latitude * radians) * Math.cos(to.latitude * radians) * Math.cos((to.longitude - from.longitude) * radians);
  return (Math.atan2(y, x) / radians + 360) % 360;
}

export function summarizeActiveRooms(input: {
  rooms: ReadonlyArray<{ roomId: string; memberIds: readonly string[] }>;
  /** A member's public map point, if they publish one. */
  pointOf: (userId: string) => { latitude: number; longitude: number } | undefined;
  /** A Place's public pin and name. */
  placeOf: (roomId: string) => { name: string; latitude?: number; longitude?: number } | undefined;
  /** A Nearby group's partition path, when the index knows it. */
  pathOf?: (roomId: string) => string | undefined;
  origin?: { latitude: number; longitude: number };
  offset?: number;
  limit?: number;
  /** Always included (first) even when empty: the viewer's own room. */
  currentRoomId?: string;
  sort?: ActiveRoomSort;
}): ActiveRoomsView {
  const online = new Set<string>();
  const summaries: ActiveRoomSummary[] = [];
  for (const room of input.rooms) {
    const memberIds = [...new Set(room.memberIds)];
    memberIds.forEach((id) => online.add(id));
    if (memberIds.length === 0 && room.roomId !== input.currentRoomId) continue;
    const kind = isPlaceRoomId(room.roomId) ? 'place' : 'nearby';
    const summary: ActiveRoomSummary = { roomId: room.roomId, kind, memberCount: memberIds.length };
    if (kind === 'place') {
      const place = input.placeOf(room.roomId);
      if (place?.name) summary.name = place.name;
      if (Number.isFinite(place?.latitude) && Number.isFinite(place?.longitude)) {
        summary.latitude = place!.latitude!;
        summary.longitude = place!.longitude!;
      }
    } else {
      const path = input.pathOf?.(room.roomId);
      if (path !== undefined) summary.partitionPath = path;
      const points = memberIds.map(input.pointOf).filter((point): point is { latitude: number; longitude: number } => !!point);
      if (points.length > 0) {
        summary.latitude = points.reduce((sum, point) => sum + point.latitude, 0) / points.length;
        summary.longitude = points.reduce((sum, point) => sum + point.longitude, 0) / points.length;
      }
    }
    if (input.origin && summary.latitude !== undefined && summary.longitude !== undefined) {
      const at = { latitude: summary.latitude, longitude: summary.longitude };
      summary.distanceMeters = Math.round(metersBetween(input.origin, at));
      summary.bearingDegrees = Math.round(bearingDegrees(input.origin, at));
    }
    summaries.push(summary);
  }
  const sort = input.sort ?? 'nearest';
  const own = (room: ActiveRoomSummary) => room.roomId === input.currentRoomId ? 0 : 1;
  const distance = (room: ActiveRoomSummary) => room.distanceMeters ?? Number.MAX_SAFE_INTEGER;
  // Your own room stays on top; then the chosen order, with distance as the tie-breaker.
  summaries.sort((left, right) => own(left) - own(right)
    || (sort === 'busiest' ? right.memberCount - left.memberCount : 0)
    || (sort === 'most-room' ? left.memberCount - right.memberCount : 0)
    || distance(left) - distance(right)
    || right.memberCount - left.memberCount
    || left.roomId.localeCompare(right.roomId));
  const offset = Math.max(0, Math.floor(input.offset ?? 0));
  const limit = Math.max(1, Math.min(ACTIVE_ROOMS_MAX_PAGE, Math.floor(input.limit ?? ACTIVE_ROOMS_PAGE)));
  return {
    totalOnline: online.size,
    totalRooms: summaries.filter((room) => room.memberCount > 0).length,
    rooms: summaries.slice(offset, offset + limit),
    hasMore: offset + limit < summaries.length,
  };
}
