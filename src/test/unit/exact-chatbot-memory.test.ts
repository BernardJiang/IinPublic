import {
  appendAutoUse,
  createEmptyExactChatbotMemoryState,
  findAutoAnswer,
  findAutoAnswerMultiple,
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

describe('findAutoAnswerMultiple — spec §3.4 FR-QA-15/16, §30.8 "pick any that apply"', () => {
  const userId = 'u1';

  it('asks user when no exact question history exists', () => {
    const state = createEmptyExactChatbotMemoryState();
    expect(findAutoAnswerMultiple(state, userId, 'Which models?', ['Model A'])).toEqual({
      action: 'ASK_USER',
      reason: 'NO_HISTORY',
    });
  });

  it('pre-checks every distinct remembered option present in the current option set, not just the newest', () => {
    const state = createEmptyExactChatbotMemoryState();
    saveTemporaryAnswer(state, userId, 'Which models?', 'Model A', 1000);
    saveTemporaryAnswer(state, userId, 'Which models?', 'Model B', 2000);

    const result = findAutoAnswerMultiple(state, userId, 'Which models?', ['Model A', 'Model B', 'Model C'], 3000);

    expect(result.action).toBe('ANSWER');
    expect(result.reason).toBe('TEMPORARY_HISTORY_MATCH');
    expect(new Set(result.answerIds)).toEqual(new Set([makeAnswerId('Model A'), makeAnswerId('Model B')]));
  });

  it('only includes remembered options that are present in the current option set', () => {
    const state = createEmptyExactChatbotMemoryState();
    saveTemporaryAnswer(state, userId, 'Which models?', 'Model A', 1000);
    saveTemporaryAnswer(state, userId, 'Which models?', 'Model B', 2000);

    // Model B isn't offered this time — only Model A should come back.
    const result = findAutoAnswerMultiple(state, userId, 'Which models?', ['Model A', 'Model C'], 3000);

    expect(result.answerIds).toEqual([makeAnswerId('Model A')]);
  });

  it('asks user when history exists but none of it matches the current option set (fail-safe, never invents a selection)', () => {
    const state = createEmptyExactChatbotMemoryState();
    saveTemporaryAnswer(state, userId, 'Which models?', 'Model A', 1000);

    const result = findAutoAnswerMultiple(state, userId, 'Which models?', ['Model Z'], 2000);

    expect(result).toEqual({ action: 'ASK_USER', reason: 'NO_VALID_HISTORY_ANSWER' });
  });

  it('never duplicates an answer id even if it was saved more than once', () => {
    const state = createEmptyExactChatbotMemoryState();
    saveTemporaryAnswer(state, userId, 'Which models?', 'Model A', 1000);
    saveTemporaryAnswer(state, userId, 'Which models?', 'Model A', 2000);

    const result = findAutoAnswerMultiple(state, userId, 'Which models?', ['Model A'], 3000);

    expect(result.answerIds).toEqual([makeAnswerId('Model A')]);
  });

  it('PERMANENT mode returns a single-element array when the permanent answer is in the current options', () => {
    const state = createEmptyExactChatbotMemoryState();
    savePermanentAnswer(state, userId, 'Which models?', 'Model A', 1000);

    const result = findAutoAnswerMultiple(state, userId, 'Which models?', ['Model A', 'Model B'], 2000);

    expect(result).toMatchObject({
      action: 'ANSWER',
      reason: 'PERMANENT_MATCH',
      answerIds: [makeAnswerId('Model A')],
      answerTexts: ['Model A'],
    });
  });

  it('PERMANENT mode skips when the permanent answer is not in the current options', () => {
    const state = createEmptyExactChatbotMemoryState();
    savePermanentAnswer(state, userId, 'Which models?', 'Model A', 1000);

    const result = findAutoAnswerMultiple(state, userId, 'Which models?', ['Model B'], 2000);

    expect(result).toEqual({ action: 'SKIP', reason: 'PERMANENT_ANSWER_NOT_IN_CURRENT_OPTIONS' });
  });

  it('SUPPRESSED mode skips regardless of history', () => {
    const state = createEmptyExactChatbotMemoryState();
    saveSuppressedQuestion(state, userId, 'Which models?', 1000);

    const result = findAutoAnswerMultiple(state, userId, 'Which models?', ['Model A'], 2000);

    expect(result).toEqual({ action: 'SKIP', reason: 'QUESTION_SUPPRESSED' });
  });

  it('preference-set conflict refuses to auto-answer, mirroring findAutoAnswer', () => {
    const state = createEmptyExactChatbotMemoryState();
    // My own stored memory: I'm a buyer.
    saveTemporaryAnswer(state, userId, 'Which models?', 'Model A', 1000, undefined, 'buy');

    // Incoming talk is itself buy-tagged, so it only accepts 'sell' — a fellow buyer's own
    // memory must never auto-answer it (two buyers never match).
    const result = findAutoAnswerMultiple(state, userId, 'Which models?', ['Model A'], 2000, undefined, ['sell']);

    expect(result).toEqual({ action: 'ASK_USER', reason: 'PREFERENCE_CONFLICT' });
  });

  it('records auto-use events for every matched answer', () => {
    const state = createEmptyExactChatbotMemoryState();
    const savedA = saveTemporaryAnswer(state, userId, 'Which models?', 'Model A', 1000);
    const savedB = saveTemporaryAnswer(state, userId, 'Which models?', 'Model B', 2000);

    findAutoAnswerMultiple(state, userId, 'Which models?', ['Model A', 'Model B'], 3000);

    const questionId = savedA.questionId;
    expect(state.users[userId][questionId].history[savedA.eventId].autoUseCount).toBe(1);
    expect(state.users[userId][questionId].history[savedB.eventId].autoUseCount).toBe(1);
  });
});
