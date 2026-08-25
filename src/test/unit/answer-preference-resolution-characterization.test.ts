/** @jest-environment jsdom */

import { computeTalkIdFromTalkData } from '../../shared/cid';
import { buildAnswerPreferenceLookupKey } from '../../shared/flattened-answer-keys';
import {
  LOCAL_EXACT_CHATBOT_USER_ID,
  saveTemporaryAnswer,
} from '../../shared/exact-chatbot-memory';
import {
  getExactChatbotMemory,
  getFlattenedAnswerPreferences,
  setExactChatbotMemory,
  setFlattenedAnswerPreferences,
} from '../../web/ui/answer-preferences-storage';
import { UIManager } from '../../web/ui/ui-manager';

type PreferenceResolution = {
  answerId: string;
  answerIds?: string[];
  answerText: string;
  mode: string;
  autoAnswerReason?: string;
} | null;

type PreferenceUi = {
  currentUser?: { id: string };
  resolveAnswerPreferenceForTalkQuestion(
    talk: any,
    questionIndex: number,
    previousQAPairs: Array<{ questionText: string; answerText: string }>,
    currentQuestion: any,
    talkInstanceId: string,
  ): PreferenceResolution;
  saveAnswerPreference(
    talk: any,
    talkInstanceId: string,
    currentQuestion: any,
    answerId: string,
    answerText: string,
    fullSessionAnswersIncludingCurrent: Array<{ questionId: string; answerText?: string }>,
    mode?: 'auto' | 'manual' | 'permanent' | 'suppressed',
  ): void;
};

function preferenceUi(currentUserId = 'me'): PreferenceUi {
  const ui = new UIManager() as unknown as PreferenceUi;
  ui.currentUser = { id: currentUserId };
  return ui;
}

