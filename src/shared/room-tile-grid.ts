/**
 * Map overlay geometry for the room tile tree (docs/design/room-tree-routing.md): grid lines of the
 * tile layer that matches the map zoom, and tile squares for highlighting. Pure functions over
 * public tile math only — no user coordinates, no borders.
 */
import { parseTileId, tileBounds, tileIdAt, TILE_BOTTOM_LAYER, TILE_LAYER_DEGREES } from './room-tiles';

/** The tile layer whose squares are a sensible size at this map zoom (world → L1 … close → L4). */
export function gridLayerForZoom(zoom: number): number {
  if (zoom < 3) return 1;
  if (zoom < 5) return 2;
  if (zoom < 7) return 3;
  return TILE_BOTTOM_LAYER;
}

export type LngLatBounds = { west: number; south: number; east: number; north: number };

type LineFeature = {
  type: 'Feature';
  properties: Record<string, never>;
  geometry: { type: 'LineString'; coordinates: Array<[number, number]> };
};

export type GridLines = { type: 'FeatureCollection'; features: LineFeature[] };

/** Web-Mercator maps cannot show the poles; keep lines inside the drawable band. */
const MAX_LAT = 85;
/** Never emit more than this many lines (a guard for extreme aspect ratios / zooms). */
const MAX_LINES = 600;

/**
 * Grid lines of `layer` covering `bounds` (slightly padded): one vertical line per column edge and
 * one horizontal line per row edge, so a viewport of N × M tiles costs N + M features, not N · M.
 */
export function tileGridLines(layer: number, bounds: LngLatBounds): GridLines {
  const size = TILE_LAYER_DEGREES[layer];
  const south = Math.max(-MAX_LAT, bounds.south - size);
  const north = Math.min(MAX_LAT, bounds.north + size);
  const west = Math.max(-180, bounds.west - size);
  const east = Math.min(180, bounds.east + size);
  const features: LineFeature[] = [];
  const line = (coordinates: Array<[number, number]>): void => {
    if (features.length < MAX_LINES) features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } });
  };
  for (let lng = -180 + Math.ceil((west + 180) / size) * size; lng <= east + 1e-9; lng += size) {
    line([[lng, south], [lng, north]]);
  }
  for (let lat = -90 + Math.ceil((south + 90) / size) * size; lat <= north + 1e-9; lat += size) {
    line([[west, lat], [east, lat]]);
  }
  return { type: 'FeatureCollection', features };
}

type PolygonFeature = {
  type: 'Feature';
  properties: { tileId: string };
  geometry: { type: 'Polygon'; coordinates: Array<Array<[number, number]>> };
};

export type TileSquares = { type: 'FeatureCollection'; features: PolygonFeature[] };

/** Closed squares for the given tile ids (non-tile ids are skipped). */
export function tileSquares(tileIds: readonly string[]): TileSquares {
  const features: PolygonFeature[] = [];
  for (const tileId of tileIds) {
    const ref = parseTileId(tileId);
    if (!ref) continue;
    const b = tileBounds(ref);
    const south = Math.max(-MAX_LAT, b.south);
    const north = Math.min(MAX_LAT, b.north);
    features.push({
      type: 'Feature',
      properties: { tileId },
      geometry: { type: 'Polygon', coordinates: [[[b.west, south], [b.east, south], [b.east, north], [b.west, north], [b.west, south]]] },
    });
  }
  return { type: 'FeatureCollection', features };
}

/** The tile of the layer shown at `zoom` that contains the tapped point. */
export function tileAtTap(latitude: number, longitude: number, zoom: number): string {
  return tileIdAt(gridLayerForZoom(zoom), latitude, longitude);
}
