import type { PublicLocation } from './public-location';

/**
 * The map's people layer (§3.7 "Map, list and headcounts"): green dots are my Nearby list (their
 * cards' public snapped points), the heat layer is the hub's anonymous count per pyramid cell.
 */

/** One person on my list, as the map draws them: no keys, no proofs. */
export type MapPresenceDot = PublicLocation & { userId: string; traveler: boolean };

/** Anonymous headcount for one square of the viewed area (heat-map input). */
export type MapDensityCell = { latitude: number; longitude: number; count: number };

export type MapBounds = { west: number; south: number; east: number; north: number };

export function parseMapBounds(query: Record<string, unknown>): MapBounds | null {
  const bounds = {
    west: Number(query.west),
    south: Number(query.south),
    east: Number(query.east),
    north: Number(query.north),
  };
  if (![bounds.west, bounds.east].every((value) => Number.isFinite(value) && Math.abs(value) <= 180)
    || ![bounds.south, bounds.north].every((value) => Number.isFinite(value) && Math.abs(value) <= 90)
    || bounds.south > bounds.north) return null;
  return bounds;
}

/** `west > east` means the view crosses the antimeridian. */
export function boundsContain(bounds: MapBounds, point: { latitude: number; longitude: number }): boolean {
  if (point.latitude < bounds.south || point.latitude > bounds.north) return false;
  return bounds.west <= bounds.east
    ? point.longitude >= bounds.west && point.longitude <= bounds.east
    : point.longitude >= bounds.west || point.longitude <= bounds.east;
}
