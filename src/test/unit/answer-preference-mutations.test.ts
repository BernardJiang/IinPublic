/** @jest-environment jsdom */

jest.mock('../../web/ui/preferences-dialog', () => ({
  showPreferencesDialog: jest.fn(),
}));

import {
  applyPreferenceModeToExactMemory,
  deleteAnswerPreference,
  normalizePreferenceMode,
  openAnswerPreferencesDialog,
  type OpenAnswerPreferencesDialogDeps,
} from '../../web/ui/answer-preference-mutations';
import { showPreferencesDialog as showPreferencesDialogMock } from '../../web/ui/preferences-dialog';
import {
  getAnswerPreferences,
  getExactChatbotMemory,
  getFlattenedAnswerPreferences,
  setAnswerPreferences,
  setFlattenedAnswerPreferences,
  type AnswerPreferenceEntry,
} from '../../web/ui/answer-preferences-storage';
import { LOCAL_EXACT_CHATBOT_USER_ID, makeQuestionId } from '../../shared/exact-chatbot-memory';

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
    ['auto', 'temporary'],
    ['temporary', 'temporary'],
    ['permanent', 'permanent'],
    ['suppressed', 'suppressed'],
    ['manual', 'manual'],
    ['garbage', 'manual'],
  ])('maps %s to %s', (input, expected) => {
    expect(normalizePreferenceMode(input)).toBe(expected);
  });
});

describe('applyPreferenceModeToExactMemory', () => {
  it('does nothing when questionText is blank', () => {
    applyPreferenceModeToExactMemory(pref({ questionText: '  ' }), 'permanent');
    expect(getExactChatbotMemory().users[LOCAL_EXACT_CHATBOT_USER_ID]).toBeUndefined();
  });

  it('records a permanent answer in exact-chatbot memory', () => {
    applyPreferenceModeToExactMemory(pref(), 'permanent');
    const memory = getExactChatbotMemory();
    const qid = makeQuestionId('Do you like cats?', { language: 'en' });
    expect(memory.users[LOCAL_EXACT_CHATBOT_USER_ID]?.[qid]).toBeDefined();
  });

  it('records a suppressed question in exact-chatbot memory', () => {
    applyPreferenceModeToExactMemory(pref(), 'suppressed');
    const memory = getExactChatbotMemory();
    const qid = makeQuestionId('Do you like cats?', { language: 'en' });
    expect(memory.users[LOCAL_EXACT_CHATBOT_USER_ID]?.[qid]?.summary).toBeDefined();
  });

  it('clears the manual mode entry for both the language-scoped and English-fallback keys', () => {
    applyPreferenceModeToExactMemory(pref(), 'permanent');
    applyPreferenceModeToExactMemory(pref(), 'manual');
    const memory = getExactChatbotMemory();
    const qid = makeQuestionId('Do you like cats?', { language: 'en' });
    expect(memory.users[LOCAL_EXACT_CHATBOT_USER_ID]?.[qid]).toBeUndefined();
  });
});

describe('deleteAnswerPreference', () => {
  it('deletes a regular preference and clears any permanent-mode exact-memory entry', () => {
    setAnswerPreferences({ k1: pref() });
    applyPreferenceModeToExactMemory(pref(), 'permanent');
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

  it('updateAnswer is a no-op when the key does not exist', () => {
    const d = deps();
    openAnswerPreferencesDialog(d);
    capturedOptions().updateAnswer('missing', 'a2', 'No');
    expect(d.showNotification).not.toHaveBeenCalled();
  });

  it('updateMode writes the new mode and notifies with the mode-specific key', () => {
    setAnswerPreferences({ k1: pref({ mode: 'manual' }) });
    const d = deps();
    openAnswerPreferencesDialog(d);
    capturedOptions().updateMode('k1', 'permanent');
    expect(getAnswerPreferences().k1.mode).toBe('permanent');
    expect(d.showNotification).toHaveBeenCalledWith('preferencesModeChangedPermanent', 'success');
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
    const d = deps();
    openAnswerPreferencesDialog(d);
    capturedOptions().clearAll();
    expect(getAnswerPreferences()).toEqual({});
    expect(getFlattenedAnswerPreferences()).toEqual({});
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
