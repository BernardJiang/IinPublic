/** @jest-environment jsdom */

jest.mock('../../web/ui/preferences-dialog', () => ({
  showPreferencesDialog: jest.fn(),
}));

import {
  applyPreferenceModeToExactMemory,
  deleteAnswerPreference,
  getAnswerPreferencesForDisplay,
  normalizePreferenceMode,
  openAnswerPreferencesDialog,
  type OpenAnswerPreferencesDialogDeps,
} from '../../web/ui/answer-preference-mutations';
import { showPreferencesDialog as showPreferencesDialogMock } from '../../web/ui/preferences-dialog';
import {
  getAnswerPreferences,
  getExactChatbotMemory,
  getFlattenedAnswerPreferences,
  getQuestionDefaultContracts,
  setAnswerPreferences,
  setExactChatbotMemory,
  setFlattenedAnswerPreferences,
  setQuestionDefaultContracts,
  type AnswerPreferenceEntry,
} from '../../web/ui/answer-preferences-storage';
import {
  buildAnswerIdentityHash,
  putQuestionDefault,
} from '../../shared/question-default-contracts';
import {
  LOCAL_EXACT_CHATBOT_USER_ID,
  makeQuestionId,
  savePermanentAnswer,
} from '../../shared/exact-chatbot-memory';

function pref(overrides: Partial<AnswerPreferenceEntry> = {}): AnswerPreferenceEntry {
  return {
    answerId: 'a1',
    answerText: 'Yes',
    mode: 'manual',
    language: 'en',
    questionText: 'Do you like cats?',
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
});

describe('normalizePreferenceMode', () => {
  it.each([
    ['auto', 2, 'temporary'],
    ['temporary', 2, 'temporary'],
    ['whenever', 2, 'whenever'],
    ['auto', undefined, 'manual'],
    ['permanent', 2, 'manual'],
    ['suppressed', 2, 'manual'],
    ['manual', 2, 'manual'],
    ['garbage', 2, 'manual'],
  ])('maps %s at context version %s to %s', (input, contextVersion, expected) => {
    expect(normalizePreferenceMode(input, contextVersion)).toBe(expected);
  });
});

describe('applyPreferenceModeToExactMemory', () => {
  it('does nothing when questionText is blank', () => {
    applyPreferenceModeToExactMemory(pref({ questionText: '  ' }), 'temporary');
    expect(getExactChatbotMemory().users[LOCAL_EXACT_CHATBOT_USER_ID]).toBeUndefined();
  });

  it('does not create weaker exact-question memory for a contextual mode', () => {
    applyPreferenceModeToExactMemory(pref(), 'temporary');
    expect(getExactChatbotMemory().users[LOCAL_EXACT_CHATBOT_USER_ID]).toBeUndefined();
  });

  it('clears an existing legacy exact-question entry', () => {
    const memory = getExactChatbotMemory();
    savePermanentAnswer(memory, LOCAL_EXACT_CHATBOT_USER_ID, 'Do you like cats?', 'Yes', undefined, { language: 'en' });
    setExactChatbotMemory(memory);
    const qid = makeQuestionId('Do you like cats?', { language: 'en' });
    expect(getExactChatbotMemory().users[LOCAL_EXACT_CHATBOT_USER_ID]?.[qid]).toBeDefined();
    applyPreferenceModeToExactMemory(pref(), 'manual');
    expect(getExactChatbotMemory().users[LOCAL_EXACT_CHATBOT_USER_ID]?.[qid]).toBeUndefined();
  });
});

