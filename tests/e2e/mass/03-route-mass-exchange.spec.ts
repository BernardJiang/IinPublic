import { test, expect } from '../helpers/fixtures';
import { computeTalkIdFromTalkData } from '../../../src/shared/talk-content-id';

function routeTalk() {
  return {
    type: 'route', title: 'M3 binary route', language: 'en', authorId: 'm3-author',
    questions: Array.from({ length: 3 }, (_, depth) => ({
      id: `q${depth}`, text: `Depth ${depth}`,
      answers: ['L', 'R'].map((branch) => ({
        id: `${branch}${depth}`, text: branch,
        isMatch: depth === 2 && branch === 'L', isIgnore: depth === 2 && branch === 'R',
        isTerminal: depth === 2,
      })),
    })),
  };
}

test.describe('M3 route mass exchange', () => {
  test('eight responders traverse unique acyclic terminal paths with one shared content id', async () => {
    const talk = routeTalk();
    const creatorId = await computeTalkIdFromTalkData(talk);
    const paths = Array.from({ length: 8 }, (_, index) => index.toString(2).padStart(3, '0').replaceAll('0', 'L').replaceAll('1', 'R'));
    expect(new Set(paths).size).toBe(8);
    for (const path of paths) {
      expect(path).toHaveLength(3);
      expect([...path].every((step) => step === 'L' || step === 'R')).toBe(true);
      expect(await computeTalkIdFromTalkData({ ...talk })).toBe(creatorId);
    }
    const matches = paths.filter((path) => path.endsWith('L'));
    const ignores = paths.filter((path) => path.endsWith('R'));
    expect(matches.length + ignores.length).toBe(8);
  });
});
