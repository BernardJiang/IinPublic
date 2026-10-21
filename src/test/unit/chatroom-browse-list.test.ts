/**
 * The tile grid (45° L1 squares, labeled by continent, down to L4) that Places hang under, and tile
 * titles. Countries, states and cities are never offered (no national borders in the UI).
 */
import { resolveChatroomTitle } from '../../web/ui/chatrooms-view';
import { getL1Tiles, parseTileId, tileCenter, tileIdAt } from '../../shared/room-tiles';


describe('room tiles', () => {
  it('maps points to deterministic tile ids at every layer, including the edges', () => {
    expect(tileIdAt(1, 32.7, -117.2)).toBe('tile_1_2_1');
    expect(tileIdAt(4, 32.7, -117.2)).toBe('tile_4_174_89');
    expect(tileIdAt(1, 90, 180)).toBe('tile_1_3_0'); // lat clamps; lng 180 wraps to -180
    expect(tileIdAt(1, -90, -180)).toBe('tile_1_0_0');
    expect(parseTileId('tile_1_3_7')).toEqual({ layer: 1, row: 3, col: 7 });
    expect(parseTileId('tile_1_4_0')).toBeNull();
    expect(tileCenter({ layer: 1, row: 2, col: 1 })).toEqual({ latitude: 22.5, longitude: -112.5 });
  });

  it('labels all 32 L1 tiles by continent / ocean, never by a country', () => {
    const tiles = getL1Tiles();
    expect(tiles).toHaveLength(32);
    expect(tiles.find((t) => t.id === 'tile_1_2_1')?.name).toBe('North America · West & Central');
    expect(tiles.find((t) => t.id === 'tile_1_2_0')?.name).toBe('North Pacific');
    expect(tiles.find((t) => t.id === 'tile_1_0_4')?.name).toBe('Antarctica');
    const countryWords = /\b(United States|USA|Canada|Mexico|China|Japan|Taiwan|Russia|Ukraine|India|Israel|Palestine|Germany|France|Brazil|Korea)\b/i;
    for (const tile of tiles) expect(tile.name).not.toMatch(countryWords);
  });

  it('pins every tile inside its own square and groups tiles by continent', () => {
    for (const tile of getL1Tiles()) {
      expect(tileIdAt(1, tile.pin.latitude, tile.pin.longitude)).toBe(tile.id);
    }
    const order = getL1Tiles().map((t) => t.continentId ?? 'none');
    const firstSeen = [...new Set(order)];
    expect(firstSeen).toEqual(['north-america', 'south-america', 'europe', 'africa', 'asia', 'oceania', 'none']);
    // Each continent's tiles are contiguous.
    expect(firstSeen.length).toBe(order.filter((c, i) => i === 0 || c !== order[i - 1]).length);
  });
});

describe('room browse tree', () => {
  it('titles tile rooms by their label', () => {
    expect(resolveChatroomTitle('tile_1_3_3', [])).toBe('🇪🇺 Europe · North Atlantic');
  });
});
