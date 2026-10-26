import type { MapPresenceDot } from '../../shared/map-dots';
import { publicLocationBounds, publicLocationContains, type PublicLocation } from '../../shared/public-location';

export type MapPoint = { latitude: number; longitude: number };
type Coordinate = [number, number];
export type UserDotGroup = MapPoint & {
  kind: 'self' | 'room' | 'other';
  count: number;
  travelers: number;
  userIds: string[];
  matchCount?: number;
  /** Presentation only. Actions still use the public point above. */
  displayPoint?: MapPoint;
  offset?: Coordinate;
};
export type UserLayoutSource = {
  selfUserId: string;
  selfPoint?: PublicLocation;
  /** Device-only GPS fix for my own marker; never a public presence point. */
  selfGpsPoint?: MapPoint;
  selfTraveler?: boolean;
  roomMemberIds: ReadonlySet<string>;
  matchCounts?: ReadonlyMap<string, number>;
  roomTravelerIds?: ReadonlySet<string>;
  isCandidate?: (dot: MapPresenceDot) => boolean;
};
type Viewport = {
  zoom: number;
  project: (point: Coordinate) => { x: number; y: number };
  unproject: (point: Coordinate) => { lat: number; lng: number };
};

/** Residents see their own fix; Travelers see the shared public/Place center. */
export function selfMapPosition(source: Pick<UserLayoutSource, 'selfPoint' | 'selfGpsPoint' | 'selfTraveler'>, place?: MapPoint): MapPoint | undefined {
  return (!source.selfTraveler ? source.selfGpsPoint : undefined) ?? place ?? source.selfPoint;
}

/** Users sharing one public point and one colour become a single dot with a count. */
export function groupUserDots(source: UserLayoutSource, dots: ReadonlyArray<MapPresenceDot>): UserDotGroup[] {
  const groups = new Map<string, UserDotGroup>();
  const seen = new Set<string>([source.selfUserId]);
  for (const dot of dots) {
    if (seen.has(dot.userId)) continue;
    seen.add(dot.userId);
    const kind = source.roomMemberIds.has(dot.userId) || source.isCandidate?.(dot) === true ? 'room' : 'other';
    const key = `${kind}:${dot.latitude}:${dot.longitude}`;
    const group = groups.get(key);
    if (group) {
      group.count += 1;
      group.userIds.push(dot.userId);
      if (dot.traveler) group.travelers += 1;
    } else {
      groups.set(key, { kind, latitude: dot.latitude, longitude: dot.longitude, count: 1, travelers: dot.traveler ? 1 : 0, userIds: [dot.userId] });
    }
  }
  const ordered = [...groups.values()].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'other' ? -1 : 1));
  if (source.selfPoint) {
    ordered.push({
      kind: 'self', ...source.selfPoint, count: 1, travelers: source.selfTraveler ? 1 : 0, userIds: [source.selfUserId],
      ...(!source.selfTraveler && source.selfGpsPoint ? { displayPoint: source.selfGpsPoint } : {}),
    });
  }
  for (const group of ordered) {
    const count = group.userIds.length === 1 ? source.matchCounts?.get(group.userIds[0]!) : 0;
    if (group.kind !== 'self' && count) group.matchCount = count;
  }
  return ordered;
}

/**
 * Separate people in my public cell, or in my current Place. No offset is ever published.
 * GPS uses the actual public grid bounds. A Place has no geographic extent: its dashed box
 * is a 144 px arrangement around the shared pin, shown from street zoom onwards.
 */
