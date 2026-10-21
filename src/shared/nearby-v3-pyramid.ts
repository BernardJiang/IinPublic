/**
 * The geographic pyramid behind Nearby v3's counts and introductions (§3.7 "Finding how far to
 * look"). Level L cuts the world into 2^L columns of longitude and 2^L rows of latitude; level 0 is
 * the whole world. The hub keeps a headcount and a bounded card sample per cell; a newcomer climbs
 * from the finest level, looking at the 3×3 block of cells around its point at each level, until the
 * block holds at least C people. Phones and the hub use these same functions, so a cell id means the
 * same thing everywhere.
 */
export type PyramidPoint = { latitude: number; longitude: number };

export type PyramidCell = { level: number; column: number; row: number };

export function pyramidCell(point: PyramidPoint, level: number): PyramidCell {
  const size = 2 ** level;
  const x = (point.longitude + 180) / 360;
  const y = (point.latitude + 90) / 180;
  const column = Math.floor((x - Math.floor(x)) * size) % size;
  const row = Math.min(size - 1, Math.max(0, Math.floor(y * size)));
  return { level, column, row };
}

export function pyramidCellId(cell: PyramidCell): string {
  return `${cell.level}/${cell.column}/${cell.row}`;
}

export function parsePyramidCellId(id: string): PyramidCell | null {
  const match = /^(\d{1,2})\/(\d{1,7})\/(\d{1,7})$/.exec(id);
  if (!match) return null;
  const level = Number(match[1]);
  const column = Number(match[2]);
  const row = Number(match[3]);
  const size = 2 ** level;
  if (level > 24 || column >= size || row >= size) return null;
  return { level, column, row };
}

/** Every level's cell id for a point, finest first. */
export function pyramidCellIds(point: PyramidPoint, finestLevel: number): string[] {
  const ids: string[] = [];
  for (let level = finestLevel; level >= 0; level -= 1) ids.push(pyramidCellId(pyramidCell(point, level)));
  return ids;
}

/**
 * The (up to) nine cells around a point at one level. Longitude wraps; latitude stops at the poles.
 * Anyone within one cell width of the point is inside this block, whatever the cell edges.
 */
export function pyramidBlock(point: PyramidPoint, level: number): string[] {
  const size = 2 ** level;
  const centre = pyramidCell(point, level);
  const ids = new Set<string>();
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      const row = centre.row + dy;
      if (row < 0 || row >= size) continue;
      const column = (((centre.column + dx) % size) + size) % size;
      ids.add(pyramidCellId({ level, column, row }));
    }
  }
  return [...ids];
}

/** Centre and size of a cell, for drawing the heat layer. */
export function pyramidCellBounds(cell: PyramidCell): { west: number; south: number; east: number; north: number } {
  const size = 2 ** cell.level;
  const width = 360 / size;
  const height = 180 / size;
  return {
    west: -180 + cell.column * width,
    east: -180 + (cell.column + 1) * width,
    south: -90 + cell.row * height,
    north: -90 + (cell.row + 1) * height,
  };
}

export type PyramidSearchStep = { level: number; cells: string[]; people: number };

/**
 * Climb from the finest level until the 3×3 block around `point` holds at least `target` people
 * (not counting the searcher), or the whole world has been looked at. `count` reads one cell's
 * headcount. Returns every level looked at, finest first: the caller samples cards from each, so the
 * nearest few come from fine levels and the crowd from the last one. At most (finest + 1) × 9 reads.
 */
export function pyramidSearch(input: {
  point: PyramidPoint;
  finestLevel: number;
  target: number;
  count: (cellId: string) => number;
  /** Subtracted once from every block: the searcher's own heartbeat, if already counted. */
  self?: number;
}): PyramidSearchStep[] {
  const steps: PyramidSearchStep[] = [];
  for (let level = input.finestLevel; level >= 0; level -= 1) {
    const cells = pyramidBlock(input.point, level);
    const people = Math.max(0, cells.reduce((sum, id) => sum + input.count(id), 0) - (input.self ?? 0));
    steps.push({ level, cells, people });
    if (people >= input.target) break;
  }
  return steps;
}
