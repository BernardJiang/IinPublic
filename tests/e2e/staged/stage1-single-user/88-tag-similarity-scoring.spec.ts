import { expect, test } from '@playwright/test';
import {
  cosineSimilarity,
  FindSimilarIndex,
  jaccardSimilarity,
} from '../../../../src/shared/find-similar';
import type { UserTagWeightMap } from '../../../../src/shared/user-tags';

function tagRange(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
}

function weights(tags: readonly string[]): UserTagWeightMap {
  return Object.fromEntries(tags.map((tag) => [tag, 1]));
}

test.describe('application tag-similarity scoring', () => {
  const adam = tagRange('shared', 100);
  const people = {
    Eve: adam.slice(0, 50),
    Bob: [...adam.slice(0, 50), ...tagRange('bob', 50)],
    Alice: [...adam.slice(0, 50), ...tagRange('alice', 150)],
  };

  for (const metric of ['jaccard', 'cosine'] as const) {
    test(`${metric} ranks controlled users Eve > Bob > Alice`, () => {
      const index = new FindSimilarIndex();
      index.publishWeights('Adam', weights(adam));
      for (const [userId, tags] of Object.entries(people)) {
        index.publishWeights(userId, weights(tags));
      }

      const result = index.topK('Adam', { k: 3, metric });
      expect(result.people.map(({ userId }) => userId)).toEqual(['Eve', 'Bob', 'Alice']);

      const expected =
        metric === 'jaccard' ? [0.5, 1 / 3, 0.2] : [1 / Math.sqrt(2), 0.5, 1 / Math.sqrt(8)];
      result.people.forEach((person, index) =>
        expect(person.score).toBeCloseTo(expected[index], 10),
      );
    });
  }

  test('covers identity, no overlap, empty sets, containment, and overlap ordering', () => {
    for (const similarity of [jaccardSimilarity, cosineSimilarity]) {
      expect(similarity(['a', 'b'], ['a', 'b'])).toBe(1);
      expect(similarity(['a'], ['b'])).toBe(0);
      expect(similarity([], [])).toBe(0);
      expect(similarity([], ['a'])).toBe(0);
      expect(similarity(['a'], ['a', ...tagRange('large', 999)])).toBeGreaterThan(0);
      expect(similarity(['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'x'])).toBeGreaterThan(
        similarity(['a', 'b', 'c', 'd'], ['a', 'x', 'y', 'z']),
      );
    }
  });
});
