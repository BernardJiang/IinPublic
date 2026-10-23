import {
  findPlaceCreationConflict,
  isPlaceDiscoverable,
  isPlaceLive,
  MAX_LIVE_PLACES_PER_CELL,
  normalizePlaceName,
  PLACE_LIVE_WINDOW_MS,
} from '../../shared/place-lifecycle';

const now = Date.parse('2026-10-13T12:00:00.000Z');
const daysAgo = (days: number): string => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
const cell = 'region_-22.85_-43.07';

describe('Place lifecycle', () => {
  it('a Place is live for 30 days after its creation or its last entry', () => {
    expect(isPlaceLive({ id: 'a', createdAt: daysAgo(29) }, now)).toBe(true);
    expect(isPlaceLive({ id: 'a', createdAt: daysAgo(31) }, now)).toBe(false);
    expect(isPlaceLive({ id: 'a', createdAt: daysAgo(90), lastActiveAt: daysAgo(2) }, now)).toBe(true);
    expect(isPlaceLive({ id: 'a', createdAt: new Date(now - PLACE_LIVE_WINDOW_MS).toISOString() }, now)).toBe(true);
    expect(isPlaceLive({ id: 'a' }, now)).toBe(false);
  });

  it('is publicly discoverable only while live and its creator still clears the credit bar', () => {
    const live = { id: 'a', createdAt: daysAgo(2) };
    const expired = { id: 'b', createdAt: daysAgo(31) };
    expect(isPlaceDiscoverable(live, true, now)).toBe(true);
    expect(isPlaceDiscoverable(live, false, now)).toBe(false);
    expect(isPlaceDiscoverable(expired, true, now)).toBe(false);
  });

  it('normalizes names for the same-name rule', () => {
    expect(normalizePlaceName('  Bean   There ')).toBe(normalizePlaceName('bean there'));
  });

  it('allows one Place per creator for the identity lifetime, including after expiry', () => {
    const own = { id: 'p1', name: 'Mine', anchorCell: 'region_1_1', creatorPub: 'pubA', createdAt: daysAgo(3) };
    expect(findPlaceCreationConflict([own], { creatorPub: 'pubA', anchorCell: cell, name: 'New' }, now))
      .toEqual({ code: 'PLACE_CREATOR_LIMIT', existingId: 'p1', existingName: 'Mine' });
    expect(findPlaceCreationConflict([{ ...own, createdAt: daysAgo(40) }], { creatorPub: 'pubA', anchorCell: cell, name: 'New' }, now))
      .toEqual({ code: 'PLACE_CREATOR_LIMIT', existingId: 'p1', existingName: 'Mine' });
  });

  it('refuses the same name in the same cell, but not in another cell', () => {
    const shop = { id: 'p2', name: 'Bean There', anchorCell: cell, creatorPub: 'pubB', createdAt: daysAgo(1) };
    expect(findPlaceCreationConflict([shop], { creatorPub: 'pubA', anchorCell: cell, name: 'bean  there' }, now))
      .toEqual({ code: 'PLACE_NAME_TAKEN', existingId: 'p2', existingName: 'Bean There' });
    expect(findPlaceCreationConflict([shop], { creatorPub: 'pubA', anchorCell: 'region_1_1', name: 'Bean There' }, now))
      .toBeNull();
  });

  it('refuses a sixth live Place in one cell; expired Places free the cell', () => {
    const full = Array.from({ length: MAX_LIVE_PLACES_PER_CELL }, (_, i) => ({
      id: `p${i}`, name: `Shop ${i}`, anchorCell: cell, creatorPub: `pub${i}`, createdAt: daysAgo(1),
    }));
    expect(findPlaceCreationConflict(full, { creatorPub: 'pubZ', anchorCell: cell, name: 'Another' }, now))
      .toEqual({ code: 'PLACE_CELL_FULL' });
    const oneExpired = full.map((place, i) => (i === 0 ? { ...place, createdAt: daysAgo(45) } : place));
    expect(findPlaceCreationConflict(oneExpired, { creatorPub: 'pubZ', anchorCell: cell, name: 'Another' }, now))
      .toBeNull();
  });
});
