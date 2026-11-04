/** @jest-environment jsdom */

// OPEN-106 step 2e (v): the answer dialog pre-fills each question from the Talk's chatbot lookups,
// read once when it opens (`resolveFromView`): reused answers are `auto`, a Just once answer is a
// suggestion (`manual`), and the answers given so far in the dialog decide the situation.

import { resolveFromView } from '../../web/ui/graph-chatbot';
import { answerKey } from '../../core/device-graph/keys';
import { situate, type ChatbotView } from '../../core/device-graph/answers';
import { talkStructureOf } from '../../core/device-graph/talk-structure';

/* eslint-disable @typescript-eslint/no-explicit-any */

const talk: any = {
  id: 'talk-1', title: 'Tennis', type: 'flow', language: 'en',
  questions: [
    { id: 'q_0', text: 'Do you play tennis?', answers: [{ id: 'a_0_0', text: 'Yes', nextQuestionId: 'q_1' }, { id: 'a_0_1', text: 'No', isIgnore: true, isTerminal: true }] },
    { id: 'q_1', text: 'Which days?', answerSelectionMode: 'multiple', answers: [
      { id: 'a_1_0', text: 'Sat', isMatch: true, isTerminal: true }, { id: 'a_1_1', text: 'Sun', isMatch: true, isTerminal: true }, { id: 'a_1_2', text: 'Ignore', isIgnore: true, isTerminal: true },
    ] },
  ],
};

const contextOf = (steps: any[]) => situate(talkStructureOf(talk), steps, 'responder').at(-1)!.contextHash;
const empty = (): ChatbotView => ({ ctx: {}, whenever: {}, typed: {}, location: {}, passed: false });

describe('the answer dialog pre-fills from the graph chatbot', () => {
  it('a reused answer is auto; a Just once answer is a suggestion', () => {
    const view = empty();
    view.ctx[contextOf([{ questionId: 'q_0' }])] = { choices: [answerKey('Yes')], reuse: 'auto' };
    expect(resolveFromView(view, talk, false, talk.questions[0])).toMatchObject({ answerId: 'a_0_0', answerText: 'Yes', mode: 'auto', autoAnswerReason: 'KNOWN_CONTEXT_MATCH' });
    view.ctx[contextOf([{ questionId: 'q_0' }])]!.reuse = 'once';
    expect(resolveFromView(view, talk, false, talk.questions[0])).toMatchObject({ answerId: 'a_0_0', mode: 'manual' });
  });

  it('the answers so far decide the situation; a multi-select set comes back whole', () => {
    const view = empty();
    view.ctx[contextOf([{ questionId: 'q_0', answerIds: ['a_0_0'] }, { questionId: 'q_1' }])] = { choices: [answerKey('Sat'), answerKey('Sun')], reuse: 'auto' };
    expect(resolveFromView(view, talk, false, talk.questions[1], [{ questionId: 'q_0', answerId: 'a_0_0' }]))
      .toMatchObject({ answerId: 'a_1_0', answerIds: ['a_1_0', 'a_1_1'], answerText: 'Sat, Sun', mode: 'auto' });
    // Asked with no answer before it, it is another situation: nothing remembered there.
    expect(resolveFromView(view, talk, false, talk.questions[1], [])).toBeNull();
  });

  it('no lookups (no graph): nothing is pre-filled', () => {
    expect(resolveFromView(null, talk, false, talk.questions[0])).toBeNull();
  });
});
