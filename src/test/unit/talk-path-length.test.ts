import { remainingPathLength, talkPathLength } from '../../shared/talk-path-length';
import { responseProgress } from '../../web/ui/talk-response-dialog';

const end = (extra: object = {}) => ({ isTerminal: true, ...extra });
// The demo Route Guide's "Find an activity that fits": two branches of two questions each.
const activityRoute = {
  type: 'route',
  questions: [
    { id: 'q_0', answers: [{ nextQuestionId: 'q_1' }, { nextQuestionId: 'q_2' }, end({ isIgnore: true })] },
    { id: 'q_1', answers: [end({ isMatch: true }), end({ isIgnore: true })] },
    { id: 'q_2', answers: [end({ isMatch: true }), end({ isIgnore: true })] },
  ],
};

describe('talk path length', () => {
  it('a route counts the branch a person walks, not every question', () => {
    expect(talkPathLength(activityRoute)).toBe(2);
    expect(remainingPathLength(activityRoute, 'q_2')).toBe(1);
  });

  it('a flow without pointers advances in order until an end', () => {
    const flow = { type: 'flow', questions: [{ id: 'a', answers: [{}] }, { id: 'b', answers: [{}] }, { id: 'c', answers: [end({ isMatch: true })] }] };
    expect(talkPathLength(flow)).toBe(3);
    const early = { type: 'flow', questions: [{ id: 'a', answers: [end({ isMatch: true })] }, { id: 'b', answers: [end()] }] };
    expect(talkPathLength(early)).toBe(1);
  });

  it('a survey asks every question', () => {
    const survey = { type: 'survey', questions: [{ id: 'a', answers: [end()] }, { id: 'b', answers: [end()] }, { id: 'c', answers: [end()] }] };
    expect(talkPathLength(survey)).toBe(3);
  });

  it('a loop does not count forever', () => {
    const loop = { type: 'route', questions: [{ id: 'a', answers: [{ nextQuestionId: 'b' }] }, { id: 'b', answers: [{ nextQuestionId: 'a' }] }] };
    expect(talkPathLength(loop)).toBe(2);
  });

  it('the answer dialog shows "Question 2 of 2" on the board-games branch', () => {
    expect(responseProgress(activityRoute, 1, [{ questionId: 'q_0' }])).toEqual({ step: 2, total: 2 });
    expect(responseProgress(activityRoute, 0, [])).toEqual({ step: 1, total: 2 });
  });
});
