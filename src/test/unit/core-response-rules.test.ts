/** OPEN-91 P4: rules both ends of a Talk response share. */
import { isIgnoreAnswerSet, isResponseComplete, nextResponseVersion } from '../../core/response-rules';

describe('response rules', () => {
  it('a survey is complete only when every question is answered; other Talks end where their path ends', () => {
    const survey = { type: 'survey', questions: [{}, {}] };
    expect(isResponseComplete(survey, [{}])).toBe(false);
    expect(isResponseComplete(survey, [{}, {}])).toBe(true);
    expect(isResponseComplete({ type: 'flow', questions: [{}, {}] }, [{}])).toBe(true);
  });

  it('recognizes the Ignore choice by id or text', () => {
    expect(isIgnoreAnswerSet([{ answerId: 'ignore' }])).toBe(true);
    expect(isIgnoreAnswerSet([{ answerId: 'q1_ignore_x' }])).toBe(true);
    expect(isIgnoreAnswerSet([{ answerId: 'a', answerText: 'Ignore' }])).toBe(true);
    expect(isIgnoreAnswerSet([{ answerId: 'yes', answerText: 'Yes' }])).toBe(false);
  });

  it('versions: 1 first, the same for the same answers, one more for a change of mind', () => {
    expect(nextResponseVersion(null, 0, 'r1')).toBe(1);
    expect(nextResponseVersion('r1', 1, 'r1')).toBe(1);
    expect(nextResponseVersion('r1', 1, 'r2')).toBe(2);
  });
});
