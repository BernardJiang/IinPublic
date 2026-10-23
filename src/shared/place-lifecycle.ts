/**
 * Place lifecycle and creation limits (docs/design/nearby-and-place-chatrooms.md §4.2).
 *
 * A Place is discoverable while someone entered it within the last 30 days and its creator still
 * meets the room-credit bar; only discoverable Places are listed and drawn. The hub refuses a new
 * Place when its creator already has one, when a live Place with the same name sits in the same
 * cell, or when the cell already holds five live Places.
 */
export const PLACE_LIVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_LIVE_PLACES_PER_CELL = 5;
/** `lastActiveAt` is rewritten at most this often per Place, so heartbeats cost no extra writes. */
export const PLACE_ACTIVITY_WRITE_INTERVAL_MS = 60 * 60 * 1000;

export type PlaceLifecycleRow = {
  id: string;
  name?: string;
  anchorCell?: string;
  createdBy?: string;
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

/** Public discovery requires both recent activity and a creator who still clears the credit bar. */
export function isPlaceDiscoverable(
  row: PlaceLifecycleRow,
  creatorCreditEligible: boolean,
  nowMs: number = Date.now(),
): boolean {
  return creatorCreditEligible && isPlaceLive(row, nowMs);
}

/** Same name ignoring case, surrounding spaces and repeated inner spaces. */
export function normalizePlaceName(name: string | undefined): string {
  return String(name || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

/**
 * Which rule, if any, refuses a new Place. `places` holds the existing Place rooms. Every prior
 * Place blocks another from the same creator; only live rows occupy a cell/name slot.
 */
export function findPlaceCreationConflict(
  places: ReadonlyArray<PlaceLifecycleRow>,
  candidate: { creatorPub: string; anchorCell: string; name: string },
  nowMs: number = Date.now(),
): PlaceCreationConflict | null {
  // Creator quota is lifetime, not merely "one currently live". Expiry removes a quiet Place
  // from the public map; it is not a way to mint another immutable descriptor and saturate it.
  const own = places.find((place) => place.creatorPub && place.creatorPub === candidate.creatorPub);
  if (own) return { code: 'PLACE_CREATOR_LIMIT', existingId: own.id, existingName: own.name || own.id };
  const live = places.filter((place) => isPlaceLive(place, nowMs));
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
