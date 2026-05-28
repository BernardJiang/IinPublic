import {
  buildAnswerPreferenceLookupKey,
  sessionAnswersToQAPairs,
} from '../../shared/flattened-answer-keys';
import { computeTalkIdFromTalkData } from '../../shared/cid';

describe('flattened-answer-keys', () => {
  const multiTalkA = {
    type: 'flow',
    questions: [
      { id: 'q0', text: 'Tennis?', answers: [{ id: 'y', text: 'Yes' }] },
      { id: 'q1', text: 'Balboa?', answers: [{ id: 'y', text: 'Yes' }] },
    ],
  };

  const multiTalkB = {
    type: 'flow',
    questions: [
      { id: 'x0', text: 'Tennis?', answers: [{ id: 'a', text: 'Yes' }] },
      { id: 'x1', text: 'Saturday?', answers: [{ id: 'b', text: 'Yes' }] },
    ],
  };

  it('uses same flat key for first question of multi-talk across different content hashes', () => {
    const hA = computeTalkIdFromTalkData(multiTalkA);
    const hB = computeTalkIdFromTalkData(multiTalkB);
    expect(hA).not.toBe(hB);

    const kA = buildAnswerPreferenceLookupKey(multiTalkA, hA, 0, [], 'Tennis?');
    const kB = buildAnswerPreferenceLookupKey(multiTalkB, hB, 0, [], 'Tennis?');
    expect(kA).toBe(kB);
  });

  it('uses path-based key for second question so same wording differs after different prior answers', () => {
    const h = computeTalkIdFromTalkData(multiTalkA);
    const path1: { questionText: string; answerText: string }[] = [
      { questionText: 'Tennis?', answerText: 'Yes' },
    ];
    const path2: { questionText: string; answerText: string }[] = [
      { questionText: 'Tennis?', answerText: 'No' },
    ];
    const k1 = buildAnswerPreferenceLookupKey(multiTalkA, h, 1, path1, 'Balboa?');
    const k2 = buildAnswerPreferenceLookupKey(multiTalkA, h, 1, path2, 'Balboa?');
    expect(k1).not.toBe(k2);
  });

  it('does not reuse first-question preferences across languages', () => {
    const english = { ...multiTalkA, language: 'en' };
    const chinese = { ...multiTalkA, language: 'zh' };
    const englishKey = buildAnswerPreferenceLookupKey(english, computeTalkIdFromTalkData(english), 0, [], 'Tennis?');
    const chineseKey = buildAnswerPreferenceLookupKey(chinese, computeTalkIdFromTalkData(chinese), 0, [], 'Tennis?');
    expect(englishKey).not.toBe(chineseKey);
  });

  it('scopes tag / single-question by content hash', () => {
    const tag1 = {
      type: 'tag',
      questions: [{ id: 'q0', text: 'Interested?', answers: [{ id: 'm', text: 'Match' }] }],
    };
    const tag2 = {
      type: 'tag',
      questions: [{ id: 'q0', text: 'Interested?', answers: [{ id: 'm', text: 'Maybe' }] }],
    };
    const h1 = computeTalkIdFromTalkData(tag1);
    const h2 = computeTalkIdFromTalkData(tag2);
    expect(h1).not.toBe(h2);
    const k1 = buildAnswerPreferenceLookupKey(tag1, h1, 0, [], 'Interested?');
    const k2 = buildAnswerPreferenceLookupKey(tag2, h2, 0, [], 'Interested?');
    expect(k1).not.toBe(k2);
  });

  it('sessionAnswersToQAPairs maps ids to question text', () => {
    const pairs = sessionAnswersToQAPairs(multiTalkA, [
      { questionId: 'q0', answerText: 'Yes' },
    ]);
    expect(pairs).toEqual([{ questionText: 'Tennis?', answerText: 'Yes' }]);
  });
});
