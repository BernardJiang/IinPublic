import { buildUserTagWeightMap, buildUserTagsEnvelope, USER_TAGS_VERSION } from '../../shared/user-tags';

describe('user-tags envelope', () => {
  it('normalizes tag keys and defaults invalid weights to one', () => {
    const map = buildUserTagWeightMap([
      { id: 'T1', name: ' Hiking ', popularity: 3 },
      { id: 'T2', name: 'COOKING', popularity: 0 },
      { id: 'T3', name: 'music' },
      { id: 'T4', popularity: 9 },
    ]);

    expect(map).toEqual({
      hiking: 3,
      cooking: 1,
      music: 1,
    });
  });

  it('produces deterministic hash regardless of input order', () => {
    const now = new Date('2026-06-12T00:00:00.000Z');
    const a = buildUserTagsEnvelope([
      { name: 'Hiking', popularity: 2 },
      { name: 'Cooking', popularity: 1 },
    ], now);
    const b = buildUserTagsEnvelope([
      { name: 'cooking', popularity: 1 },
      { name: 'hiking', popularity: 2 },
    ], now);

    expect(a.version).toBe(USER_TAGS_VERSION);
    expect(a.tags).toEqual({ hiking: 2, cooking: 1 });
    expect(b.tags).toEqual({ cooking: 1, hiking: 2 });
    expect(a.hash).toBe(b.hash);
  });
});