describe('deleteAnswerPreference', () => {
  it('deletes a regular preference and clears any legacy exact-memory entry', () => {
    setAnswerPreferences({ k1: pref() });
    const memory = getExactChatbotMemory();
    savePermanentAnswer(memory, LOCAL_EXACT_CHATBOT_USER_ID, 'Do you like cats?', 'Yes', undefined, { language: 'en' });
    setExactChatbotMemory(memory);
    const qid = makeQuestionId('Do you like cats?', { language: 'en' });
    expect(getExactChatbotMemory().users[LOCAL_EXACT_CHATBOT_USER_ID]?.[qid]).toBeDefined();

    deleteAnswerPreference('k1');
    expect(getAnswerPreferences().k1).toBeUndefined();
    expect(getExactChatbotMemory().users[LOCAL_EXACT_CHATBOT_USER_ID]?.[qid]).toBeUndefined();
  });

  it('deletes a flat_ preference from the flattened map instead of the regular one', () => {
    setFlattenedAnswerPreferences({ flat_k1: pref() });
    setAnswerPreferences({ flat_k1: pref({ answerText: 'should not be touched' }) });
    deleteAnswerPreference('flat_k1');
    expect(getFlattenedAnswerPreferences().flat_k1).toBeUndefined();
    expect(getAnswerPreferences().flat_k1).toBeDefined();
  });

  it('deletes both compatibility records for one logical preference', () => {
    setAnswerPreferences({ legacy_k1: pref({ flatKey: 'flat_k1' }) });
    setFlattenedAnswerPreferences({ flat_k1: pref({ flatKey: 'flat_k1' }) });
    deleteAnswerPreference('flat_k1');
    expect(getFlattenedAnswerPreferences().flat_k1).toBeUndefined();
    expect(getAnswerPreferences().legacy_k1).toBeUndefined();
  });

  it('deletes the linked Whenever offered answer contract', () => {
    const questionDefaultKey = 'question-default-key';
    const answerIdentityHash = buildAnswerIdentityHash('Yes');
    const defaults = {};
    putQuestionDefault(defaults, {
      questionKey: questionDefaultKey,
      questionText: 'Do you like cats?',
      answerText: 'Yes',
    });
    setQuestionDefaultContracts(defaults);
    setAnswerPreferences({
      k1: pref({ mode: 'whenever', questionDefaultKey, answerIdentityHash }),
    });

    deleteAnswerPreference('k1');
    expect(getQuestionDefaultContracts()).toEqual({});
  });

  it('is a no-op when the key does not exist', () => {
    expect(() => deleteAnswerPreference('missing')).not.toThrow();
  });
});

