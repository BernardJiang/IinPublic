/**
 * Custom ("place") rooms are LOCAL: each is anchored to the creator's blurred ~1 km GPS cell and
 * lives in the tile tree under that cell's bottom-layer (L4, ~78 km) tile, so eviction and
 * promotion walk it like any other room (docs/design/local-business-rooms.md §3).
 *
 * The anchor is part of the id — `place_<cellLat>_<cellLng>_<hash>` — so every peer derives the
 * room's place in the tree from the id alone. The cell is the already-blurred privacy grid
 * (`LocationPrivacy.blurLocation`), never an exact position.
 */
import { tileIdAt, TILE_BOTTOM_LAYER } from './room-tiles';

const NUM = '-?\\d{1,3}(?:\\.\\d{1,2})?';
const PLACE_ID = new RegExp(`^place_(${NUM})_(${NUM})_([0-9a-f]{12,40})$`);
const CONTENT_ADDRESSED_PLACE_ID = /^place_b[a-z2-7]{50,}$/;
const CELL_ID = new RegExp(`^region_(${NUM})_(${NUM})(?:_room_\\d+)?$`);

export type PlaceAnchor = { latitude: number; longitude: number; cellId: string };

function anchorFrom(lat: string, lng: string): PlaceAnchor | null {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude, cellId: `region_${lat}_${lng}` };
}

/** A blurred cell id (`region_<lat>_<lng>`, optional `_room_N` lane) → its anchor, or null. */
export function parseAnchorCell(cellId: string): PlaceAnchor | null {
  const match = CELL_ID.exec(String(cellId || ''));
  return match ? anchorFrom(match[1], match[2]) : null;
}

/** The anchor cell of a place room id, or null for any other id (legacy `room_*`, tiles, …). */
export function placeRoomAnchor(roomId: string): PlaceAnchor | null {
  const match = PLACE_ID.exec(String(roomId || ''));
  return match ? anchorFrom(match[1], match[2]) : null;
}

export function isPlaceRoomId(roomId: string): boolean {
  return CONTENT_ADDRESSED_PLACE_ID.test(String(roomId || '')) || placeRoomAnchor(roomId) !== null;
}

/** The L4 (~78 km) tile a place room lives under in the tree. */
export function placeRoomTile(roomId: string): string | null {
  const anchor = placeRoomAnchor(roomId);
  return anchor ? tileIdAt(TILE_BOTTOM_LAYER, anchor.latitude, anchor.longitude) : null;
}

/** `place_<lat>_<lng>_<hash>` for an anchor cell and a hex digest (first 24 hex chars kept). */
export function placeRoomId(anchor: PlaceAnchor, hexDigest: string): string {
  const [, lat, lng] = /^region_(.+)_(.+)$/.exec(anchor.cellId)!;
  return `place_${lat}_${lng}_${hexDigest.toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 24)}`;
}
