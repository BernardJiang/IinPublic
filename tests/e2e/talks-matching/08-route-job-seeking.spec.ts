/**
 * Talks matching — job seeker route (demo, no browser).
 */
import { test, expect } from '../helpers/fixtures';
import { RouteProcessor } from '../../../src/shared/talk-engine';
import {
  getJobRouteScenarios,
  JOB_ROUTE_MATCH_TEXT,
  lookupAnswerText,
  prepareValidatedJobRouteTalk,
} from './lib/route-job-seeking';

test.describe('Talks matching — job seeker route (demo)', () => {
  test('validates DAG and records distinct context hashes per branch', () => {
    const talk = prepareValidatedJobRouteTalk();
    expect(talk.questions).toHaveLength(6);

    const scenarios = getJobRouteScenarios();
    expect(scenarios).toHaveLength(10);

    for (const sc of scenarios) {
      const flat = sc.steps.map((s) => ({
        questionId: s.q,
        answerId: s.a,
        answerText: lookupAnswerText(talk, s.q, s.a),
        contextPath: s.contextBefore,
      }));
      const stored = RouteProcessor.flattenTreeAnswers(flat, 'auto');
      expect(stored).toHaveLength(sc.steps.length);

      for (let i = 0; i < sc.steps.length; i += 1) {
        const step = sc.steps[i]!;
        const row = stored[i]!;
        expect(row.questionId).toBe(step.q);
        expect(row.answerId).toBe(step.a);
        expect(row.contextHash).toBe(RouteProcessor.buildContextHash(step.contextBefore));
      }

      const last = sc.steps[sc.steps.length - 1]!;
      const lastAnswer = talk.questions.find((q) => q.id === last.q)?.answers.find((a) => a.id === last.a);
      const matchLeafIds = new Set(['a_rec_yes', 'a_acc_yes', 'a_eng_yes']);
      if (matchLeafIds.has(last.a)) {
        expect(lastAnswer?.isMatch).toBe(true);
        expect(lastAnswer?.text).toBe(JOB_ROUTE_MATCH_TEXT);
      } else {
        expect(lastAnswer?.isIgnore).toBe(true);
      }
    }
  });
});
