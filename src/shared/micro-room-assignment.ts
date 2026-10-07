import { portableSha256Hex } from './portable-sha256';

const MICRO_ROOM_DOMAIN = 'iinpublic:micro-room:v1';

export const MICRO_ROOM_MAX_LANE_COUNT = 1_048_576;

/** Keep deterministic-hash lanes comfortably below C so ordinary distribution skew has room. */
export const MICRO_ROOM_TARGET_LOAD = 0.75;

export interface MicroRoomAssignment {
  laneCount: number;
  splitGeneration: number;
  laneIndex: number;
  roomId: string;
}

function nextPowerOfTwo(value: number): number {
  let out = 1;
  while (out < value && out < MICRO_ROOM_MAX_LANE_COUNT) out *= 2;
  return out;
}

/**
 * Pure sizing rule. A room remains unsplit through C; once it overflows, new lane generations
 * retain 25% headroom and use powers of two so every peer derives the same bounded plan.
 * Population is an observed control-plane input, never an authorization fact.
 */
export function recommendedMicroRoomLaneCount(observedPopulation: number, capacity: number): number {
  const population = Math.max(0, Math.floor(observedPopulation));
  const safeCapacity = Math.max(1, Math.floor(capacity));
  if (population <= safeCapacity) return 1;
  const targetPerLane = Math.max(1, Math.floor(safeCapacity * MICRO_ROOM_TARGET_LOAD));
  return nextPowerOfTwo(Math.ceil(population / targetPerLane));
}

export function microRoomSplitGeneration(laneCount: number): number {
  const lanes = Math.max(1, Math.floor(laneCount));
  if ((lanes & (lanes - 1)) !== 0) throw new Error('micro-room lane count must be a power of two');
  return Math.round(Math.log2(lanes));
}

/** Stable identity-to-lane mapping for one grid and split generation. */
export function microRoomLaneIndex(
  identity: string,
  baseGridRoomId: string,
  laneCount: number,
): number {
  const lanes = Math.max(1, Math.floor(laneCount));
  if ((lanes & (lanes - 1)) !== 0) throw new Error('micro-room lane count must be a power of two');
  const digest = portableSha256Hex(`${MICRO_ROOM_DOMAIN}:lane:${baseGridRoomId}:${identity}`);
  // Twelve hex digits fit safely in JavaScript's exact integer range.
  return Number.parseInt(digest.slice(0, 12), 16) % lanes;
}

/** Coordinate-free public ID; the blurred grid remains an input but is not printed in the ID. */
export function microRoomId(baseGridRoomId: string, laneCount: number, laneIndex: number): string {
  const generation = microRoomSplitGeneration(laneCount);
  const lane = Math.floor(laneIndex);
  if (lane < 0 || lane >= laneCount) throw new Error('micro-room lane index is out of range');
  const gridHash = portableSha256Hex(`${MICRO_ROOM_DOMAIN}:grid:${baseGridRoomId}`).slice(0, 24);
  return `grid_${gridHash}_g${generation}_lane_${lane + 1}`;
}

/** Generation zero retains the existing blurred-grid room; later generations use hashed IDs. */
export function microRoomRoomIdForLane(
  baseGridRoomId: string,
  splitGeneration: number,
  laneIndex: number,
): string {
  if (!Number.isSafeInteger(splitGeneration) || splitGeneration < 0 || splitGeneration > 20) {
    throw new Error('micro-room split generation is out of range');
  }
  const laneCount = 2 ** splitGeneration;
  if (!Number.isSafeInteger(laneIndex) || laneIndex < 0 || laneIndex >= laneCount) {
    throw new Error('micro-room lane index is out of range');
  }
  return splitGeneration === 0 ? baseGridRoomId : microRoomId(baseGridRoomId, laneCount, laneIndex);
}

/** Coordinate-free rendezvous scope used only for bounded split-control records, never Talks. */
export function microRoomControlScopeId(baseGridRoomId: string): string {
  if (!String(baseGridRoomId || '').trim()) throw new Error('micro-room base grid is required');
  const gridHash = portableSha256Hex(`${MICRO_ROOM_DOMAIN}:grid:${baseGridRoomId}`).slice(0, 24);
  return `grid_${gridHash}_control_v1`;
}

export function microRoomBelongsToBase(roomId: string, baseGridRoomId: string): boolean {
  if (roomId === baseGridRoomId) return true;
  const prefix = microRoomControlScopeId(baseGridRoomId).replace(/_control_v1$/, '');
  return roomId.startsWith(`${prefix}_g`);
}

export function microRoomGenerationForRoom(roomId: string, baseGridRoomId: string): number | null {
  if (roomId === baseGridRoomId) return 0;
  const prefix = microRoomControlScopeId(baseGridRoomId).replace(/_control_v1$/, '');
  const match = new RegExp(`^${prefix}_g(\\d+)_lane_\\d+$`).exec(roomId);
  if (!match) return null;
  const generation = Number(match[1]);
  return Number.isSafeInteger(generation) && generation >= 0 && generation <= 20
    ? generation
    : null;
}

/** Assign from an already verified monotone split generation without trusting a headcount claim. */
export function assignMicroRoomForGeneration(
  identity: string,
  baseGridRoomId: string,
  splitGeneration: number,
): MicroRoomAssignment {
  if (!String(identity || '').trim()) throw new Error('micro-room identity is required');
  if (!String(baseGridRoomId || '').trim()) throw new Error('micro-room base grid is required');
  if (!Number.isSafeInteger(splitGeneration) || splitGeneration < 0 || splitGeneration > 20) {
    throw new Error('micro-room split generation is out of range');
  }
  const laneCount = 2 ** splitGeneration;
  const laneIndex = microRoomLaneIndex(identity, baseGridRoomId, laneCount);
  return {
    laneCount,
    splitGeneration,
    laneIndex,
    roomId: microRoomRoomIdForLane(baseGridRoomId, splitGeneration, laneIndex),
  };
}

export function assignMicroRoom(
  identity: string,
  baseGridRoomId: string,
  observedPopulation: number,
  capacity: number,
): MicroRoomAssignment {
  if (!String(identity || '').trim()) throw new Error('micro-room identity is required');
  if (!String(baseGridRoomId || '').trim()) throw new Error('micro-room base grid is required');
  const laneCount = recommendedMicroRoomLaneCount(observedPopulation, capacity);
  const splitGeneration = microRoomSplitGeneration(laneCount);
  const laneIndex = microRoomLaneIndex(identity, baseGridRoomId, laneCount);
  return {
    laneCount,
    splitGeneration,
    laneIndex,
    roomId: microRoomRoomIdForLane(baseGridRoomId, splitGeneration, laneIndex),
  };
}
