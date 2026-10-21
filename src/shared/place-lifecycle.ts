/**
 * Place lifecycle and creation limits (docs/design/nearby-and-place-chatrooms.md §4.2).
 *
 * A Place is live while someone entered it within the last 30 days; only live Places are listed
 * and drawn. The hub refuses a new Place when its creator already has a live one, when a live
 * Place with the same name sits in the same cell, or when the cell already holds five live Places.
 */
export const PLACE_LIVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_LIVE_PLACES_PER_CELL = 5;
/** `lastActiveAt` is rewritten at most this often per Place, so heartbeats cost no extra writes. */
export const PLACE_ACTIVITY_WRITE_INTERVAL_MS = 60 * 60 * 1000;

export type PlaceLifecycleRow = {
  id: string;
  name?: string;
  anchorCell?: string;
  creatorPub?: string;
  createdAt?: string;
  lastActiveAt?: string;
};

export type PlaceCreationConflictCode = 'PLACE_CREATOR_LIMIT' | 'PLACE_NAME_TAKEN' | 'PLACE_CELL_FULL';

export type PlaceCreationConflict = {
  code: PlaceCreationConflictCode;
  /** The live Place that blocks creation (absent for a full cell). */
  existingId?: string;
  existingName?: string;
};

function timeOf(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

/** The later of creation and the last recorded entry. */
export function placeLastActiveMs(row: PlaceLifecycleRow): number {
  return Math.max(timeOf(row.createdAt), timeOf(row.lastActiveAt));
}

export function isPlaceLive(row: PlaceLifecycleRow, nowMs: number = Date.now()): boolean {
  return nowMs - placeLastActiveMs(row) <= PLACE_LIVE_WINDOW_MS;
}

/** Same name ignoring case, surrounding spaces and repeated inner spaces. */
export function normalizePlaceName(name: string | undefined): string {
  return String(name || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

/**
 * Which rule, if any, refuses a new Place. `places` holds the existing Place rooms; rows that are
 * not live are ignored, so an expired Place never blocks its creator or its cell.
 */
export function findPlaceCreationConflict(
  places: ReadonlyArray<PlaceLifecycleRow>,
  candidate: { creatorPub: string; anchorCell: string; name: string },
  nowMs: number = Date.now(),
): PlaceCreationConflict | null {
  const live = places.filter((place) => isPlaceLive(place, nowMs));
  const own = live.find((place) => place.creatorPub && place.creatorPub === candidate.creatorPub);
  if (own) return { code: 'PLACE_CREATOR_LIMIT', existingId: own.id, existingName: own.name || own.id };
  const inCell = live.filter((place) => place.anchorCell === candidate.anchorCell);
  const wanted = normalizePlaceName(candidate.name);
  const sameName = inCell.find((place) => normalizePlaceName(place.name) === wanted);
  if (sameName) return { code: 'PLACE_NAME_TAKEN', existingId: sameName.id, existingName: sameName.name || sameName.id };
  if (inCell.length >= MAX_LIVE_PLACES_PER_CELL) return { code: 'PLACE_CELL_FULL' };
  return null;
}

/** Hub-side error carrying the conflict, answered as HTTP 409. */
export class PlaceCreationConflictError extends Error {
  readonly conflict: PlaceCreationConflict;

  constructor(conflict: PlaceCreationConflict) {
    super(conflict.code);
    this.name = 'PlaceCreationConflictError';
    this.conflict = conflict;
  }
}
