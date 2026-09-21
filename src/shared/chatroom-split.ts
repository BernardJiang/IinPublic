/**
 * Numbered overflow rooms ("split" rooms) for rooms that have no child room to push people into:
 * custom/business rooms and the deepest regional room. `sport-arena` overflows into
 * `sport-arena_part_2`, then `_part_3`, and so on, so no room ever exceeds the unified capacity.
 * The id is a pure function of (base id, number), so every peer derives the same rooms.
 */

const SPLIT_SUFFIX = /_part_(\d+)$/;

/** Path of the hint record: highest numbered room opened so far for a base room. */
export const SPLIT_FRONTIER_PATH = 'chatroomSplitFrontier';

/** A frontier hint older than this is ignored (an old burst must not steer newcomers forever). */
export const SPLIT_FRONTIER_FRESH_MS = 10 * 60 * 1000;

export interface SplitFrontierRecord {
  index: number;
  at: string;
}

/** `sport-arena_part_3` -> `sport-arena`; a base id is returned unchanged. */
export function splitBaseId(roomId: string): string {
  return roomId.replace(SPLIT_SUFFIX, '');
}

/** 1 for the base room, N for `_part_N`. */
export function splitIndex(roomId: string): number {
  const match = SPLIT_SUFFIX.exec(roomId);
  return match ? Math.max(1, Number(match[1])) : 1;
}

/** Room id for number `index` of `baseId` (1 is the base room itself). */
export function splitRoomId(baseId: string, index: number): string {
  return index <= 1 ? baseId : `${baseId}_part_${Math.floor(index)}`;
}

/** The room a newcomer overflows into: at least the next number, or further if a frontier says so. */
export function nextSplitRoomId(roomId: string, minIndex = 0): string {
  return splitRoomId(splitBaseId(roomId), Math.max(splitIndex(roomId) + 1, minIndex));
}

/** The frontier index to honour, or 0 when the record is missing, malformed or stale. */
export function freshFrontierIndex(record: Partial<SplitFrontierRecord> | null | undefined, nowMs: number): number {
  const index = Number(record?.index);
  const at = Date.parse(String(record?.at ?? ''));
  if (!Number.isInteger(index) || index < 2 || !Number.isFinite(at)) return 0;
  return nowMs - at <= SPLIT_FRONTIER_FRESH_MS ? index : 0;
}
