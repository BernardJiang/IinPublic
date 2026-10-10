import type { GPSCoordinate } from './types';
import { portableSha256Hex } from './portable-sha256';

/** Versioned, release-wide Nearby placement policy. Room IDs never contain raw coordinates. */
export const NEARBY_ROOM_VERSION = 1;
export const NEARBY_PROTOCOL_EPOCH = 1;
export const NEARBY_NEIGHBORHOOD_METERS = 1_000;
export const NEARBY_CLOSE_METERS = 400;
export const NEARBY_BOUNDARY_HYSTERESIS_RATIO = 0.15;
export const NEARBY_MAX_SPLIT_GENERATION = 20;
/** Experimental sparse-area ceiling: one active cell may grow to 8x the selected base reach. */
export const NEARBY_MAX_WIDENING_LEVEL = 3;
export const NEARBY_MAX_IDENTITY_LANES = 1_048_576;
/** Local exchange scopes. They must never be published as Internet/Gun room memberships. */
export const CONTACTS_ONLY_SCOPE_ID = 'local_contacts_only_v1';
export const RADIO_NEARBY_SCOPE_ID = 'local_radio_nearby_v1';

const EARTH_RADIUS_METERS = 6_378_137;
const MAX_MERCATOR_LATITUDE = 85.05112878;
const ROOM_DOMAIN = 'iinpublic:nearby-room:v1';

export type NearbyPrivacyMode =
  | 'contacts-only'
  | 'radio-nearby'
  | 'neighborhood'
  | 'close-nearby'
  | 'location-off';

export type NearbyPublicMode = Extract<NearbyPrivacyMode, 'neighborhood' | 'close-nearby'>;

export type NearbyLocalCell = {
  /** Local-only projected cell coordinates. Never publish these fields. */
  x: number;
  y: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type NearbyRoomAssignment = {
  version: 1;
  kind: 'nearby';
  roomId: string;
  mode: NearbyPublicMode;
  protocolEpoch: number;
  basePrecisionMeters: number;
  /** Zero preserves the original base grid; each level doubles the one active cell's width. */
  wideningLevel: number;
  widenedPrecisionMeters: number;
  splitGeneration: number;
  requestedSplitGeneration: number;
  cellSizeMeters: number;
  approximateDiameterMeters: number;
  identityLaneCount: number;
  identityLaneIndex: number;
  /** Required for map shading and drift hysteresis, but must remain device-local. */
  localCell: NearbyLocalCell;
};

export type NearbyPublicScope = Omit<NearbyRoomAssignment, 'localCell'>;

export type NearbyMapArea = {
  /** Device-local display geometry. Never include it in room presence or discovery metadata. */
  west: number;
  south: number;
  east: number;
  north: number;
  approximateDiameterMeters: number;
};

function assertCoordinate(location: Pick<GPSCoordinate, 'latitude' | 'longitude'>): void {
  if (!Number.isFinite(location.latitude) || location.latitude < -90 || location.latitude > 90) {
    throw new Error('nearby latitude is invalid');
  }
  if (!Number.isFinite(location.longitude) || location.longitude < -180 || location.longitude > 180) {
    throw new Error('nearby longitude is invalid');
  }
}

function assertGeneration(generation: number): number {
  if (!Number.isSafeInteger(generation) || generation < 0 || generation > NEARBY_MAX_SPLIT_GENERATION) {
    throw new Error('nearby split generation is out of range');
  }
  return generation;
}

function assertWideningLevel(level: number): number {
  if (!Number.isSafeInteger(level) || level < 0 || level > NEARBY_MAX_WIDENING_LEVEL) {
    throw new Error('nearby widening level is out of range');
  }
  return level;
}

export function nearbyBasePrecisionMeters(mode: NearbyPublicMode): number {
  return mode === 'close-nearby' ? NEARBY_CLOSE_METERS : NEARBY_NEIGHBORHOOD_METERS;
}

/** Web-Mercator is used only locally to obtain a deterministic metric grid. */
export function projectNearbyCoordinate(
  location: Pick<GPSCoordinate, 'latitude' | 'longitude'>,
): { x: number; y: number } {
  assertCoordinate(location);
  const latitude = Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, location.latitude));
  const longitudeRadians = location.longitude * Math.PI / 180;
  const latitudeRadians = latitude * Math.PI / 180;
  return {
    x: EARTH_RADIUS_METERS * longitudeRadians,
    y: EARTH_RADIUS_METERS * Math.log(Math.tan(Math.PI / 4 + latitudeRadians / 2)),
  };
}

