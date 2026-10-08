/**
 * Geometric room tiles (docs/design/room-tree-routing.md): pure latitude/longitude squares, so no
 * room ever follows a national border. Each tile has 16 children (4 × 4):
 *
 *   L0 Global · L1 45° · L2 11.25° · L3 2.8125° · L4 0.703125° (~78 km, the bottom layer)
 *
 * L1 tiles are labeled by the continent at the tile ("🌎 North America · Northwest"); ocean tiles
 * by ocean, the polar row Antarctica. Labels are display only — ids are `tile_<layer>_<row>_<col>`.
 */

export const TILE_LAYER_DEGREES = [360, 45, 11.25, 2.8125, 0.703125] as const;
export const TILE_BOTTOM_LAYER = 4;

const TILE_ID = /^tile_([1-4])_(\d+)_(\d+)$/;

export type TileRef = { layer: number; row: number; col: number };

export function tileIdAt(layer: number, latitude: number, longitude: number): string {
  const size = TILE_LAYER_DEGREES[layer];
  const rows = Math.round(180 / size);
  const cols = Math.round(360 / size);
  const row = Math.min(rows - 1, Math.max(0, Math.floor((latitude + 90) / size)));
  const col = ((Math.floor((longitude + 180) / size) % cols) + cols) % cols;
  return `tile_${layer}_${row}_${col}`;
}

export function parseTileId(id: string): TileRef | null {
  const match = TILE_ID.exec(id);
  if (!match) return null;
  const layer = Number(match[1]);
  const row = Number(match[2]);
  const col = Number(match[3]);
  const size = TILE_LAYER_DEGREES[layer];
  if (row >= Math.round(180 / size) || col >= Math.round(360 / size)) return null;
  return { layer, row, col };
}

export function tileCenter(ref: TileRef): { latitude: number; longitude: number } {
  const size = TILE_LAYER_DEGREES[ref.layer];
  return { latitude: -90 + size * (ref.row + 0.5), longitude: -180 + size * (ref.col + 0.5) };
}

export type L1TileInfo = {
  id: string;
  /** Continent the label refers to, or null for ocean/Antarctica tiles. */
  continentId: string | null;
  name: string;
  icon: string;
  pin: { latitude: number; longitude: number };
};

/** Browse order: tiles grouped by continent, then ocean/Antarctica. */
const CONTINENT_ORDER = ['north-america', 'south-america', 'europe', 'africa', 'asia', 'oceania'];

/**
 * Hand-checked labels for the 32 L1 tiles, keyed `row_col` (row 3 = 45°N–90°N … row 0 = 90°S–45°S;
 * col 0 = 180°W–135°W … col 7 = 135°E–180°E). Labels name the continent or a neutral geographic
 * region covering most of the tile's land — never a country or state. The continent bounding boxes
 * in location-to-chatroom.ts are too coarse for this (e.g. they call the South Atlantic "Africa").
 */
type L1Label = {
  continentId: string | null;
  name: string;
  icon: string;
  /** Map pin on the tile's own land (a tile centre can be open ocean or Antarctica). */
  pin?: { latitude: number; longitude: number };
};

