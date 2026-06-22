/** M1 — deterministic mass-flow ledger scenario (kept server-free so it can run with heavy E2E). */
import { test, expect } from '../helpers/fixtures';
import { summarize, type TalkResponse } from '../../../src/shared/talk-stats';

test.describe('M1 flow mass exchange', () => {
  test('matches the numbered four-question flow golden result', () => {
    const creatorId = 'm1-creator';
    const talkId = 'm1-four-question-flow';
    // flowq1→flowa11→flowq2→flowa22→flowq3→flowa33→flowq4 is the sole live route.
    // Every other numbered choice terminates as ignored; the nine vectors are the golden oracle.
    const golden = [
      ['flowa11', 'flowa22', 'flowa33', 'flowa41'], ['flowa11', 'flowa22', 'flowa33', 'flowa42'],
      ['flowa11', 'flowa22', 'flowa33', 'flowa43'], ['flowa12'], ['flowa13'], ['flowa11', 'flowa21'],
      ['flowa11', 'flowa23'], ['flowa11', 'flowa22', 'flowa31'], ['flowa11', 'flowa22', 'flowa32'],
    ] as const;
    const responses: TalkResponse[] = golden.map((vector, index) => ({
      responseId: `m1-response-${index}`, talkId, talkType: 'flow', responderId: `m1-user-${index + 1}`,
      region: 'global', createdAt: Date.now(), outcome: vector[vector.length - 1] === 'flowa41' ? 'match' : 'ignore',
      answers: vector.map((answerId, question) => ({ questionId: `flowq${question + 1}`, answerId, answerText: answerId })),
    }));
    expect(responses).toHaveLength(9);
    expect(responses.map((response) => response.answers.map((answer) => answer.answerId))).toEqual(golden);
    expect(responses.filter((response) => response.outcome === 'match')).toHaveLength(1);
    expect(responses.filter((response) => response.outcome === 'ignore')).toHaveLength(8);
    const conversationIds = responses.filter((response) => response.outcome === 'match')
      .map((response) => `conv_${[creatorId, response.responderId].sort().join('_')}_${talkId}`);
    expect(new Set(conversationIds).size).toBe(1);
    const stats = summarize(talkId, 'flow', responses);
    expect(stats.total).toBe(9);
    expect(stats.matches / stats.total).toBeCloseTo(1 / 9);
  });
});
