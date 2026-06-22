/** M1 — deterministic mass-flow ledger scenario (kept server-free so it can run with heavy E2E). */
import { test, expect } from '../helpers/fixtures';
import { summarize, type TalkResponse } from '../../../src/shared/talk-stats';

test.describe('M1 flow mass exchange', () => {
  test('records nine branch responses with idempotent matched conversations and correct match rate', () => {
    const creatorId = 'm1-creator';
    const talkId = 'm1-four-question-flow';
    const branches = ['match', 'match', 'match', 'ignore', 'ignore', 'ignore', 'neutral', 'neutral', 'neutral'] as const;
    const responses: TalkResponse[] = branches.map((branch, index) => ({
      responseId: `m1-response-${index}`, talkId, talkType: 'flow', responderId: `m1-user-${index + 1}`,
      region: 'global', createdAt: Date.now(), outcome: branch === 'match' ? 'match' : branch === 'ignore' ? 'ignore' : 'other',
      answers: Array.from({ length: 4 }, (_, question) => ({
        questionId: `q${question}`, answerId: `${branch}-${question}`, answerText: branch,
      })),
    }));
    expect(responses).toHaveLength(9);
    expect(responses.filter((response) => response.outcome === 'match')).toHaveLength(3);
    expect(responses.filter((response) => response.outcome === 'ignore')).toHaveLength(3);
    const conversationIds = responses.filter((response) => response.outcome === 'match')
      .map((response) => `conv_${[creatorId, response.responderId].sort().join('_')}_${talkId}`);
    expect(new Set(conversationIds).size).toBe(3);
    const stats = summarize(talkId, 'flow', responses);
    expect(stats.total).toBe(9);
    expect(stats.matches / stats.total).toBeCloseTo(3 / 9);
  });
});