function unprojectNearbyCoordinate(point: { x: number; y: number }): {
  latitude: number;
  longitude: number;
} {
  return {
    longitude: point.x / EARTH_RADIUS_METERS * 180 / Math.PI,
    latitude: (2 * Math.atan(Math.exp(point.y / EARTH_RADIUS_METERS)) - Math.PI / 2)
      * 180 / Math.PI,
  };
}

/** Convert the local-only projected cell into map bounds without changing its publishable scope. */
export function nearbyMapArea(assignment: NearbyRoomAssignment): NearbyMapArea {
  const southwest = unprojectNearbyCoordinate({
    x: assignment.localCell.minX,
    y: assignment.localCell.minY,
  });
  const northeast = unprojectNearbyCoordinate({
    x: assignment.localCell.maxX,
    y: assignment.localCell.maxY,
  });
  return {
    west: Math.max(-180, southwest.longitude),
    south: Math.max(-MAX_MERCATOR_LATITUDE, southwest.latitude),
    east: Math.min(180, northeast.longitude),
    north: Math.min(MAX_MERCATOR_LATITUDE, northeast.latitude),
    approximateDiameterMeters: assignment.approximateDiameterMeters,
  };
}

function cellAt(projected: { x: number; y: number }, cellSizeMeters: number): NearbyLocalCell {
  const x = Math.floor(projected.x / cellSizeMeters);
  const y = Math.floor(projected.y / cellSizeMeters);
  return {
    x,
    y,
    minX: x * cellSizeMeters,
    minY: y * cellSizeMeters,
    maxX: (x + 1) * cellSizeMeters,
    maxY: (y + 1) * cellSizeMeters,
  };
}

function canKeepPreviousCell(
  previous: NearbyRoomAssignment | undefined,
  input: {
    mode: NearbyPublicMode;
    protocolEpoch: number;
    wideningLevel: number;
    splitGeneration: number;
    projected: { x: number; y: number };
  },
): previous is NearbyRoomAssignment {
  if (!previous
    || previous.mode !== input.mode
    || previous.protocolEpoch !== input.protocolEpoch
    || previous.wideningLevel !== input.wideningLevel
    || previous.splitGeneration !== input.splitGeneration
    || previous.identityLaneCount !== 1) return false;
  const margin = previous.cellSizeMeters * NEARBY_BOUNDARY_HYSTERESIS_RATIO;
  return input.projected.x >= previous.localCell.minX - margin
    && input.projected.x < previous.localCell.maxX + margin
    && input.projected.y >= previous.localCell.minY - margin
    && input.projected.y < previous.localCell.maxY + margin;
}

/**
 * GPS accuracy is a hard limit on geographic subdivision. Once a cell would be narrower than
 * twice the accuracy radius, finer geographic IDs would pretend to know a position the device
 * does not know. Remaining requested generations become deterministic identity lanes instead.
 */
export function maximumGeographicSplitGeneration(
  basePrecisionMeters: number,
  accuracyMeters: number,
): number {
  const accuracy = Number.isFinite(accuracyMeters) && accuracyMeters > 0
    ? accuracyMeters
    : basePrecisionMeters / 2;
  const ratio = basePrecisionMeters / Math.max(1, accuracy * 2);
  return Math.max(0, Math.min(NEARBY_MAX_SPLIT_GENERATION, Math.floor(Math.log2(Math.max(1, ratio)))));
}

function identityLane(identity: string, roomSeed: string, laneCount: number): number {
  if (laneCount === 1) return 0;
  const digest = portableSha256Hex(`${ROOM_DOMAIN}:fallback-lane:${roomSeed}:${identity}`);
  return Number.parseInt(digest.slice(0, 12), 16) % laneCount;
}

function roomIdFor(input: {
  protocolEpoch: number;
  mode: NearbyPublicMode;
  basePrecisionMeters: number;
  wideningLevel: number;
  splitGeneration: number;
  cell: NearbyLocalCell;
  laneCount: number;
  laneIndex: number;
}): string {
  const digestParts: Array<string | number> = [
    ROOM_DOMAIN,
    input.protocolEpoch,
    input.mode,
    input.basePrecisionMeters,
  ];
  if (input.wideningLevel > 0) digestParts.push(input.wideningLevel);
  digestParts.push(
    input.splitGeneration,
    input.cell.x,
    input.cell.y,
  );
  const cellDigest = portableSha256Hex(digestParts.join(':')).slice(0, 24);
  const lane = input.laneCount > 1 ? `_l${input.laneIndex + 1}of${input.laneCount}` : '';
  // Keep level-zero IDs byte-for-byte compatible with releases that predate sparse widening.
  const widening = input.wideningLevel > 0 ? `_w${input.wideningLevel}` : '';
  return `nearby_v${NEARBY_ROOM_VERSION}_e${input.protocolEpoch}_p${input.basePrecisionMeters}${widening}_g${input.splitGeneration}_${cellDigest}${lane}`;
}

