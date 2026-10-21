import { isPlaceRoomId } from './place-rooms';

/**
 * The flat room list: every Place with at least one person online, nearest first, at its public
 * pin. Nearby is not a room (§3.7: it is each phone's own list), so it is never listed here.
 */
export type ActiveRoomSummary = {
  roomId: string;
  kind: 'place';
  memberCount: number;
  latitude?: number;
  longitude?: number;
  name?: string;
  distanceMeters?: number;
  /** Compass bearing from the viewer, 0 = north, clockwise. */
  bearingDegrees?: number;
};

export type ActiveRoomsView = {
  /** Everyone online (the hub's count, Nearby and Places; TechSupport is a Contact, never counted). */
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
  /** Places and how many people are in each now (the hub's v3 counts). */
  rooms: ReadonlyArray<{ roomId: string; memberCount: number }>;
  /** Everyone online; defaults to the sum over the listed Places. */
  totalOnline?: number;
  /** A Place's public pin and name. */
  placeOf: (roomId: string) => { name: string; latitude?: number; longitude?: number } | undefined;
  origin?: { latitude: number; longitude: number };
  offset?: number;
  limit?: number;
  /** Always included (first) even when empty: the viewer's own room. */
  currentRoomId?: string;
  sort?: ActiveRoomSort;
}): ActiveRoomsView {
  let inPlaces = 0;
  const summaries: ActiveRoomSummary[] = [];
  for (const room of input.rooms) {
    if (!isPlaceRoomId(room.roomId)) continue;
    const memberCount = Math.max(0, Math.floor(room.memberCount));
    inPlaces += memberCount;
    if (memberCount === 0 && room.roomId !== input.currentRoomId) continue;
    const summary: ActiveRoomSummary = { roomId: room.roomId, kind: 'place', memberCount };
    const place = input.placeOf(room.roomId);
    if (place?.name) summary.name = place.name;
    if (Number.isFinite(place?.latitude) && Number.isFinite(place?.longitude)) {
      summary.latitude = place!.latitude!;
      summary.longitude = place!.longitude!;
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
    totalOnline: input.totalOnline ?? inPlaces,
    totalRooms: summaries.filter((room) => room.memberCount > 0).length,
    rooms: summaries.slice(offset, offset + limit),
    hasMore: offset + limit < summaries.length,
  };
}
