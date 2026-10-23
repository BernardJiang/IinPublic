import { rankMatchCollectionPeople } from '../../shared/match-collection-ranking';

describe('match collection ranking', () => {
  it('puts must-have failures first, reuses weighted matches, and never drops candidates', () => {
    const people = [
      { peerId: 'many-soft', pinned: false, dismissed: false, latestOutcomes: [
        { talkId: 'must', outcome: 'mismatch' as const, capturedAt: '2026-10-20T10:00:00Z' },
        { talkId: 'soft-a', outcome: 'match' as const, capturedAt: '2026-10-20T10:00:00Z' },
        { talkId: 'soft-b', outcome: 'match' as const, capturedAt: '2026-10-20T10:00:00Z' },
      ], encounterDistancesMeters: [100] },
      { peerId: 'hard-pass', pinned: false, dismissed: false, latestOutcomes: [
        { talkId: 'must', outcome: 'match' as const, capturedAt: '2026-10-20T10:00:00Z' },
      ], encounterDistancesMeters: [2_000] },
      { peerId: 'dismissed', pinned: false, dismissed: true, latestOutcomes: [], encounterDistancesMeters: [] },
    ];
    const ranked = rankMatchCollectionPeople({
      people,
      talks: { must: { collectionImportance: 'must-have' }, 'soft-a': {}, 'soft-b': {} },
      now: new Date('2026-10-20T11:00:00Z'),
    });

    expect(ranked.map((person) => person.peerId)).toEqual(['hard-pass', 'many-soft', 'dismissed']);
    expect(ranked).toHaveLength(3);
    expect(ranked[0]).toMatchObject({ mustHaveFailures: 0, weightedMatches: 8 });
    expect(ranked[1]).toMatchObject({ mustHaveFailures: 1, matchedTalks: 2 });
    expect(ranked[0]?.reasons).toContain('must-have');
  });

  it('lets an explicit pin lead without silently removing a must-have failure', () => {
    const [ranked] = rankMatchCollectionPeople({
      people: [{
        peerId: 'pinned', pinned: true, dismissed: false,
        latestOutcomes: [{ talkId: 'must', outcome: 'ignore', capturedAt: '2026-10-20T10:00:00Z' }],
        encounterDistancesMeters: [],
      }],
      talks: { must: { collectionImportance: 'must-have' } },
    });
    expect(ranked).toMatchObject({ peerId: 'pinned', mustHaveFailures: 1, reasons: ['pinned'] });
  });
});
