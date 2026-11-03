/** @jest-environment node */

import { createAnswerPreferenceEngine } from '../../core/answer-preference-engine';
import { createEmptyExactChatbotMemoryState } from '../../shared/exact-chatbot-memory';
import { createEmptyTypedPreferenceState } from '../../shared/typed-preference-store';

const talk = {
  id: 't1',
  title: 'Tennis',
  type: 'flow',
  language: 'en',
  authorId: 'author',
  questions: [
    {
      id: 'q_0',
      text: 'Do you play tennis?',
      answers: [
        { id: 'a_0_0', text: 'Yes', nextQuestionId: 'q_1' },
        { id: 'a_0_1', text: 'No', isIgnore: true, isTerminal: true },
      ],
    },
    {
      id: 'q_1',
      text: 'How often do you play?',
      answers: [
        { id: 'a_1_0', text: 'Weekly', isMatch: true, isTerminal: true },
        { id: 'a_1_1', text: 'Ignore.', isIgnore: true, isTerminal: true },
      ],
    },
  ],
};

describe('chatbot answer lookup', () => {
  // At 10,000 Talks each whole-map copy cost 55 ms on a Mac; the hash itself costs nanoseconds.
  it('answers a Talk without copying the whole answer map', () => {
    let flattened: Record<string, any> = {};
    let preferences: Record<string, any> = {};
    let exactMemory = createEmptyExactChatbotMemoryState();
    const wholeMapRead = jest.fn(() => flattened);
    const engine = createAnswerPreferenceEngine({
      getAnswerPreferences: () => preferences,
      setAnswerPreferences: (map) => { preferences = map; },
      getFlattenedAnswerPreferences: wholeMapRead,
      getFlattenedAnswerPreference: (key) => flattened[key],
      setFlattenedAnswerPreferences: (map) => { flattened = map; },
      getExactChatbotMemory: () => exactMemory,
      setExactChatbotMemory: (value) => { exactMemory = value; },
      getQuestionDefaultContracts: () => ({}),
      setQuestionDefaultContracts: () => undefined,
      getTypedPreferenceState: () => createEmptyTypedPreferenceState(),
      getLocationAutoMatchConsent: () => false,
      getMyTalks: () => ({}),
    });
    const session: Array<{ questionId: string; answerId: string; answerText: string }> = [];
    for (const question of talk.questions) {
      const answer = question.answers[0];
      session.push({ questionId: question.id, answerId: answer.id, answerText: answer.text });
      engine.saveAnswerPreference(undefined, talk, 't1', question, answer.id, answer.text, [...session], 'auto');
    }
    wholeMapRead.mockClear();

    const answers = engine.tryBuildChatbotAnswersFromFlattened(undefined, talk);

    expect(answers?.map((answer) => answer.answerText)).toEqual(['Yes', 'Weekly']);
    expect(wholeMapRead).not.toHaveBeenCalled();
  });
});
