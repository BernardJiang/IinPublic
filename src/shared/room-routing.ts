/**
 * Two-way room routing over the tile tree (docs/design/room-tree-routing.md §3–§5).
 *
 *  Down (overflow): the oldest member of a full room moves ONE layer down — Global → L1 tile →
 *  … → L4 tile — toward their own position (GPS) or their chosen home tile (no GPS). Rooms with no
 *  child for that user (L4 tiles, the home tile itself, custom rooms, `_part_N` rooms, the
 *  non-geographic Global overflow) split into their own `_part_N` family instead.
 *
 *  Up (underflow): a member of a thinly populated room moves to the room above it when that room
 *  has headroom — unless an eviction cooldown says they were pushed out of it recently (loop guard).
 *
 * Pure functions only; the capacity controller supplies live counts, clock and storage.
 */
import { CONFIG } from './config';
import { splitBaseId, splitIndex, splitRoomId } from './chatroom-split';
import { parentTileId, parseTileId, tileAncestorAt, tileIdAt, TILE_BOTTOM_LAYER } from './room-tiles';

/** How the user is anchored for routing: a confirmed GPS position, a chosen home tile, or neither. */
export type RoutingAnchor =
  | { kind: 'position'; latitude: number; longitude: number }
  | { kind: 'home-tile'; tileId: string }
  | { kind: 'none' };

const COARSE_CELL_ID = /^region_(-?\d+(?:\.\d+)?)_(-?\d+(?:\.\d+)?)(?:_room_\d+)?$/;

/** Where the oldest overflow member of `roomId` goes: a child room, or `split` (own `_part_N` family). */
export function evictionDestination(roomId: string, anchor: RoutingAnchor): { kind: 'room'; roomId: string } | { kind: 'split' } {
  if (splitIndex(roomId) > 1) return { kind: 'split' };
  if (roomId === CONFIG.GLOBAL_CHATROOM_ID) {
    const child = childTileToward(0, anchor);
    return { kind: 'room', roomId: child ?? CONFIG.GLOBAL_UNKNOWN_CHATROOM_ID };
  }
  const ref = parseTileId(roomId);
  if (ref && ref.layer < TILE_BOTTOM_LAYER) {
    const child = childTileToward(ref.layer, anchor);
    // Only descend inside this tile: a traveller whose position lies elsewhere splits in place.
    if (child && parentTileId(child) === roomId) return { kind: 'room', roomId: child };
  }
  return { kind: 'split' };
}

/** The tile at `layer + 1` toward the anchor, or null when the anchor stops above that layer. */
function childTileToward(layer: number, anchor: RoutingAnchor): string | null {
  const next = layer + 1;
  if (next > TILE_BOTTOM_LAYER) return null;
  if (anchor.kind === 'position') return tileIdAt(next, anchor.latitude, anchor.longitude);
  if (anchor.kind === 'home-tile') return tileAncestorAt(anchor.tileId, next);
  return null;
}

/**
 * The room one step "up" from `roomId`, or null when there is none to move to automatically:
 * `_part_N` → `_part_(N−1)` (or the base), tile → parent tile (L1 → Global), Global overflow →
 * Global, a legacy 1 km grid room → its L4 tile. Global and custom base rooms have no automatic
 * step up (a custom room is the user's own choice).
 */
export function promotionTarget(roomId: string): string | null {
  const index = splitIndex(roomId);
  if (index > 1) return splitRoomId(splitBaseId(roomId), index - 1);
  if (roomId === CONFIG.GLOBAL_UNKNOWN_CHATROOM_ID) return CONFIG.GLOBAL_CHATROOM_ID;
  const ref = parseTileId(roomId);
  if (ref) return ref.layer === 1 ? CONFIG.GLOBAL_CHATROOM_ID : parentTileId(roomId);
  const cell = COARSE_CELL_ID.exec(roomId);
  if (cell) return tileIdAt(TILE_BOTTOM_LAYER, Number(cell[1]), Number(cell[2]));
  return null;
}

/**
 * True when `upper` is `room` itself or lies above it on the way up (repeated `promotionTarget`).
 * Used by the cooldown: an eviction from X blocks promotion into X and everything above X.
 */
export function isSelfOrAbove(upper: string, room: string): boolean {
  for (let at: string | null = room, guard = 0; at && guard < 64; at = promotionTarget(at), guard++) {
    if (at === upper) return true;
  }
  return false;
}

export type EvictionRecord = { room: string; at: number };

export const EVICTION_HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const EVICTION_COOLDOWN_CAP_MS = 4 * 60 * 60 * 1000;

/** Keep only the last 24 h (bounded list). */
export function pruneEvictionHistory(history: readonly EvictionRecord[], now: number): EvictionRecord[] {
  return history
    .filter((record) => record && typeof record.room === 'string' && Number.isFinite(record.at) && now - record.at < EVICTION_HISTORY_WINDOW_MS && record.at <= now + 60_000)
    .slice(-50);
}

/**
 * When promotion into `target` becomes allowed again (ms epoch), or 0 when it is allowed now.
 * Each room the user was evicted from in the last 24 h, at or below `target`, imposes
 * `base · 2^(n−1)` after its latest eviction (n = evictions from that room), capped at 4 h.
 */
export function promotionBlockedUntil(
  target: string,
  history: readonly EvictionRecord[],
  now: number,
  baseCooldownMs: number,
): number {
  const recent = pruneEvictionHistory(history, now);
  let until = 0;
  const rooms = new Set(recent.map((record) => record.room));
  for (const room of rooms) {
    if (!isSelfOrAbove(target, room)) continue;
    const fromRoom = recent.filter((record) => record.room === room);
    const latest = Math.max(...fromRoom.map((record) => record.at));
    const cooldown = Math.min(EVICTION_COOLDOWN_CAP_MS, baseCooldownMs * 2 ** (fromRoom.length - 1));
    until = Math.max(until, latest + cooldown);
  }
  return until > now ? until : 0;
}

/** Promotion needs headroom above: the room above holds at most `C − H` (H = 10% of C, at least 1). */
export function promotionHeadroom(capacity: number): number {
  return Math.max(1, Math.ceil(capacity * 0.1));
}

export function parentHasHeadroom(parentCount: number, capacity: number): boolean {
  return parentCount <= capacity - promotionHeadroom(capacity);
}

/** Fewer than this many OTHER members means the room is too thin and the user should move up. */
export const PROMOTE_BELOW_OTHERS = 2;
