import { EMPTY_PLACES_NEAR_LIMIT, emptyPlaceRows, placesMissingFromCatalogue } from '../../web/ui/room-list-view';

describe('Places near you', () => {
  const t = (key: string) => ({ roomListPlaceTag: 'Place', roomListHere: 'Here', roomListPlaceFallback: 'Place' } as Record<string, string>)[key] ?? key;
  const origin = { latitude: 32.71, longitude: -117.17 };
  const place = (id: string, latitude: number) => ({ id, name: id, type: 'business', location: { latitude, longitude: -117.17 } });

  it('lists the nearest empty Places, skipping shown rooms and rooms with people', () => {
    const places = [place('far', 33.5), place('near', 32.72), place('busy', 32.711), place('shown', 32.7101), place('unpinned', 0)];
    delete (places[4] as { location?: unknown }).location;
    const rows = emptyPlaceRows(places, {
      t: t as never,
      origin,
      excludeIds: new Set(['shown']),
      memberCount: (id) => (id === 'busy' ? 2 : 0),
      placeIcon: () => '🏪',
    });
    expect(rows.map((row) => row.roomId)).toEqual(['near', 'far']);
    expect(rows[0]).toMatchObject({ kind: 'place', memberCount: 0, icon: '🏪' });
    expect(rows[0].context).toMatch(/^Place · /);
  });

  it(`shows at most ${EMPTY_PLACES_NEAR_LIMIT}`, () => {
    const places = Array.from({ length: 8 }, (_, i) => place(`p${i}`, 32.72 + i * 0.01));
    const rows = emptyPlaceRows(places, { t: t as never, origin, excludeIds: new Set(), memberCount: () => 0, placeIcon: () => '💬' });
    expect(rows).toHaveLength(EMPTY_PLACES_NEAR_LIMIT);
    expect(rows[0].roomId).toBe('p0');
  });
});

describe('placesMissingFromCatalogue (catalogue refresh for Places made after boot)', () => {
  it('names only Places the catalogue lacks, once each', () => {
    const place = (tail: string) => `place_baguqeera${tail.padEnd(51, 'a')}`;
    const listed = ['nearby_v2_e1_abc', place('known'), place('new'), place('tried')];
    expect(placesMissingFromCatalogue(listed, new Set([place('known')]), new Set([place('tried')]))).toEqual([place('new')]);
  });
});
