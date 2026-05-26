import {
  appendAutoUse,
  createEmptyExactChatbotMemoryState,
  findAutoAnswer,
  makeAnswerId,
  makeQuestionId,
  readHistory,
  savePermanentAnswer,
  saveSuppressedQuestion,
  saveTemporaryAnswer,
} from '../../shared/exact-chatbot-memory';

describe('exact-chatbot-memory', () => {
  const userId = 'u1';

  it('asks user when no exact question history exists', () => {
    const state = createEmptyExactChatbotMemoryState();
    expect(findAutoAnswer(state, userId, 'Favorite fruit?', ['Apple'])).toEqual({
      action: 'ASK_USER',
      reason: 'NO_HISTORY',
    });
  });

  it('reuses temporary history newest-to-oldest when current options contain an older answer', () => {
    const state = createEmptyExactChatbotMemoryState();
    saveTemporaryAnswer(state, userId, 'Favorite fruit?', 'Apple', 1000);
    saveTemporaryAnswer(state, userId, 'Favorite fruit?', 'Banana', 2000);

    const result = findAutoAnswer(state, userId, 'Favorite fruit?', ['Apple', 'Orange'], 3000);

    expect(result).toMatchObject({
      action: 'ANSWER',
      reason: 'TEMPORARY_HISTORY_MATCH',
      answerId: makeAnswerId('Apple'),
      answerText: 'Apple',
    });
    const questionId = makeQuestionId('Favorite fruit?');
    const matchedEvent = readHistory(state.users[userId][questionId]).find(
      (event) => event.answerText === 'Apple',
    );
    expect(matchedEvent?.autoUseCount).toBe(1);
    expect(matchedEvent?.lastAutoUsedAt).toBe(3000);
  });

  it('asks again when no temporary answer exists in current options', () => {
    const state = createEmptyExactChatbotMemoryState();
    saveTemporaryAnswer(state, userId, 'Favorite fruit?', 'Apple', 1000);

    expect(findAutoAnswer(state, userId, 'Favorite fruit?', ['Mango'])).toEqual({
      action: 'ASK_USER',
      reason: 'NO_VALID_HISTORY_ANSWER',
    });
  });

  it('uses permanent answer when present and does not inspect temporary history when missing', () => {
    const state = createEmptyExactChatbotMemoryState();
    saveTemporaryAnswer(state, userId, 'Favorite fruit?', 'Apple', 1000);
    savePermanentAnswer(state, userId, 'Favorite fruit?', 'Orange', 2000);

    expect(findAutoAnswer(state, userId, 'Favorite fruit?', ['Orange'], 3000)).toMatchObject({
      action: 'ANSWER',
      reason: 'PERMANENT_MATCH',
      answerId: makeAnswerId('Orange'),
    });
    expect(findAutoAnswer(state, userId, 'Favorite fruit?', ['Apple'], 4000)).toEqual({
      action: 'SKIP',
      reason: 'PERMANENT_ANSWER_NOT_IN_CURRENT_OPTIONS',
    });
  });

  it('skips suppressed questions', () => {
    const state = createEmptyExactChatbotMemoryState();
    saveTemporaryAnswer(state, userId, 'Favorite color?', 'Blue', 1000);
    saveSuppressedQuestion(state, userId, 'Favorite color?', 2000);

    expect(findAutoAnswer(state, userId, 'Favorite color?', ['Blue'])).toEqual({
      action: 'SKIP',
      reason: 'QUESTION_SUPPRESSED',
    });
  });

  it('isolates identical question memory by language while retaining legacy English reads', () => {
    const state = createEmptyExactChatbotMemoryState();
    saveTemporaryAnswer(state, userId, 'Tea?', 'Yes', 1000, { language: 'en' });
    saveTemporaryAnswer(state, userId, 'Tea?', 'No', 2000, { language: 'zh' });
    savePermanentAnswer(state, userId, 'Legacy?', 'Old answer', 3000);

    expect(findAutoAnswer(state, userId, 'Tea?', ['Yes'], 4000, { language: 'zh' })).toEqual({
      action: 'ASK_USER',
      reason: 'NO_VALID_HISTORY_ANSWER',
    });
    expect(findAutoAnswer(state, userId, 'Tea?', ['Yes'], 4000, { language: 'en' })).toMatchObject({
      action: 'ANSWER',
      answerText: 'Yes',
    });
    expect(findAutoAnswer(state, userId, 'Legacy?', ['Old answer'], 4000, { language: 'en' })).toMatchObject({
      action: 'ANSWER',
      answerText: 'Old answer',
    });
    expect(findAutoAnswer(state, userId, 'Legacy?', ['Old answer'], 4000, { language: 'zh' })).toEqual({
      action: 'ASK_USER',
      reason: 'NO_HISTORY',
    });
  });

  it('matches exact normalized text ids and rejects different case by default', () => {
    expect(makeQuestionId(' Favorite fruit? ')).toBe(makeQuestionId('Favorite fruit?'));
    expect(makeAnswerId('Apple')).not.toBe(makeAnswerId('apple'));
  });

  it('appendAutoUse records append-only use events and cached metrics', () => {
    const state = createEmptyExactChatbotMemoryState();
    const saved = saveTemporaryAnswer(state, userId, 'Favorite fruit?', 'Apple', 1000);

    appendAutoUse(state, userId, saved.questionId, saved.eventId, 2000);
    appendAutoUse(state, userId, saved.questionId, saved.eventId, 3000);

    const event = state.users[userId][saved.questionId].history[saved.eventId];
    expect(Object.keys(event.uses || {})).toHaveLength(2);
    expect(event.autoUseCount).toBe(2);
    expect(event.lastAutoUsedAt).toBe(3000);
  });
});
