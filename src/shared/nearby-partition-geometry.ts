import {
  nearbyBasePrecisionMeters,
  projectNearbyCoordinate,
  unprojectNearbyCoordinate,
  type NearbyLocalCell,
  type NearbyPublicMode,
} from './nearby-rooms';
import type { GPSCoordinate } from './types';

const EARTH_RADIUS_METERS = 6_378_137;
const MAX_MERCATOR_LATITUDE = 85.05112878;
const WORLD_HALF_WIDTH_METERS = Math.PI * EARTH_RADIUS_METERS;
const WORLD_WIDTH_METERS = WORLD_HALF_WIDTH_METERS * 2;

export type NearbyPartitionDisplayGeometry = {
  /** Only this prefix is geographic. Any remaining path digits are capacity-only cohorts. */
  geographicPath: string;
  geographicDepth: number;
  cohortDepth: number;
  localCell: NearbyLocalCell;
  /** Approximate ground width at the member's declared latitude, not Web-Mercator width. */
  cellSizeMeters: number;
  approximateDiameterMeters: number;
};

function assertPartitionPath(path: string): void {
  if (!/^[0-3]{0,24}$/.test(path)) throw new Error('Nearby partition path is invalid');
}

function assertMaximumDepth(maximumDepth: number): void {
  if (!Number.isSafeInteger(maximumDepth) || maximumDepth < 0 || maximumDepth > 24) {
    throw new Error('Nearby partition maximum depth is invalid');
  }
}

function mercatorGroundScale(latitude: number): number {
  const clamped = Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, latitude));
  return Math.cos(clamped * Math.PI / 180);
}

function effectiveGroundFloorMeters(location: GPSCoordinate, mode: NearbyPublicMode): number {
  const selectedFloor = nearbyBasePrecisionMeters(mode);
  const accuracyFloor = Number.isFinite(location.accuracy) && location.accuracy > 0
    ? location.accuracy * 2
    : 0;
  return Math.max(selectedFloor, accuracyFloor);
}

/**
 * Convert the member's ground-distance privacy floor to Web-Mercator metres at their latitude.
 * Without this adjustment, a nominal 50 km Mercator cell is only about 8.7 km wide at 80°.
 */
export function nearbyPartitionProjectedPrivacyFloorMeters(
  location: GPSCoordinate,
  mode: NearbyPublicMode,
): number {
  // Projection performs the shared coordinate validation and applies the Mercator latitude clamp.
  projectNearbyCoordinate(location);
  return effectiveGroundFloorMeters(location, mode) / mercatorGroundScale(location.latitude);
}

/** Maximum geographic quadtree depth permitted by privacy, accuracy, latitude, and protocol. */
export function maximumNearbyPartitionGeographicDepth(input: {
  location: GPSCoordinate;
  mode: NearbyPublicMode;
  maximumDepth: number;
}): number {
  assertMaximumDepth(input.maximumDepth);
  const projectedFloor = nearbyPartitionProjectedPrivacyFloorMeters(input.location, input.mode);
  const available = Math.floor(Math.log2(WORLD_WIDTH_METERS / projectedFloor));
  return Math.max(0, Math.min(input.maximumDepth, available));
}

function cellForGeographicPath(path: string): NearbyLocalCell {
  assertPartitionPath(path);
  let minX = -WORLD_HALF_WIDTH_METERS;
  let maxX = WORLD_HALF_WIDTH_METERS;
  let minY = -WORLD_HALF_WIDTH_METERS;
  let maxY = WORLD_HALF_WIDTH_METERS;
  let x = 0;
  let y = 0;
  for (const quadrant of path) {
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    x *= 2;
    y *= 2;
    if (quadrant === '1' || quadrant === '3') {
      minX = midX;
      x += 1;
    } else {
      maxX = midX;
    }
    if (quadrant === '2' || quadrant === '3') {
      minY = midY;
      y += 1;
    } else {
      maxY = midY;
    }
  }
  return { x, y, minX, minY, maxX, maxY };
}

