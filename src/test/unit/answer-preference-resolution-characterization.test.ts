/** @jest-environment jsdom */

import { computeTalkIdFromTalkData } from '../../shared/cid';
import { buildAnswerPreferenceLookupKey, immediateParentQAPairs } from '../../shared/flattened-answer-keys';
import {
  LOCAL_EXACT_CHATBOT_USER_ID,
  saveTemporaryAnswer,
} from '../../shared/exact-chatbot-memory';
import {
  getExactChatbotMemory,
  getFlattenedAnswerPreferences,
  getQuestionDefaultContracts,
  setExactChatbotMemory,
} from '../../web/ui/answer-preferences-storage';
import { UIManager } from '../../web/ui/ui-manager';

type PreferenceResolution = {
  answerId: string;
  answerIds?: string[];
  answerText: string;
  mode: string;
  autoAnswerReason?: string;
  contextHash?: string;
} | null;

type PreferenceUi = {
  currentUser?: { id: string };
  resolveAnswerPreferenceForTalkQuestion(
    talk: any,
    questionIndex: number,
    previousQAPairs: Array<{ questionText: string; answerText: string; contextHash?: string }>,
    currentQuestion: any,
    talkInstanceId: string,
  ): PreferenceResolution;
  saveAnswerPreference(
    talk: any,
    talkInstanceId: string,
    currentQuestion: any,
    answerId: string,
    answerText: string,
    fullSessionAnswersIncludingCurrent: Array<{ questionId: string; answerId?: string; answerIds?: string[]; answerText?: string; contextHash?: string }>,
    mode?: 'auto' | 'manual' | 'whenever' | 'permanent' | 'suppressed',
  ): string;
  getMySourceTalkIdForQuestionText(questionText: string, language?: string): string | undefined;
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

  it('repeats the saved contextual choice and ignores conflicting legacy exact-text memory', () => {
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
    ui.saveAnswerPreference(talk, talk.id, question, 'current-b', 'Model B', [
      { questionId: question.id, answerText: 'Model B' },
    ], 'auto');
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
      autoAnswerReason: 'KNOWN_CONTEXT_MATCH',
    });
  });

  it('does not infer a multi-select choice from contextless legacy answer history', () => {
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

    expect(ui.resolveAnswerPreferenceForTalkQuestion(talk, 0, [], question, talk.id)).toBeNull();
  });

  it('reuses one atomic multi-select set only under the identical complete context', () => {
    const ui = preferenceUi();
    const sourceQuestion = {
      id: 'source-multi',
      text: 'Which models?',
      answerSelectionMode: 'multiple',
      answers: [
        { id: 'source-a', text: 'Model A' },
        { id: 'source-b', text: 'Model B' },
        { id: 'source-c', text: 'Model C' },
      ],
    };
    const sourceTalk = { id: 'source-multi-talk', type: 'flow', language: 'en', questions: [sourceQuestion] };
    const selected = [{
      questionId: sourceQuestion.id,
      answerId: 'source-a',
      answerIds: ['source-a', 'source-b'],
      answerText: 'Model A, Model B',
    }];
    ui.saveAnswerPreference(sourceTalk, sourceTalk.id, sourceQuestion, 'source-a', 'Model A', selected, 'auto');
    ui.saveAnswerPreference(sourceTalk, sourceTalk.id, sourceQuestion, 'source-b', 'Model B', selected, 'auto');

    expect(Object.values(getFlattenedAnswerPreferences())[0]).toMatchObject({
      answerTexts: ['Model A', 'Model B'],
      mode: 'temporary',
    });

    const reorderedQuestion = {
      ...sourceQuestion,
      id: 'incoming-multi',
      answers: [
        { id: 'incoming-c', text: 'Model C' },
        { id: 'incoming-b', text: 'Model B' },
        { id: 'incoming-a', text: 'Model A' },
      ],
    };
    const reorderedTalk = { ...sourceTalk, id: 'incoming-multi-talk', questions: [reorderedQuestion] };
    expect(ui.resolveAnswerPreferenceForTalkQuestion(reorderedTalk, 0, [], reorderedQuestion, reorderedTalk.id))
      .toMatchObject({
        answerId: 'incoming-a',
        answerIds: ['incoming-a', 'incoming-b'],
        answerText: 'Model A, Model B',
        mode: 'auto',
        autoAnswerReason: 'KNOWN_CONTEXT_MATCH',
      });

    const changedQuestion = {
      ...reorderedQuestion,
      id: 'changed-multi',
      answers: reorderedQuestion.answers.slice(0, 2),
    };
    const changedTalk = { ...sourceTalk, id: 'changed-multi-talk', questions: [changedQuestion] };
    expect(ui.resolveAnswerPreferenceForTalkQuestion(changedTalk, 0, [], changedQuestion, changedTalk.id))
      .toBeNull();
  });

  it('requires the same rolling path and complete choice set', () => {
    const ui = preferenceUi();
    const q1 = {
      id: 'q1', text: 'Buying fruit?',
      answers: [{ id: 'yes', text: 'Yes' }, { id: 'no', text: 'No' }],
    };
    const q2 = {
      id: 'q2', text: 'Favourite fruit?',
      answers: [{ id: 'apple', text: 'Apple' }, { id: 'banana', text: 'Banana' }, { id: 'strawberry', text: 'Strawberries' }],
    };
    const source = { id: 'source', type: 'flow', language: 'en', questions: [q1, q2] };
    const q1Context = ui.saveAnswerPreference(source, source.id, q1, 'yes', 'Yes', [
      { questionId: q1.id, answerText: 'Yes' },
    ], 'auto');
    ui.saveAnswerPreference(source, source.id, q2, 'apple', 'Apple', [
      { questionId: q1.id, answerText: 'Yes', contextHash: q1Context },
      { questionId: q2.id, answerText: 'Apple' },
    ], 'auto');
    const knownParent = [{ questionText: q1.text, answerText: 'Yes', contextHash: q1Context }];

    const reorderedQ2 = { ...q2, answers: [q2.answers[2], q2.answers[0], q2.answers[1]] };
    const reorderedTalk = { ...source, id: 'reordered', questions: [q1, reorderedQ2] };
    expect(ui.resolveAnswerPreferenceForTalkQuestion(reorderedTalk, 1, knownParent, reorderedQ2, reorderedTalk.id))
      .toMatchObject({ answerText: 'Apple', autoAnswerReason: 'KNOWN_CONTEXT_MATCH' });

    const expandedQ2 = { ...q2, answers: [...q2.answers, { id: 'orange', text: 'Orange' }] };
    const expandedTalk = { ...source, id: 'expanded', questions: [q1, expandedQ2] };
    expect(ui.resolveAnswerPreferenceForTalkQuestion(expandedTalk, 1, knownParent, expandedQ2, expandedTalk.id))
      .toBeNull();

    expect(ui.resolveAnswerPreferenceForTalkQuestion(
      source,
      1,
      [{ questionText: q1.text, answerText: 'No', contextHash: q1Context }],
      q2,
      source.id,
    )).toBeNull();
  });

  it('uses an identical root-frame answer at a later flow position, with exact context taking precedence', () => {
    const ui = preferenceUi();
    const rootFruit = {
      id: 'root-fruit',
      text: 'Which fruit do you like?',
      answers: [
        { id: 'root-apple', text: 'Apple' },
        { id: 'root-banana', text: 'Banana' },
        { id: 'root-pears', text: 'Pears' },
      ],
    };
    const rootTalk = { id: 'root-talk', type: 'flow', language: 'en', questions: [rootFruit] };
    const rootFruitHash = ui.saveAnswerPreference(rootTalk, rootTalk.id, rootFruit, 'root-apple', 'Apple', [
      { questionId: rootFruit.id, answerText: 'Apple' },
    ], 'auto');

    const likesFruit = {
      id: 'likes-fruit',
      text: 'Do you like fruits?',
      answers: [{ id: 'yes', text: 'Yes' }, { id: 'no', text: 'No' }],
    };
    const nestedFruit = {
      id: 'nested-fruit',
      text: rootFruit.text,
      answers: [
        { id: 'nested-banana', text: 'Banana' },
        { id: 'nested-pears', text: 'Pears' },
        { id: 'nested-apple', text: 'Apple' },
      ],
    };
    const flowTalk = { id: 'flow-talk', type: 'flow', language: 'en', questions: [likesFruit, nestedFruit] };
    const parentHash = ui.saveAnswerPreference(flowTalk, flowTalk.id, likesFruit, 'yes', 'Yes', [
      { questionId: likesFruit.id, answerText: 'Yes' },
    ], 'auto');
    const knownParent = [{ questionText: likesFruit.text, answerText: 'Yes', contextHash: parentHash }];

    const inheritedRoot = ui.resolveAnswerPreferenceForTalkQuestion(
      flowTalk,
      1,
      knownParent,
      nestedFruit,
      flowTalk.id,
    );
    expect(inheritedRoot).toMatchObject({
        answerId: 'nested-apple',
        answerText: 'Apple',
        autoAnswerReason: 'KNOWN_ROOT_CONTEXT_MATCH',
      });
    expect(inheritedRoot?.contextHash).not.toBe(rootFruitHash);

    const changedFruit = {
      ...nestedFruit,
      id: 'changed-fruit',
      answers: [
        { id: 'changed-banana', text: 'Banana' },
        { id: 'changed-kiwi', text: 'Kiwi' },
        { id: 'changed-apple', text: 'Apple' },
      ],
    };
    const changedTalk = { ...flowTalk, id: 'changed-talk', questions: [likesFruit, changedFruit] };
    expect(ui.resolveAnswerPreferenceForTalkQuestion(changedTalk, 1, knownParent, changedFruit, changedTalk.id))
      .toBeNull();

    ui.saveAnswerPreference(flowTalk, flowTalk.id, nestedFruit, 'nested-banana', 'Banana', [
      { questionId: likesFruit.id, answerText: 'Yes', contextHash: parentHash },
      { questionId: nestedFruit.id, answerText: 'Banana' },
    ], 'manual');
    expect(ui.resolveAnswerPreferenceForTalkQuestion(flowTalk, 1, knownParent, nestedFruit, flowTalk.id))
      .toMatchObject({
        answerId: 'nested-apple',
        answerText: 'Apple',
        autoAnswerReason: 'KNOWN_ROOT_CONTEXT_MATCH',
      });

    ui.saveAnswerPreference(flowTalk, flowTalk.id, nestedFruit, 'nested-banana', 'Banana', [
      { questionId: likesFruit.id, answerText: 'Yes', contextHash: parentHash },
      { questionId: nestedFruit.id, answerText: 'Banana' },
    ], 'auto');
    expect(ui.resolveAnswerPreferenceForTalkQuestion(flowTalk, 1, knownParent, nestedFruit, flowTalk.id))
      .toMatchObject({
        answerId: 'nested-banana',
        answerText: 'Banana',
        autoAnswerReason: 'KNOWN_CONTEXT_MATCH',
      });
  });

  it('orders Whenever offered contracts without generating choice-set combinations', () => {
    const ui = preferenceUi();
    const fruitQuestion = {
      id: 'fruit-original',
      text: 'Which fruit do you like?',
      answers: [
        { id: 'apple-original', text: 'Apple' },
        { id: 'banana-original', text: 'Banana' },
        { id: 'pears-original', text: 'Pears' },
      ],
    };
    const originalTalk = { id: 'fruit-original-talk', type: 'flow', language: 'en', questions: [fruitQuestion] };
    ui.saveAnswerPreference(originalTalk, originalTalk.id, fruitQuestion, 'apple-original', 'Apple', [
      { questionId: fruitQuestion.id, answerText: 'Apple' },
    ], 'whenever');

    // A broad contract is stored separately and does not materialize this exact frame or any
    // possible subset into the flattened context map.
    expect(getFlattenedAnswerPreferences()).toEqual({});
    expect(Object.values(getQuestionDefaultContracts())[0]?.answers.map((answer) => answer.answerText))
      .toEqual(['Apple']);

    const carolQuestion = {
      id: 'fruit-carol',
      text: fruitQuestion.text,
      answers: [
        { id: 'banana-carol', text: 'Banana' },
        { id: 'apple-carol', text: 'Apple' },
      ],
    };
    const carolTalk = { id: 'fruit-carol-talk', type: 'flow', language: 'en', questions: [carolQuestion] };
    expect(ui.resolveAnswerPreferenceForTalkQuestion(carolTalk, 0, [], carolQuestion, carolTalk.id))
      .toMatchObject({
        answerId: 'apple-carol',
        answerText: 'Apple',
        autoAnswerReason: 'KNOWN_QUESTION_DEFAULT',
      });

    const fourChoiceQuestion = {
      id: 'fruit-four',
      text: fruitQuestion.text,
      answers: [
        { id: 'banana-four', text: 'Banana' },
        { id: 'pears-four', text: 'Pears' },
        { id: 'apple-four', text: 'Apple' },
        { id: 'kiwi-four', text: 'Kiwi' },
      ],
    };
    const fourChoiceTalk = { id: 'fruit-four-talk', type: 'flow', language: 'en', questions: [fourChoiceQuestion] };
    expect(ui.resolveAnswerPreferenceForTalkQuestion(fourChoiceTalk, 0, [], fourChoiceQuestion, fourChoiceTalk.id))
      .toMatchObject({ answerText: 'Apple', autoAnswerReason: 'KNOWN_QUESTION_DEFAULT' });

    // Choosing Kiwi under the same broad contract moves it ahead of Apple; Apple remains the
    // exact fallback whenever Kiwi is absent.
    ui.saveAnswerPreference(fourChoiceTalk, fourChoiceTalk.id, fourChoiceQuestion, 'kiwi-four', 'Kiwi', [
      { questionId: fourChoiceQuestion.id, answerText: 'Kiwi' },
    ], 'whenever');
    expect(Object.values(getQuestionDefaultContracts())[0]?.answers.map((answer) => answer.answerText))
      .toEqual(['Kiwi', 'Apple']);
    expect(ui.resolveAnswerPreferenceForTalkQuestion(fourChoiceTalk, 0, [], fourChoiceQuestion, fourChoiceTalk.id))
      .toMatchObject({ answerText: 'Kiwi', autoAnswerReason: 'KNOWN_QUESTION_DEFAULT' });
    expect(ui.resolveAnswerPreferenceForTalkQuestion(carolTalk, 0, [], carolQuestion, carolTalk.id))
      .toMatchObject({ answerText: 'Apple', autoAnswerReason: 'KNOWN_QUESTION_DEFAULT' });

    const unavailableQuestion = {
      ...fruitQuestion,
      id: 'fruit-unavailable',
      answers: [{ id: 'banana-only', text: 'Banana' }, { id: 'pears-only', text: 'Pears' }],
    };
    const unavailableTalk = { ...originalTalk, id: 'fruit-unavailable-talk', questions: [unavailableQuestion] };
    expect(ui.resolveAnswerPreferenceForTalkQuestion(
      unavailableTalk,
      0,
      [],
      unavailableQuestion,
      unavailableTalk.id,
    )).toBeNull();

    // The more-specific exact contract always wins over the ordered question defaults.
    ui.saveAnswerPreference(carolTalk, carolTalk.id, carolQuestion, 'banana-carol', 'Banana', [
      { questionId: carolQuestion.id, answerText: 'Banana' },
    ], 'auto');
    expect(ui.resolveAnswerPreferenceForTalkQuestion(carolTalk, 0, [], carolQuestion, carolTalk.id))
      .toMatchObject({ answerText: 'Banana', autoAnswerReason: 'KNOWN_CONTEXT_MATCH' });
  });

  it('does not let a previously answered route sibling alter another branch context', () => {
    const ui = preferenceUi();
    const root = {
      id: 'root', text: 'Product?', contextPath: [],
      answers: [{ id: 'phone', text: 'Phone', nextQuestionIds: ['model', 'condition'] }],
    };
    const model = {
      id: 'model', text: 'Model?', contextPath: [{ questionId: 'root', answerId: 'phone' }],
      answers: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }],
    };
    const condition = {
      id: 'condition', text: 'Condition?', contextPath: [{ questionId: 'root', answerId: 'phone' }],
      answers: [{ id: 'new', text: 'New' }, { id: 'used', text: 'Used' }],
    };
    const talk = { id: 'route', type: 'route', language: 'en', questions: [root, model, condition] };
    const rootHash = ui.saveAnswerPreference(talk, talk.id, root, 'phone', 'Phone', [
      { questionId: root.id, answerId: 'phone', answerText: 'Phone' },
    ], 'auto');
    const modelHash = ui.saveAnswerPreference(talk, talk.id, model, 'a', 'A', [
      { questionId: root.id, answerId: 'phone', answerText: 'Phone', contextHash: rootHash },
      { questionId: model.id, answerId: 'a', answerText: 'A' },
    ], 'auto');
    ui.saveAnswerPreference(talk, talk.id, condition, 'used', 'Used', [
      { questionId: root.id, answerId: 'phone', answerText: 'Phone', contextHash: rootHash },
      { questionId: model.id, answerId: 'a', answerText: 'A', contextHash: modelHash },
      { questionId: condition.id, answerId: 'used', answerText: 'Used' },
    ], 'auto');

    const previous = immediateParentQAPairs(talk, condition, [
      { questionId: root.id, answerId: 'phone', answerText: 'Phone', contextHash: rootHash },
      { questionId: model.id, answerId: 'a', answerText: 'A', contextHash: modelHash },
    ]);
    expect(ui.resolveAnswerPreferenceForTalkQuestion(talk, 2, previous, condition, talk.id)).toMatchObject({
      answerText: 'Used',
      autoAnswerReason: 'KNOWN_CONTEXT_MATCH',
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
      autoAnswerReason: 'KNOWN_CONTEXT_MATCH',
    });
  });

  it('keeps an ad-hoc answer to someone else\'s Pair-tag talk precisely tag-scoped without an own talk', () => {
    const ui = preferenceUi('me');
    const pair = {
      id: 'pair',
      text: 'buy',
      reciprocalTagContext: true,
      answers: [{ id: 'sell', text: 'sell' }, { id: 'ignore', text: 'Ignore', isIgnore: true }],
    };
    const sourceQuestion = {
      id: 'source-model',
      text: 'Which model?',
      answers: [{ id: 'source-a', text: 'Model A' }, { id: 'source-b', text: 'Model B' }],
    };
    const sourceTalk = {
      id: 'their-first', type: 'flow', language: 'en', authorId: 'other', questions: [pair, sourceQuestion],
    };
    ui.saveAnswerPreference(sourceTalk, sourceTalk.id, sourceQuestion, 'source-b', 'Model B', [
      { questionId: pair.id, answerText: 'sell' },
      { questionId: sourceQuestion.id, answerText: 'Model B' },
    ], 'auto');

    const nextQuestion = {
      id: 'next-model',
      text: 'Which model?',
      answers: [{ id: 'next-a', text: 'Model A' }, { id: 'next-b', text: 'Model B' }],
    };
    const nextTalk = {
      id: 'their-next', type: 'flow', language: 'en', authorId: 'another', questions: [pair, nextQuestion],
    };
    expect(ui.resolveAnswerPreferenceForTalkQuestion(nextTalk, 1, [], nextQuestion, nextTalk.id)).toMatchObject({
      answerId: 'next-b',
      answerText: 'Model B',
      autoAnswerReason: 'KNOWN_CONTEXT_MATCH',
    });

    const expectedKey = buildAnswerPreferenceLookupKey(
      sourceTalk,
      computeTalkIdFromTalkData(sourceTalk),
      1,
      [],
      sourceQuestion.text,
      { mySelfTag: 'sell', counterpartTag: 'buy' },
    );
    expect(getFlattenedAnswerPreferences()[expectedKey]).toBeDefined();
  });

  // docs/TODO.md §JJ residual gap: a chatbot auto-reply formed from memory taught by self-
  // answering one of my own talks should be traceable back to that specific talkId.
  describe('sourceTalkId — docs/TODO.md §JJ residual gap', () => {
    it('records my own talkId when self-answering my own talk', () => {
      const ui = preferenceUi('me');
      const question = { id: 'q1', text: 'Ride to the airport?', answers: [{ id: 'yes', text: 'Yes' }] };
      const ownTalk = { id: 'my-airport-listing', type: 'flow', language: 'en', authorId: 'me', questions: [question] };

      ui.saveAnswerPreference(ownTalk, ownTalk.id, question, 'yes', 'Yes', [
        { questionId: question.id, answerText: 'Yes' },
      ], 'auto');

      expect(ui.getMySourceTalkIdForQuestionText('Ride to the airport?')).toBe('my-airport-listing');
    });

    it('does not record a source talkId when answering someone else\'s incoming talk', () => {
      const ui = preferenceUi('me');
      const question = { id: 'q1', text: 'Looking for a ride?', answers: [{ id: 'yes', text: 'Yes' }] };
      const incomingTalk = { id: 'their-talk', type: 'flow', language: 'en', authorId: 'other', questions: [question] };

      ui.saveAnswerPreference(incomingTalk, incomingTalk.id, question, 'yes', 'Yes', [
        { questionId: question.id, answerText: 'Yes' },
      ], 'auto');

      expect(ui.getMySourceTalkIdForQuestionText('Looking for a ride?')).toBeUndefined();
    });

    it('two of my own talks with different questions resolve to their own distinct source talkId', () => {
      const ui = preferenceUi('me');
      const airportQuestion = { id: 'q1', text: 'Ride to the airport?', answers: [{ id: 'yes', text: 'Yes' }] };
      const downtownQuestion = { id: 'q1', text: 'Ride downtown?', answers: [{ id: 'yes', text: 'Yes' }] };
      const airportTalk = { id: 'listing-airport', type: 'flow', language: 'en', authorId: 'me', questions: [airportQuestion] };
      const downtownTalk = { id: 'listing-downtown', type: 'flow', language: 'en', authorId: 'me', questions: [downtownQuestion] };

      ui.saveAnswerPreference(airportTalk, airportTalk.id, airportQuestion, 'yes', 'Yes', [
        { questionId: airportQuestion.id, answerText: 'Yes' },
      ], 'auto');
      ui.saveAnswerPreference(downtownTalk, downtownTalk.id, downtownQuestion, 'yes', 'Yes', [
        { questionId: downtownQuestion.id, answerText: 'Yes' },
      ], 'auto');

      expect(ui.getMySourceTalkIdForQuestionText('Ride to the airport?')).toBe('listing-airport');
      expect(ui.getMySourceTalkIdForQuestionText('Ride downtown?')).toBe('listing-downtown');
    });
  });
});
