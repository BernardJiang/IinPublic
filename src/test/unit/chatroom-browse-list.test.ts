/**
 * The room tree is Global → L1 tiles (45° squares, labeled by continent) → L2 → L3 → L4 area rooms.
 * Countries, states and cities are never offered (no national borders in the UI).
 */
import { browsePath, buildBrowseTree, getBrowsableBuiltInChatrooms, resolveChatroomTitle } from '../../web/ui/chatrooms-view';
import { getL1Tiles, parseTileId, tileCenter, tileIdAt, tileLineage } from '../../shared/room-tiles';

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

  it('shows the whole tile path down to the current area room, titled by city', () => {
    const area = tileIdAt(4, 32.7157, -117.1611);
    const path = browsePath(area);
    expect(path).toEqual(tileLineage(area));
    const tree = buildBrowseTree([area]);
    const i = tree.findIndex((room) => room.id === 'tile_1_2_1');
    expect(tree.slice(i, i + 4).map((room) => [room.id, room.level, room.hasChildren])).toEqual([
      [path[0], 1, true], [path[1], 2, true], [path[2], 3, true], [area, 4, false],
    ]);
    expect(tree[i + 1].name).toBe('Large region around San Diego');
    expect(tree[i + 2].name).toBe('Region around San Diego');
    expect(tree[i + 3]).toMatchObject({ name: 'Around San Diego', icon: '📍', parentId: path[2] });
  });

  it('hangs a legacy 1 km grid room and a numbered overflow room under their base', () => {
    expect(browsePath(SAN_DIEGO_GRID)).toEqual([...tileLineage(tileIdAt(4, 32.71, -117.17)), SAN_DIEGO_GRID]);
    const part = `${tileIdAt(4, 32.7157, -117.1611)}_part_2`;
    expect(browsePath(part).slice(-2)).toEqual([tileIdAt(4, 32.7157, -117.1611), part]);
    expect(browsePath('room_custom')).toEqual([]);
    expect(browsePath('global')).toEqual([]);
  });

  it('shows an ocean tile only when it holds the current room', () => {
    expect(buildBrowseTree([]).some((room) => room.id === 'tile_1_2_0')).toBe(false);
    const tree = buildBrowseTree([HONOLULU_GRID]);
    const i = tree.findIndex((room) => room.id === 'tile_1_2_0');
    expect(tree[i]).toMatchObject({ name: 'North Pacific', hasChildren: true });
    expect(tree.find((room) => room.id === HONOLULU_GRID)).toMatchObject({ level: 5 });
  });

  it('titles tile rooms by their label', () => {
    expect(resolveChatroomTitle('tile_1_3_3', [])).toBe('🇪🇺 Europe · North Atlantic');
  });
});
