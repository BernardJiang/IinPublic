/**
 * The room tree is Global → L1 tiles (45° squares, labeled by continent) → GPS grid rooms.
 * Countries, states and cities are never offered (no national borders in the UI).
 */
import { buildBrowseTree, getBrowsableBuiltInChatrooms, l1TileForGridRoom, resolveChatroomTitle } from '../../web/ui/chatrooms-view';
import { getL1Tiles, parseTileId, tileCenter, tileIdAt } from '../../shared/room-tiles';

const SAN_DIEGO_GRID = 'region_32.71_-117.17_room_0';
const HONOLULU_GRID = 'region_21.31_-157.86_room_0';

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
  it('offers Global plus the land L1 tiles only', () => {
    const rooms = getBrowsableBuiltInChatrooms();
    expect(rooms[0]).toMatchObject({ id: 'global', level: 0 });
    expect(rooms.slice(1).every((room) => room.level === 1 && room.id.startsWith('tile_1_'))).toBe(true);
    expect(rooms.some((room) => ['north-america', 'usa', 'california', 'san-diego', 'japan'].includes(room.id))).toBe(false);
    expect(rooms.some((room) => room.name === 'Antarctica' || room.name.includes('Pacific ·'))).toBe(false);
  });

  it('nests a grid room under its L1 tile, titled by city', () => {
    expect(l1TileForGridRoom(SAN_DIEGO_GRID)).toBe('tile_1_2_1');
    const tree = buildBrowseTree([SAN_DIEGO_GRID]);
    const i = tree.findIndex((room) => room.id === 'tile_1_2_1');
    expect(tree[i]).toMatchObject({ level: 1, parentId: 'global', hasChildren: true });
    expect(tree[i + 1]).toMatchObject({ id: SAN_DIEGO_GRID, level: 2, parentId: 'tile_1_2_1', name: 'Near San Diego', icon: '📍' });
  });

  it('shows an ocean tile only when it holds the grid room', () => {
    expect(buildBrowseTree([]).some((room) => room.id === 'tile_1_2_0')).toBe(false);
    const tree = buildBrowseTree([HONOLULU_GRID]);
    const i = tree.findIndex((room) => room.id === 'tile_1_2_0');
    expect(tree[i]).toMatchObject({ name: 'North Pacific', hasChildren: true });
    expect(tree[i + 1]).toMatchObject({ id: HONOLULU_GRID, level: 2 });
  });

  it('titles tile rooms by their label', () => {
    expect(resolveChatroomTitle('tile_1_3_3', [])).toBe('🇪🇺 Europe · North Atlantic');
  });
});