export function layoutMapUsers(
  source: UserLayoutSource,
  dots: ReadonlyArray<MapPresenceDot>,
  viewport: Viewport,
  place?: MapPoint & { memberCount?: number },
): { groups: UserDotGroup[]; boundary: Coordinate[] } {
  const center = place ?? source.selfPoint;
  if (!center) return { groups: groupUserDots(source, dots), boundary: [] };
  const unique = new Map<string, MapPresenceDot>();
  for (const dot of dots) if (!unique.has(dot.userId)) unique.set(dot.userId, dot);
  unique.delete(source.selfUserId);
  if (place) {
    // Place members need not publish GPS dots. Membership alone locates them at the Place.
    for (const userId of source.roomMemberIds) {
      if (userId === source.selfUserId) continue;
      unique.set(userId, { ...place, precisionMeters: 400, userId, traveler: source.roomTravelerIds?.has(userId) === true });
    }
  }
  const local: MapPresenceDot[] = [];
  const elsewhere: MapPresenceDot[] = [];
  for (const dot of unique.values()) {
    const belongs = place ? source.roomMemberIds.has(dot.userId) : publicLocationContains(source.selfPoint!, dot);
    (belongs ? local : elsewhere).push(dot);
  }
  // Give matched people individual, directly tappable markers before the overflow summary.
  local.sort((a, b) => (source.matchCounts?.get(b.userId) ?? 0) - (source.matchCounts?.get(a.userId) ?? 0)
    || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
  const groups = groupUserDots({ ...source, selfPoint: { ...center, precisionMeters: source.selfPoint?.precisionMeters ?? 400 } }, elsewhere);
  const self = groups.pop()!;
  let corners: Coordinate[];
  if (place) {
    const pixel = viewport.project([place.longitude, place.latitude]);
    corners = [[-72, -72], [72, -72], [72, 72], [-72, 72]].map(([x, y]) => {
      const point = viewport.unproject([pixel.x + x!, pixel.y + y!]);
      return [point.lng, point.lat];
    });
  } else {
    const bounds = publicLocationBounds(source.selfPoint!);
    corners = [[bounds.west, bounds.north], [bounds.east, bounds.north], [bounds.east, bounds.south], [bounds.west, bounds.south]];
  }
  const pixels = corners.map((corner) => viewport.project(corner));
  const lengths = pixels.map((pixel, i) => Math.hypot(pixel.x - pixels[(i + 1) % 4]!.x, pixel.y - pixels[(i + 1) % 4]!.y));
  const expanded = place ? viewport.zoom >= 14 : Math.min(...lengths) >= 96;
  const slots: MapPoint[] = [];
  if (expanded) {
    corners.forEach((start, i) => {
      const end = corners[(i + 1) % 4]!;
      const count = Math.min(3, Math.max(1, Math.floor((lengths[i]! + 0.001) / 48) - 1));
      for (let j = 1; j <= count; j++) {
        const ratio = j / (count + 1);
        slots.push({ longitude: start[0] + (end[0] - start[0]) * ratio, latitude: start[1] + (end[1] - start[1]) * ratio });
      }
    });
  }
  // Keep an edge marker clear of a Resident standing near that edge; never move their GPS fix.
  if (!source.selfTraveler && source.selfGpsPoint) {
    const selfPixel = viewport.project([source.selfGpsPoint.longitude, source.selfGpsPoint.latitude]);
    for (let i = slots.length - 1; i >= 0; i--) {
      const pixel = viewport.project([slots[i]!.longitude, slots[i]!.latitude]);
      if (Math.hypot(pixel.x - selfPixel.x, pixel.y - selfPixel.y) < 48) slots.splice(i, 1);
    }
  }
  const unlisted = place ? Math.max(0, (place.memberCount ?? 0) - 1 - local.length) : 0;
  const byKind = (['room', 'other'] as const).map((kind) => ({
    kind,
    dots: local.filter((dot) => (source.roomMemberIds.has(dot.userId) || source.isCandidate?.(dot) === true) === (kind === 'room')),
    slots: 1,
    unlisted: kind === 'room' ? unlisted : 0,
  })).filter((bucket) => bucket.dots.length > 0 || bucket.unlisted > 0);
  // Reserve a summary for each colour; spend the remaining bounded slots on individual people.
  let available = slots.length - byKind.length;
  while (available > 0 && byKind.some((bucket) => bucket.slots < bucket.dots.length + (bucket.unlisted > 0 ? 1 : 0))) {
    for (const bucket of byKind) {
      if (available > 0 && bucket.slots < bucket.dots.length + (bucket.unlisted > 0 ? 1 : 0)) { bucket.slots++; available--; }
    }
  }
  const total = byKind.reduce((sum, bucket) => sum + bucket.slots, 0);
  let index = 0;
  for (const bucket of byKind) {
    for (let i = 0; i < bucket.slots; i++) {
      const members = i === bucket.slots - 1 ? bucket.dots.slice(i) : bucket.dots.slice(i, i + 1);
      const first = members[0] ?? center;
      const unlistedCount = i === bucket.slots - 1 ? bucket.unlisted : 0;
      const position = slots[Math.floor(index++ * slots.length / total)];
      groups.push({
        kind: bucket.kind, latitude: first.latitude, longitude: first.longitude,
        count: members.length + unlistedCount, travelers: members.filter((dot) => dot.traveler).length,
        userIds: members.map((dot) => dot.userId),
        ...(members.length === 1 && !unlistedCount && source.matchCounts?.get(members[0]!.userId)
          ? { matchCount: source.matchCounts.get(members[0]!.userId)! } : {}),
        displayPoint: position ?? center,
        ...(!position ? { offset: [bucket.kind === 'room' ? -36 : 36, 0] as Coordinate } : {}),
      });
    }
  }
  groups.push(self);
  return { groups, boundary: !place || expanded ? [...corners, corners[0]!] : [] };
}
