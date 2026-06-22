import { test, expect } from '../helpers/fixtures';
import { aggregateCrossQuestion, summarize, type TalkResponse } from '../../../src/shared/talk-stats';

test.describe('M2 survey mass exchange', () => {
  test('aggregates fourteen deterministic responder vectors without count drift', () => {
    const responses: TalkResponse[] = Array.from({ length: 14 }, (_, responder) => ({
      responseId: `m2-${responder}`, talkId: 'm2-survey', talkType: 'survey', responderId: `user-${responder}`,
      outcome: 'mismatch', createdAt: Date.now(), region: 'global',
      answers: Array.from({ length: 5 }, (_, question) => ({
        questionId: `q${question}`, answerId: `a${(responder * 7 + question) % 4}`,
        answerText: `Option ${(responder * 7 + question) % 4}`,
      })),
    }));
    const summary = summarize('m2-survey', 'survey', responses);
    expect(summary.total).toBe(14);
    for (const question of summary.byQuestion) {
      expect(question.skipCount + question.answers.reduce((n, answer) => n + answer.count, 0)).toBe(14);
      expect(question.completionRate).toBe(100);
    }
    const cross = aggregateCrossQuestion('m2-survey', responses, 'q0', 'q1');
    expect(cross.totalPairs).toBe(14);
  });
});