/**
 * A point that routes into the group at `path` for a member with this privacy setting: the centre
 * of the path's square, using only the geographic digits that setting allows. (Room-list taps aim
 * here, never at the members' average, which can fall just across a partition edge.) Snapping to
 * the privacy grid moves a point less than half a square, so it stays inside.
 */
export function nearbyPartitionTargetPoint(input: {
  path: string;
  mode: NearbyPublicMode;
  near: { latitude: number; longitude: number };
}): { latitude: number; longitude: number; laneLimited: boolean } {
  assertPartitionPath(input.path);
  const depth = maximumNearbyPartitionGeographicDepth({ location: { ...input.near, accuracy: 0, timestamp: new Date() }, mode: input.mode, maximumDepth: 24 });
  const geographic = input.path.slice(0, Math.min(depth, input.path.length));
  const cell = cellForGeographicPath(geographic);
  const centre = unprojectNearbyCoordinate({ x: (cell.minX + cell.maxX) / 2, y: (cell.minY + cell.maxY) / 2 });
  // Deeper digits are identity lanes: a traveler lands in their own lane, not necessarily this one.
  return { ...centre, laneLimited: input.path.length > geographic.length };
}

/**
 * The map square of the group at `path` as a member with this setting would see it (geographic
 * digits only; lanes share their parent's square). Used to draw other rooms on the map.
 */
export function nearbyPartitionCellBounds(input: {
  path: string;
  mode: NearbyPublicMode;
  near: { latitude: number; longitude: number };
}): { west: number; south: number; east: number; north: number } {
  assertPartitionPath(input.path);
  const depth = maximumNearbyPartitionGeographicDepth({ location: { ...input.near, accuracy: 0, timestamp: new Date() }, mode: input.mode, maximumDepth: 24 });
  const cell = cellForGeographicPath(input.path.slice(0, Math.min(depth, input.path.length)));
  const southwest = unprojectNearbyCoordinate({ x: cell.minX, y: cell.minY });
  const northeast = unprojectNearbyCoordinate({ x: cell.maxX, y: cell.maxY });
  return {
    west: Math.max(-180, southwest.longitude),
    south: Math.max(-85.05112878, southwest.latitude),
    east: Math.min(180, northeast.longitude),
    north: Math.min(85.05112878, northeast.latitude),
  };
}

/**
 * Resolve map/display geometry from the geographic prefix only. Callers may supply a protocol's
 * explicit geographic depth; legacy paths infer the greatest depth allowed by this member's floor.
 */
export function nearbyPartitionDisplayGeometry(input: {
  path: string;
  location: GPSCoordinate;
  mode: NearbyPublicMode;
  maximumDepth: number;
  geographicDepth?: number;
}): NearbyPartitionDisplayGeometry {
  assertPartitionPath(input.path);
  assertMaximumDepth(input.maximumDepth);
  const privacyDepth = maximumNearbyPartitionGeographicDepth({
    location: input.location,
    mode: input.mode,
    maximumDepth: input.maximumDepth,
  });
  const requestedDepth = input.geographicDepth ?? input.path.length;
  if (!Number.isSafeInteger(requestedDepth) || requestedDepth < 0 || requestedDepth > input.path.length) {
    throw new Error('Nearby partition geographic depth is invalid');
  }
  const geographicDepth = Math.min(requestedDepth, privacyDepth);
  const geographicPath = input.path.slice(0, geographicDepth);
  const localCell = cellForGeographicPath(geographicPath);
  const projectedCellSize = WORLD_WIDTH_METERS / 2 ** geographicDepth;
  const cellSizeMeters = projectedCellSize * mercatorGroundScale(input.location.latitude);
  return {
    geographicPath,
    geographicDepth,
    cohortDepth: input.path.length - geographicDepth,
    localCell,
    cellSizeMeters,
    approximateDiameterMeters: Math.round(Math.sqrt(2) * cellSizeMeters),
  };
}