const L1_TILE_LABELS: Record<string, L1Label> = {
  '3_0': { continentId: 'north-america', name: 'North America · Far Northwest', icon: '🌎', pin: { latitude: 61, longitude: -150 } },
  '3_1': { continentId: 'north-america', name: 'North America · Northwest', icon: '🌎', pin: { latitude: 52, longitude: -114 } },
  '3_2': { continentId: 'north-america', name: 'North America · Northeast', icon: '🌎', pin: { latitude: 50, longitude: -75 } },
  '3_3': { continentId: 'europe', name: 'Europe · North Atlantic', icon: '🇪🇺', pin: { latitude: 53, longitude: -5 } },
  '3_4': { continentId: 'europe', name: 'Europe · Mainland', icon: '🇪🇺', pin: { latitude: 51, longitude: 15 } },
  '3_5': { continentId: 'asia', name: 'Asia · Northwest', icon: '🌏', pin: { latitude: 52, longitude: 68 } },
  '3_6': { continentId: 'asia', name: 'Asia · North', icon: '🌏', pin: { latitude: 55, longitude: 105 } },
  '3_7': { continentId: 'asia', name: 'Asia · Northeast', icon: '🌏', pin: { latitude: 50, longitude: 140 } },
  '2_0': { continentId: null, name: 'North Pacific', icon: '🌊' },
  '2_1': { continentId: 'north-america', name: 'North America · West & Central', icon: '🌎', pin: { latitude: 32, longitude: -110 } },
  '2_2': { continentId: 'north-america', name: 'Americas · East & Caribbean', icon: '🌎', pin: { latitude: 35, longitude: -80 } },
  '2_3': { continentId: 'africa', name: 'Iberia & West Africa', icon: '🌍', pin: { latitude: 30, longitude: -8 } },
  '2_4': { continentId: 'africa', name: 'Mediterranean, Middle East & Africa · North', icon: '🌍', pin: { latitude: 28, longitude: 25 } },
  '2_5': { continentId: 'asia', name: 'Asia · South & West', icon: '🌏', pin: { latitude: 25, longitude: 72 } },
  '2_6': { continentId: 'asia', name: 'Asia · East & Southeast', icon: '🌏', pin: { latitude: 30, longitude: 112 } },
  '2_7': { continentId: 'asia', name: 'Asia · Pacific', icon: '🌏', pin: { latitude: 36, longitude: 139 } },
  '1_0': { continentId: null, name: 'South Pacific · West', icon: '🌊' },
  '1_1': { continentId: null, name: 'South Pacific · East', icon: '🌊' },
  '1_2': { continentId: 'south-america', name: 'South America', icon: '🌎', pin: { latitude: -20, longitude: -60 } },
  '1_3': { continentId: 'south-america', name: 'South America · Atlantic Coast', icon: '🌎', pin: { latitude: -12, longitude: -40 } },
  '1_4': { continentId: 'africa', name: 'Africa · Central & South', icon: '🌍', pin: { latitude: -15, longitude: 25 } },
  '1_5': { continentId: 'africa', name: 'Africa · Southeast & Indian Ocean', icon: '🌍', pin: { latitude: -20, longitude: 47 } },
  '1_6': { continentId: 'oceania', name: 'Southeast Asia & Oceania · West', icon: '🌏', pin: { latitude: -15, longitude: 118 } },
  '1_7': { continentId: 'oceania', name: 'Oceania · East', icon: '🌏', pin: { latitude: -28, longitude: 148 } },
  '0_2': { continentId: 'south-america', name: 'South America · Patagonia', icon: '🌎', pin: { latitude: -48, longitude: -70 } },
  '0_7': { continentId: 'oceania', name: 'Oceania · Southern', icon: '🌏', pin: { latitude: -46, longitude: 168 } },
};

let l1TilesCache: L1TileInfo[] | null = null;

/** All 32 L1 tiles, grouped by continent (north→south, west→east within each), oceans last. */
export function getL1Tiles(): L1TileInfo[] {
  if (l1TilesCache) return l1TilesCache;
  const tiles: Array<L1TileInfo & { row: number; col: number }> = [];
  for (let row = 3; row >= 0; row--) {
    for (let col = 0; col < 8; col++) {
      const label: L1Label = L1_TILE_LABELS[`${row}_${col}`] ?? { continentId: null, name: 'Antarctica', icon: '🧊' };
      tiles.push({
        id: `tile_1_${row}_${col}`,
        continentId: label.continentId,
        name: label.name,
        icon: label.icon,
        pin: label.pin ?? tileCenter({ layer: 1, row, col }),
        row,
        col,
      });
    }
  }
  const rank = (tile: L1TileInfo): number => {
    const index = tile.continentId ? CONTINENT_ORDER.indexOf(tile.continentId) : -1;
    return index >= 0 ? index : CONTINENT_ORDER.length;
  };
  tiles.sort((a, b) => rank(a) - rank(b) || b.row - a.row || a.col - b.col);
  l1TilesCache = tiles.map(({ row: _row, col: _col, ...tile }) => tile);
  return l1TilesCache;
}

/** L1 tiles with a continent (inhabited land); ocean and Antarctica tiles are listed only when in use. */
export function isLandL1Tile(tile: L1TileInfo): boolean {
  return tile.continentId !== null;
}

export function getL1TileInfo(id: string): L1TileInfo | undefined {
  return getL1Tiles().find((tile) => tile.id === id);
}

/** Parent tile id (16 children per tile: rows and columns divide by 4), or null for an L1 tile. */
export function parentTileId(id: string): string | null {
  const ref = parseTileId(id);
  if (!ref || ref.layer <= 1) return null;
  return `tile_${ref.layer - 1}_${Math.floor(ref.row / 4)}_${Math.floor(ref.col / 4)}`;
}

/** The tile's ancestors from L1 down to the tile itself (`[L1, …, id]`), or [] for a non-tile id. */
export function tileLineage(id: string): string[] {
  if (!parseTileId(id)) return [];
  const chain: string[] = [id];
  for (let parent = parentTileId(id); parent; parent = parentTileId(parent)) chain.unshift(parent);
  return chain;
}

/** The tile at `layer` that contains tile `id` (itself when `layer` equals its layer), or null. */
export function tileAncestorAt(id: string, layer: number): string | null {
  const ref = parseTileId(id);
  if (!ref || layer < 1 || layer > ref.layer) return null;
  return tileLineage(id)[layer - 1] ?? null;
}

/** `[min, max)` latitude/longitude bounds of a tile. */
export function tileBounds(ref: TileRef): { south: number; north: number; west: number; east: number } {
  const size = TILE_LAYER_DEGREES[ref.layer];
  const south = -90 + size * ref.row;
  const west = -180 + size * ref.col;
  return { south, north: south + size, west, east: west + size };
}