describe('UIManager answer-preference resolution characterization', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('auto-proceeds through a reciprocal tag question with one non-ignore answer', () => {
    const ui = preferenceUi();
    const question = {
      id: 'pair-root',
      text: 'buy',
      reciprocalTagContext: true,
      answers: [
        { id: 'sell-answer', text: 'sell' },
        { id: 'ignore', text: 'Ignore', isIgnore: true },
      ],
    };
    const talk = { id: 'pair-talk', type: 'flow', authorId: 'other', questions: [question] };

    expect(ui.resolveAnswerPreferenceForTalkQuestion(talk, 0, [], question, talk.id)).toMatchObject({
      answerId: 'sell-answer',
      answerText: 'sell',
      mode: 'auto',
      autoAnswerReason: 'RECIPROCAL_TAG_CONTEXT',
    });
  });

  it('prefers a context-aware flattened answer over conflicting exact-text memory', () => {
    const ui = preferenceUi();
    const question = {
      id: 'q0',
      text: 'Which model?',
      answers: [
        { id: 'current-a', text: 'Model A' },
        { id: 'current-b', text: 'Model B' },
        { id: 'ignore', text: 'Ignore', action: 'ignore' },
      ],
    };
    const talk = { id: 'incoming-talk', type: 'flow', language: 'en', questions: [question] };
    const flatKey = buildAnswerPreferenceLookupKey(
      talk,
      computeTalkIdFromTalkData(talk),
      0,
      [],
      question.text,
      { mySelfTag: undefined, counterpartTag: undefined },
    );
    setFlattenedAnswerPreferences({
      [flatKey]: {
        answerId: 'old-b',
        answerText: 'Model B',
        mode: 'temporary',
      },
    });
    const exactMemory = getExactChatbotMemory();
    saveTemporaryAnswer(
      exactMemory,
      LOCAL_EXACT_CHATBOT_USER_ID,
      question.text,
      'Model A',
      1,
      { language: 'en' },
    );
    setExactChatbotMemory(exactMemory);

    expect(ui.resolveAnswerPreferenceForTalkQuestion(talk, 0, [], question, talk.id)).toMatchObject({
      answerId: 'current-b',
      answerText: 'Model B',
      mode: 'auto',
      autoAnswerReason: 'FLATTENED_CONTEXT_MATCH',
    });
  });

  it('maps remembered multi-select answer text back to the current talk answer ids', () => {
    const ui = preferenceUi();
    const question = {
      id: 'multi',
      text: 'Which models?',
      answerSelectionMode: 'multiple',
      answers: [
        { id: 'talk-a', text: 'Model A' },
        { id: 'talk-b', text: 'Model B' },
        { id: 'ignore', text: 'Ignore', action: 'ignore' },
      ],
    };
    const talk = { id: 'multi-talk', type: 'flow', language: 'en', questions: [question] };
    const exactMemory = getExactChatbotMemory();
    saveTemporaryAnswer(
      exactMemory,
      LOCAL_EXACT_CHATBOT_USER_ID,
      question.text,
      'Model A',
      1,
      { language: 'en' },
    );
    saveTemporaryAnswer(
      exactMemory,
      LOCAL_EXACT_CHATBOT_USER_ID,
      question.text,
      'Model B',
      2,
      { language: 'en' },
    );
    setExactChatbotMemory(exactMemory);

    expect(ui.resolveAnswerPreferenceForTalkQuestion(talk, 0, [], question, talk.id)).toMatchObject({
      answerId: 'talk-b',
      answerIds: ['talk-b', 'talk-a'],
      answerText: 'Model B, Model A',
      mode: 'auto',
    });
  });

  it('reuses a saved answer across independently-authored reciprocal-tag talks', () => {
    const ui = preferenceUi('me');
    const ownPair = {
      id: 'own-pair',
      text: 'buy',
      reciprocalTagContext: true,
      answers: [
        { id: 'own-sell', text: 'sell' },
        { id: 'own-ignore', text: 'Ignore', action: 'ignore' },
      ],
    };
    const ownQuestion = {
      id: 'own-model',
      text: 'Which model?',
      answers: [
        { id: 'own-a', text: 'Model A' },
        { id: 'own-b', text: 'Model B' },
        { id: 'own-model-ignore', text: 'Ignore', action: 'ignore' },
      ],
    };
    const ownTalk = {
      id: 'own-talk',
      type: 'flow',
      language: 'en',
      authorId: 'me',
      questions: [ownPair, ownQuestion],
    };
    ui.saveAnswerPreference(
      ownTalk,
      ownTalk.id,
      ownQuestion,
      'own-b',
      'Model B',
      [
        { questionId: ownPair.id, answerText: 'sell' },
        { questionId: ownQuestion.id, answerText: 'Model B' },
      ],
      'auto',
    );

    const incomingPair = {
      id: 'incoming-pair',
      text: 'sell',
      reciprocalTagContext: true,
      answers: [
        { id: 'incoming-buy', text: 'buy' },
        { id: 'incoming-ignore', text: 'Ignore', action: 'ignore' },
      ],
    };
    const incomingQuestion = {
      id: 'incoming-model',
      text: 'Which model?',
      answers: [
        { id: 'incoming-a', text: 'Model A' },
        { id: 'incoming-b', text: 'Model B' },
        { id: 'incoming-model-ignore', text: 'Ignore', action: 'ignore' },
      ],
    };
    const incomingTalk = {
      id: 'incoming-talk',
      type: 'flow',
      language: 'en',
      authorId: 'other',
      questions: [incomingPair, incomingQuestion],
    };

    expect(getFlattenedAnswerPreferences()).not.toEqual({});
    expect(
      ui.resolveAnswerPreferenceForTalkQuestion(
        incomingTalk,
        1,
        [],
        incomingQuestion,
        incomingTalk.id,
      ),
    ).toMatchObject({
      answerId: 'incoming-b',
      answerText: 'Model B',
      mode: 'auto',
      autoAnswerReason: 'FLATTENED_CONTEXT_MATCH',
    });
  });
});