describe('openAnswerPreferencesDialog', () => {
  function deps(overrides: Partial<OpenAnswerPreferencesDialogDeps> = {}): OpenAnswerPreferencesDialogDeps {
    return {
      showNotification: jest.fn(),
      t: (key) => key,
      formatUiDate: (d) => d.toISOString(),
      ...overrides,
    };
  }

  function capturedOptions() {
    return (showPreferencesDialogMock as jest.Mock).mock.calls[0][0];
  }

  it('merges regular and flattened preferences for getPreferences', () => {
    setAnswerPreferences({ k1: pref({ answerId: 'a1' }) });
    setFlattenedAnswerPreferences({ flat_k1: pref({ answerId: 'a2' }) });
    openAnswerPreferencesDialog(deps());
    const opts = capturedOptions();
    const merged = opts.getPreferences();
    expect(merged.k1.answerId).toBe('a1');
    expect(merged.flat_k1.answerId).toBe('a2');
  });

  it('shows one item when a tag answer exists in both compatibility stores', () => {
    const tennis = pref({
      questionText: 'tennis',
      answerText: 'tennis',
      flatKey: 'flat_tennis',
      timestamp: '2026-09-29T21:41:30.000Z',
    });
    setAnswerPreferences({ talk1_question1: tennis });
    setFlattenedAnswerPreferences({ flat_tennis: { ...tennis } });

    expect(getAnswerPreferencesForDisplay()).toEqual({ flat_tennis: tennis });
    openAnswerPreferencesDialog(deps());
    expect(Object.keys(capturedOptions().getPreferences())).toEqual(['flat_tennis']);
  });

  it('updateAnswer patches the regular preference and notifies', () => {
    setAnswerPreferences({ k1: pref() });
    const d = deps();
    openAnswerPreferencesDialog(d);
    capturedOptions().updateAnswer('k1', 'a2', 'No');
    expect(getAnswerPreferences().k1.answerId).toBe('a2');
    expect(getAnswerPreferences().k1.answerText).toBe('No');
    expect(d.showNotification).toHaveBeenCalledWith('preferencesAnswerUpdated', 'success');
  });

  it('updateAnswer patches the flattened preference when the key is flat_-prefixed', () => {
    setFlattenedAnswerPreferences({ flat_k1: pref() });
    openAnswerPreferencesDialog(deps());
    capturedOptions().updateAnswer('flat_k1', 'a2', 'No');
    expect(getFlattenedAnswerPreferences().flat_k1.answerId).toBe('a2');
  });

  it('updateAnswer keeps linked legacy and flattened records in sync', () => {
    setAnswerPreferences({ legacy_k1: pref({ flatKey: 'flat_k1' }) });
    setFlattenedAnswerPreferences({ flat_k1: pref({ flatKey: 'flat_k1' }) });
    openAnswerPreferencesDialog(deps());
    capturedOptions().updateAnswer('flat_k1', 'a2', 'No');
    expect(getFlattenedAnswerPreferences().flat_k1.answerText).toBe('No');
    expect(getAnswerPreferences().legacy_k1.answerText).toBe('No');
  });

  it('updateAnswer is a no-op when the key does not exist', () => {
    const d = deps();
    openAnswerPreferencesDialog(d);
    capturedOptions().updateAnswer('missing', 'a2', 'No');
    expect(d.showNotification).not.toHaveBeenCalled();
  });

  it('updateMode writes the new mode and notifies with the mode-specific key', () => {
    setAnswerPreferences({ k1: pref({ mode: 'manual', contextVersion: 2 }) });
    const d = deps();
    openAnswerPreferencesDialog(d);
    capturedOptions().updateMode('k1', 'temporary');
    expect(getAnswerPreferences().k1.mode).toBe('temporary');
    expect(d.showNotification).toHaveBeenCalledWith('preferencesModeChangedTemporary', 'success');
  });

  it('updateMode keeps linked legacy and flattened records in sync', () => {
    setAnswerPreferences({ legacy_k1: pref({ flatKey: 'flat_k1', contextVersion: 2 }) });
    setFlattenedAnswerPreferences({ flat_k1: pref({ flatKey: 'flat_k1', contextVersion: 2 }) });
    openAnswerPreferencesDialog(deps());
    capturedOptions().updateMode('flat_k1', 'temporary');
    expect(getFlattenedAnswerPreferences().flat_k1.mode).toBe('temporary');
    expect(getAnswerPreferences().legacy_k1.mode).toBe('temporary');
  });

  it('promotes an answer to Whenever offered and removes it again when mode changes', () => {
    setAnswerPreferences({
      k1: pref({
        mode: 'manual',
        contextVersion: 2,
        flatKey: 'flat_context',
        questionDefaultKey: 'question-default-key',
        answerIdentityHash: buildAnswerIdentityHash('Yes'),
      }),
    });
    const d = deps();
    openAnswerPreferencesDialog(d);

    capturedOptions().updateMode('k1', 'whenever');
    expect(getAnswerPreferences().k1.mode).toBe('whenever');
    expect(Object.values(getQuestionDefaultContracts())[0]?.answers.map((answer) => answer.answerText))
      .toEqual(['Yes']);
    expect(d.showNotification).toHaveBeenCalledWith('preferencesModeChangedWhenever', 'success');

    capturedOptions().updateMode('k1', 'manual');
    expect(getQuestionDefaultContracts()).toEqual({});
  });

  it('deletePreference removes the entry and notifies', () => {
    setAnswerPreferences({ k1: pref() });
    const d = deps();
    openAnswerPreferencesDialog(d);
    capturedOptions().deletePreference('k1');
    expect(getAnswerPreferences().k1).toBeUndefined();
    expect(d.showNotification).toHaveBeenCalledWith('preferencesAnswerDeleted', 'success');
  });

  it('clearAll wipes all preference storage and notifies', () => {
    setAnswerPreferences({ k1: pref() });
    setFlattenedAnswerPreferences({ flat_k1: pref() });
    const defaults = {};
    putQuestionDefault(defaults, {
      questionKey: 'question-default-key',
      questionText: 'Do you like cats?',
      answerText: 'Yes',
    });
    setQuestionDefaultContracts(defaults);
    const d = deps();
    openAnswerPreferencesDialog(d);
    capturedOptions().clearAll();
    expect(getAnswerPreferences()).toEqual({});
    expect(getFlattenedAnswerPreferences()).toEqual({});
    expect(getQuestionDefaultContracts()).toEqual({});
    expect(d.showNotification).toHaveBeenCalledWith('preferencesAnswersCleared', 'success');
  });

  it('passes notify/text/formatDate straight through from deps', () => {
    const d = deps();
    openAnswerPreferencesDialog(d);
    const opts = capturedOptions();
    expect(opts.notify).toBe(d.showNotification);
    expect(opts.text).toBe(d.t);
    expect(opts.formatDate).toBe(d.formatUiDate);
  });
});
