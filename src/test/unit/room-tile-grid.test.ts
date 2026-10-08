import { gridLayerForZoom, tileAtTap, tileGridLines, tileSquares } from '../../shared/room-tile-grid';
import { tileIdAt } from '../../shared/room-tiles';

describe('room tile grid overlay', () => {
  it('shows the tile layer that fits the zoom', () => {
    expect([0, 2.9, 3, 4.9, 5, 6.9, 7, 14].map(gridLayerForZoom)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it('draws one line per tile edge in view, on exact tile boundaries', () => {
    const lines = tileGridLines(1, { west: -180, south: -85, east: 180, north: 85 });
    const vertical = lines.features.filter((f) => f.geometry.coordinates[0][0] === f.geometry.coordinates[1][0]);
    const horizontal = lines.features.filter((f) => f.geometry.coordinates[0][1] === f.geometry.coordinates[1][1]);
    expect(vertical.map((f) => f.geometry.coordinates[0][0])).toEqual([-180, -135, -90, -45, 0, 45, 90, 135, 180]);
    expect(horizontal.map((f) => f.geometry.coordinates[0][1])).toEqual([-45, 0, 45]);
  });

  it('stays small for a city-sized viewport at the bottom layer', () => {
    const lines = tileGridLines(4, { west: -118, south: 32, east: -116, north: 33.5 });
    expect(lines.features.length).toBeGreaterThan(4);
    expect(lines.features.length).toBeLessThan(20);
    const vertical = lines.features.filter((f) => f.geometry.coordinates[0][0] === f.geometry.coordinates[1][0]);
    expect(vertical.length).toBeGreaterThan(2);
    for (const f of vertical) {
      const steps = (f.geometry.coordinates[0][0] + 180) / 0.703125;
      expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6);
    }
  });

  it('turns a tile into a closed square matching its bounds', () => {
    const [square] = tileSquares([tileIdAt(1, 32.7, -117.2), 'room_custom']).features;
    expect(square.properties.tileId).toBe('tile_1_2_1');
    expect(square.geometry.coordinates[0]).toEqual([[-135, 0], [-90, 0], [-90, 45], [-135, 45], [-135, 0]]);
  });

  it('a tap picks the tile of the layer currently drawn', () => {
    expect(tileAtTap(51.5, -0.12, 2)).toBe(tileIdAt(1, 51.5, -0.12));
    expect(tileAtTap(51.5, -0.12, 9)).toBe(tileIdAt(4, 51.5, -0.12));
  });
});
