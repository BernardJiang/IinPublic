import { buildUserTagWeightMap, buildUserTagsEnvelope, USER_TAGS_VERSION } from '../../shared/user-tags';

describe('user-tags envelope', () => {
  it('keeps tag keys exact (ends trimmed) and defaults invalid weights to one', () => {
    const map = buildUserTagWeightMap([
      { id: 'T1', name: ' Hiking ', popularity: 3 },
      { id: 'T2', name: 'COOKING', popularity: 0 },
      { id: 'T3', name: 'music' },
      { id: 'T4', popularity: 9 },
    ]);

    // Tags match exactly (owner, 2026-11-22): only the ends are trimmed.
    expect(map).toEqual({
      Hiking: 3,
      COOKING: 1,
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
      { name: 'Cooking', popularity: 1 },
      { name: ' Hiking ', popularity: 2 },
    ], now);

    expect(a.version).toBe(USER_TAGS_VERSION);
    expect(a.tags).toEqual({ Hiking: 2, Cooking: 1 });
    expect(b.tags).toEqual({ Cooking: 1, Hiking: 2 });
    expect(a.hash).toBe(b.hash);
    // A different spelling is a different tag.
    expect(buildUserTagsEnvelope([{ name: 'hiking', popularity: 2 }, { name: 'Cooking', popularity: 1 }], now).hash).not.toBe(a.hash);
  });
});