/**
 * Derive the one automatic Nearby room from local GPS and a verified split generation.
 * The returned `localCell` is intentionally separate from the publishable scope.
 */
export function deriveNearbyRoomAssignment(input: {
  location: GPSCoordinate;
  mode: NearbyPublicMode;
  identity: string;
  requestedSplitGeneration?: number;
  wideningLevel?: number;
  protocolEpoch?: number;
  previous?: NearbyRoomAssignment;
}): NearbyRoomAssignment {
  const requestedSplitGeneration = assertGeneration(input.requestedSplitGeneration ?? 0);
  const wideningLevel = assertWideningLevel(input.wideningLevel ?? 0);
  const protocolEpoch = input.protocolEpoch ?? NEARBY_PROTOCOL_EPOCH;
  if (!Number.isSafeInteger(protocolEpoch) || protocolEpoch < 1) {
    throw new Error('nearby protocol epoch is invalid');
  }
  const identity = String(input.identity || '').trim();
  if (!identity) throw new Error('nearby identity is required');
  const basePrecisionMeters = nearbyBasePrecisionMeters(input.mode);
  const widenedPrecisionMeters = basePrecisionMeters * 2 ** wideningLevel;
  const geographicLimit = maximumGeographicSplitGeneration(
    widenedPrecisionMeters,
    input.location.accuracy,
  );
  const splitGeneration = Math.min(requestedSplitGeneration, geographicLimit);
  const fallbackGenerations = requestedSplitGeneration - splitGeneration;
  const identityLaneCount = Math.min(NEARBY_MAX_IDENTITY_LANES, 2 ** fallbackGenerations);
  const cellSizeMeters = widenedPrecisionMeters / 2 ** splitGeneration;
  const projected = projectNearbyCoordinate(input.location);
  const calculatedCell = cellAt(projected, cellSizeMeters);
  const localCell = canKeepPreviousCell(input.previous, {
    mode: input.mode,
    protocolEpoch,
    wideningLevel,
    splitGeneration,
    projected,
  }) ? input.previous.localCell : calculatedCell;
  const roomSeed = [protocolEpoch, input.mode, basePrecisionMeters, wideningLevel, splitGeneration, localCell.x, localCell.y].join(':');
  const identityLaneIndex = identityLane(identity, roomSeed, identityLaneCount);
  const roomId = roomIdFor({
    protocolEpoch,
    mode: input.mode,
    basePrecisionMeters,
    wideningLevel,
    splitGeneration,
    cell: localCell,
    laneCount: identityLaneCount,
    laneIndex: identityLaneIndex,
  });
  return {
    version: NEARBY_ROOM_VERSION,
    kind: 'nearby',
    roomId,
    mode: input.mode,
    protocolEpoch,
    basePrecisionMeters,
    wideningLevel,
    widenedPrecisionMeters,
    splitGeneration,
    requestedSplitGeneration,
    cellSizeMeters,
    approximateDiameterMeters: Math.round(Math.sqrt(2) * cellSizeMeters),
    identityLaneCount,
    identityLaneIndex,
    localCell,
  };
}

/** Strip the map/grid coordinates before writing presence or discovery metadata. */
export function nearbyPublicScope(assignment: NearbyRoomAssignment): NearbyPublicScope {
  const { localCell: _localCell, ...publicScope } = assignment;
  return publicScope;
}

export function isNearbyRoomId(value: string | null | undefined): boolean {
  return /^nearby_v1_e\d+_p(?:400|1000)(?:_w[1-3])?_g\d+_[a-f0-9]{24}(?:_l\d+of\d+)?$/.test(String(value || ''));
}

export function isLocalOnlyRoomScope(value: string | null | undefined): boolean {
  return value === CONTACTS_ONLY_SCOPE_ID || value === RADIO_NEARBY_SCOPE_ID;
}
