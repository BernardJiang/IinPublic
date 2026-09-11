import {
  containmentSimilarity,
  cosineSimilarity,
  FindSimilarIndex,
  jaccardSimilarity,
  type TagCollection,
} from '../../shared/find-similar';
import type { UserTagWeightMap } from '../../shared/user-tags';

function tagRange(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
}

function weights(tags: readonly string[]): UserTagWeightMap {
  return Object.fromEntries(tags.map((tag) => [tag, 1]));
}

describe.each([
  ['Jaccard', jaccardSimilarity],
  ['cosine', cosineSimilarity],
  ['containment', containmentSimilarity],
] as const)('%s tag similarity', (_name, similarity) => {
  test.each([
    ['identical non-empty sets', ['a', 'b'], ['a', 'b'], 1],
    ['disjoint sets', ['a', 'b'], ['c', 'd'], 0],
    ['two empty sets', [], [], 0],
    ['one empty set', ['a'], [], 0],
  ] as Array<[string, TagCollection, TagCollection, number]>)(
    '%s',
    (_case, left, right, expected) => {
      expect(similarity(left, right)).toBe(expected);
    },
  );

  it('treats repeated array entries as one tag', () => {
    expect(similarity(['a', 'a', 'b'], new Set(['a', 'b']))).toBe(1);
  });

  it('accepts tag-weight maps and ignores their weights', () => {
    expect(similarity({ a: 99, b: 0.1 }, { a: 1, b: 50 })).toBe(1);
  });
});

describe('tag-similarity formulas and ranking', () => {
  const adam = tagRange('shared', 100);
  const eve = adam.slice(0, 50);
  const bob = [...adam.slice(0, 50), ...tagRange('bob', 50)];
  const alice = [...adam.slice(0, 50), ...tagRange('alice', 150)];

  it('calculates the controlled baseline scores', () => {
    expect(jaccardSimilarity(adam, eve)).toBeCloseTo(0.5, 10);
    expect(jaccardSimilarity(adam, bob)).toBeCloseTo(1 / 3, 10);
    expect(jaccardSimilarity(adam, alice)).toBeCloseTo(0.2, 10);

    expect(cosineSimilarity(adam, eve)).toBeCloseTo(1 / Math.sqrt(2), 10);
    expect(cosineSimilarity(adam, bob)).toBeCloseTo(0.5, 10);
    expect(cosineSimilarity(adam, alice)).toBeCloseTo(1 / Math.sqrt(8), 10);
  });

  it('handles containment and very different set sizes', () => {
    const one = ['shared-0'];
    const thousand = tagRange('shared', 1_000);

    expect(jaccardSimilarity(one, thousand)).toBeCloseTo(0.001, 10);
    expect(cosineSimilarity(one, thousand)).toBeCloseTo(1 / Math.sqrt(1_000), 10);
  });

  it('containment is asymmetric where Jaccard/cosine collapse both directions into one number', () => {
    // docs/TODO.md's motivating case: "50 of Eve's 50 tags match Adam" — from Eve's
    // side every one of her tags is covered by Adam (perfect containment), but from
    // Adam's side only half of his 100 tags are covered by Eve. Jaccard and cosine
    // are symmetric by construction and report the same 0.5-ish number either way.
    expect(containmentSimilarity(eve, adam)).toBe(1);
    expect(containmentSimilarity(adam, eve)).toBeCloseTo(0.5, 10);
    expect(jaccardSimilarity(eve, adam)).toBe(jaccardSimilarity(adam, eve));
    expect(cosineSimilarity(eve, adam)).toBe(cosineSimilarity(adam, eve));

    // One empty set: containment from the empty side is 0 (no evidence), not 1 —
    // mirrors jaccardFromSets's empty-union guard rather than vacuous-truth semantics.
    expect(containmentSimilarity([], adam)).toBe(0);
    expect(containmentSimilarity(adam, [])).toBe(0);
  });

  it('scores larger overlap higher when set sizes are equal', () => {
    const anchor = ['a', 'b', 'c', 'd'];
    const threeShared = ['a', 'b', 'c', 'x'];
    const oneShared = ['a', 'x', 'y', 'z'];

    expect(jaccardSimilarity(anchor, threeShared)).toBeGreaterThan(
      jaccardSimilarity(anchor, oneShared),
    );
    expect(cosineSimilarity(anchor, threeShared)).toBeGreaterThan(
      cosineSimilarity(anchor, oneShared),
    );
  });

  it.each(['jaccard', 'cosine'] as const)('ranks Eve above Bob above Alice with %s', (metric) => {
    const index = new FindSimilarIndex();
    index.publishWeights('Adam', weights(adam));
    index.publishWeights('Eve', weights(eve));
    index.publishWeights('Bob', weights(bob));
    index.publishWeights('Alice', weights(alice));

    expect(index.topK('Adam', { k: 3, metric }).people.map(({ userId }) => userId)).toEqual([
      'Eve',
      'Bob',
      'Alice',
    ]);
  });

  it('FindSimilarIndex wires the containment metric through similarity() and topK()', () => {
    const index = new FindSimilarIndex();
    index.publishWeights('Adam', weights(adam));
    index.publishWeights('Eve', weights(eve));
    index.publishWeights('Bob', weights(bob));
    index.publishWeights('Alice', weights(alice));

    expect(index.similarity('Eve', 'Adam', 'containment')).toBe(1);
    expect(index.similarity('Adam', 'Eve', 'containment')).toBeCloseTo(0.5, 10);

    // Distinguishing case: Eve, Bob, and Alice each share exactly 50 tags with Adam,
    // so containment(Adam, *) — dividing by Adam's own fixed 100-tag size — ties all
    // three at 0.5, unlike jaccard/cosine (which also divide by each candidate's own
    // size and so rank Eve > Bob > Alice, per the test above). The bounded top-K heap
    // breaks the tie deterministically: `weaker()` treats a larger userId as weaker,
    // so ties resolve alphabetically ascending, not by any relevance ordering.
    const result = index.topK('Adam', { k: 3, metric: 'containment' });
    expect(result.people.every(({ score }) => score === 0.5)).toBe(true);
    expect(result.people.map(({ userId }) => userId)).toEqual(['Alice', 'Bob', 'Eve']);
  });
});
