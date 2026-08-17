import { pickClosestCandidate } from '../../shared/closest-match';

const SAN_DIEGO = { latitude: 32.7157, longitude: -117.1611 };
// Roughly 7 miles north of San Diego.
const NEARBY = { latitude: 32.8153, longitude: -117.1611 };
// Roughly 100+ miles away (Los Angeles).
const FAR_AWAY = { latitude: 34.0522, longitude: -118.2437 };

describe('pickClosestCandidate', () => {
  it('returns null for an empty candidate list', () => {
    expect(pickClosestCandidate([], SAN_DIEGO)).toBeNull();
  });

  it('a single candidate always wins, with no computed distance', () => {
    const result = pickClosestCandidate(
      [{ talkId: 't1', authorId: 'a1', authorLocation: FAR_AWAY }],
      SAN_DIEGO,
    );
    expect(result?.winner.talkId).toBe('t1');
    expect(result?.losers).toEqual([]);
    expect(result?.distanceMiles).toBeNull();
  });

  it('picks the nearest candidate among several', () => {
    const result = pickClosestCandidate(
      [
        { talkId: 'far', authorId: 'a1', authorLocation: FAR_AWAY },
        { talkId: 'near', authorId: 'a2', authorLocation: NEARBY },
        { talkId: 'origin', authorId: 'a3', authorLocation: SAN_DIEGO },
      ],
      SAN_DIEGO,
    );
    expect(result?.winner.talkId).toBe('origin');
    expect(result?.losers.map((l) => l.talkId).sort()).toEqual(['far', 'near']);
    expect(result?.distanceMiles).toBe(0);
  });

  it('treats a candidate with no authorLocation as farthest, not excluded', () => {
    const result = pickClosestCandidate(
      [
        { talkId: 'no-location', authorId: 'a1', authorLocation: null },
        { talkId: 'near', authorId: 'a2', authorLocation: NEARBY },
      ],
      SAN_DIEGO,
    );
    expect(result?.winner.talkId).toBe('near');
    expect(result?.losers.map((l) => l.talkId)).toEqual(['no-location']);
  });

  it('a location-less candidate can still win if it is the only one', () => {
    const result = pickClosestCandidate(
      [{ talkId: 'no-location', authorId: 'a1', authorLocation: null }],
      SAN_DIEGO,
    );
    expect(result?.winner.talkId).toBe('no-location');
  });

  it('falls back to the earliest-arrived candidate when no reference location is known', () => {
    const result = pickClosestCandidate(
      [
        { talkId: 'first', authorId: 'a1', authorLocation: NEARBY },
        { talkId: 'second', authorId: 'a2', authorLocation: FAR_AWAY },
      ],
      null,
    );
    expect(result?.winner.talkId).toBe('first');
  });

  it('keeps the earlier-arrived candidate on an exact distance tie', () => {
    const result = pickClosestCandidate(
      [
        { talkId: 'first', authorId: 'a1', authorLocation: NEARBY },
        { talkId: 'second', authorId: 'a2', authorLocation: NEARBY },
      ],
      SAN_DIEGO,
    );
    expect(result?.winner.talkId).toBe('first');
    expect(result?.losers.map((l) => l.talkId)).toEqual(['second']);
  });
});
