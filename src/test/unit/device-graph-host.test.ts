/** @jest-environment node */

// The device core's graph host (OPEN-106 step 3): a received answer set is turned back into the
// app's answers (question and choice ids), from the responder's side for a Pair tag too.

import { situate } from '../../core/device-graph/answers';
import { appAnswersOf, appTalkOf } from '../../core/device-graph/sync/graph-host';
import { talkStructureOf } from '../../core/device-graph/talk-structure';

/* eslint-disable @typescript-eslint/no-explicit-any */

const tennis = {
  title: 'Tennis partner', type: 'flow', language: 'en', isAdult: false,
  questions: [
    { id: 'q_0', text: 'Do you play tennis?', answers: [{ id: 'a_0_0', text: 'Yes', nextQuestionId: 'q_1' }, { id: 'a_0_1', text: 'No', isIgnore: true, isTerminal: true }] },
    { id: 'q_1', text: 'How often do you play?', answers: [{ id: 'a_1_0', text: 'Weekly', isMatch: true, isTerminal: true }, { id: 'a_1_1', text: 'Daily', isIgnore: true, isTerminal: true }] },
  ],
};

const deal = {
  title: 'Phone', type: 'flow', language: 'en', isAdult: false,
  questions: [
    { id: 'q_0', text: 'Sell', reciprocalTagContext: true, answers: [{ id: 'a_0_0', text: 'Buy', nextQuestionId: 'q_1' }, { id: 'a_0_1', text: 'Ignore', isIgnore: true, isTerminal: true }] },
    { id: 'q_1', text: 'Which colour?', answers: [{ id: 'a_1_0', text: 'Black', isMatch: true, isTerminal: true }] },
  ],
};

const setOf = (talk: any, steps: Array<{ questionId: string; answerIds: string[] }>) =>
  Object.fromEntries(situate(talkStructureOf(talk), steps, 'responder').map((s) => [s.contextHash, s.entry]));

describe('graph host', () => {
  it('turns an answer set back into the app’s answers', () => {
    const set = setOf(tennis, [{ questionId: 'q_0', answerIds: ['a_0_0'] }, { questionId: 'q_1', answerIds: ['a_1_0'] }]);
    expect(appAnswersOf(talkStructureOf(tennis), set, 'chatbot')).toEqual([
      { questionId: 'q_0', answerId: 'a_0_0', answerText: 'Yes', mode: 'chatbot' },
      { questionId: 'q_1', answerId: 'a_1_0', answerText: 'Weekly', isMatch: true, mode: 'chatbot' },
    ]);
  });

  it('reads a Pair tag answer from the responder’s side', () => {
    const set = setOf(deal, [{ questionId: 'q_0', answerIds: ['a_0_0'] }, { questionId: 'q_1', answerIds: ['a_1_0'] }]);
    expect(appAnswersOf(talkStructureOf(deal), set, 'manual').map((a) => a.answerId)).toEqual(['a_0_0', 'a_1_0']);
  });

  it('returns the answers in the Talk’s question order whatever order the set holds them in', () => {
    // A flow's outcome is its last answer's (88-asymmetric: the hash order put the Pair tag last).
    const set = setOf(deal, [{ questionId: 'q_0', answerIds: ['a_0_0'] }, { questionId: 'q_1', answerIds: ['a_1_0'] }]);
    const reversed = Object.fromEntries(Object.entries(set).reverse());
    expect(appAnswersOf(talkStructureOf(deal), reversed, 'manual').map((a) => a.questionId)).toEqual(['q_0', 'q_1']);
  });

  it('gives the app a Talk with its meta fields and graph ids', () => {
    const talk = appTalkOf({ ...talkStructureOf(tennis), id: 't1', versionId: 'v2', title: 'Tennis partner', isAdult: false, createdAt: 1762000000000, updatedAt: 1762000001000, active: true, isTemplate: false, meta: { tags: ['sport'], authorName: 'Adam' }, senders: ['adam'], latestArrival: 'x' });
    expect(talk).toMatchObject({ title: 'Tennis partner', tags: ['sport'], authorName: 'Adam', graphTalkId: 't1', graphVersionId: 'v2' });
    expect(talk).not.toHaveProperty('senders');
    expect((talk as any).questions).toHaveLength(2);
  });
});
