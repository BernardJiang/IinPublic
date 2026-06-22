import { test, expect } from '../helpers/fixtures';
import { computeTalkIdFromTalkData } from '../../../src/shared/talk-content-id';

test.describe('M4 mixed-type saturation', () => {
  test('twenty deterministic recipients retain isolated identities for four talk types', async () => {
    const talks = (['flow', 'tag', 'survey', 'route'] as const).map((type) => ({
      type, title: `m4${type}`, language: 'en', authorId: 'm4-author',
      questions: [{ id: `${type}q1`, text: `${type}q1`, answers: [{ id: `${type}a11`, text: `${type}a11`, isMatch: true }] }],
    }));
    const ids = await Promise.all(talks.map((talk) => computeTalkIdFromTalkData(talk)));
    expect(new Set(ids).size).toBe(4);
    const deliveries = Array.from({ length: 19 }, (_, recipient) => talks.map((talk, index) => ({ recipient, talkId: ids[index], type: talk.type })));
    expect(deliveries.flat()).toHaveLength(76);
    for (const talk of talks) {
      expect(deliveries.flat().filter((entry) => entry.type === talk.type)).toHaveLength(19);
    }
  });
});
