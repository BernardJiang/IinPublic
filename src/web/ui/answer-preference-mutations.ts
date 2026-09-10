import { showPreferencesDialog as openPreferencesDialog, type AnswerPreferenceUiMode } from './preferences-dialog';
import {
  clearAnswerPreferences,
  getAnswerPreferences,
  getExactChatbotMemory,
  getFlattenedAnswerPreferences,
  setAnswerPreferences,
  setExactChatbotMemory,
  setFlattenedAnswerPreferences,
  type AnswerPreferenceEntry,
  type AnswerPreferenceMap,
} from './answer-preferences-storage';
import {
  LOCAL_EXACT_CHATBOT_USER_ID,
  makeQuestionId,
  savePermanentAnswer,
  saveSuppressedQuestion,
  saveTemporaryAnswer,
} from '../../shared/exact-chatbot-memory';
import { escapeHtml } from './ui-formatters';
import type { UiTranslationKey } from './ui-translations';

export function normalizePreferenceMode(mode: string): AnswerPreferenceUiMode {
  if (mode === 'auto' || mode === 'temporary') return 'temporary';
  if (mode === 'permanent' || mode === 'suppressed') return mode;
  return 'manual';
}

export function applyPreferenceModeToExactMemory(pref: AnswerPreferenceEntry, mode: AnswerPreferenceUiMode): void {
  const questionText = String(pref.questionText || '').trim();
  if (!questionText) return;
  const exactMemory = getExactChatbotMemory();
  const language = String(pref.language || 'en').toLowerCase();
  if (mode === 'manual') {
    const userMemory = exactMemory.users[LOCAL_EXACT_CHATBOT_USER_ID];
    if (userMemory) {
      delete userMemory[makeQuestionId(questionText, { language })];
      if (language === 'en') delete userMemory[makeQuestionId(questionText)];
    }
  } else if (mode === 'suppressed') {
    saveSuppressedQuestion(exactMemory, LOCAL_EXACT_CHATBOT_USER_ID, questionText, undefined, { language });
  } else if (mode === 'permanent') {
    savePermanentAnswer(exactMemory, LOCAL_EXACT_CHATBOT_USER_ID, questionText, pref.answerText, undefined, { language });
  } else {
    saveTemporaryAnswer(exactMemory, LOCAL_EXACT_CHATBOT_USER_ID, questionText, pref.answerText, undefined, { language });
  }
  setExactChatbotMemory(exactMemory);
}

export function deleteAnswerPreference(key: string): void {
  if (key.startsWith('flat_')) {
    const flat = getFlattenedAnswerPreferences();
    const pref = flat[key];
    delete flat[key];
    setFlattenedAnswerPreferences(flat);
    if (pref) applyPreferenceModeToExactMemory(pref, 'manual');
    return;
  }
  const preferences = getAnswerPreferences();
  const pref = preferences[key];
  delete preferences[key];
  setAnswerPreferences(preferences);
  if (pref) applyPreferenceModeToExactMemory(pref, 'manual');
}

export type OpenAnswerPreferencesDialogDeps = {
  showNotification: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  t: (key: UiTranslationKey) => string;
  formatUiDate: (date: Date) => string;
};

export function openAnswerPreferencesDialog(deps: OpenAnswerPreferencesDialogDeps): void {
  openPreferencesDialog({
    getPreferences: () => ({
      ...getAnswerPreferences(),
      ...getFlattenedAnswerPreferences(),
    }),
    escapeHtml,
    updateAnswer: (key, answerId, answerText) => {
      const prefs: AnswerPreferenceMap = key.startsWith('flat_') ? getFlattenedAnswerPreferences() : getAnswerPreferences();
      if (!prefs[key]) return;
      prefs[key].answerId = answerId;
      prefs[key].answerText = answerText;
      prefs[key].timestamp = new Date().toISOString();
      if (key.startsWith('flat_')) {
        setFlattenedAnswerPreferences(prefs);
      } else {
        setAnswerPreferences(prefs);
      }
      applyPreferenceModeToExactMemory(prefs[key], normalizePreferenceMode(prefs[key].mode));
      deps.showNotification(deps.t('preferencesAnswerUpdated'), 'success');
    },
    updateMode: (key, mode) => {
      const prefs: AnswerPreferenceMap = key.startsWith('flat_')
        ? getFlattenedAnswerPreferences()
        : getAnswerPreferences();
      if (!prefs[key]) return;
      prefs[key].mode = mode;
      prefs[key].timestamp = new Date().toISOString();
      if (key.startsWith('flat_')) {
        setFlattenedAnswerPreferences(prefs);
      } else {
        setAnswerPreferences(prefs);
      }
      applyPreferenceModeToExactMemory(prefs[key], mode);
      const noticeKey: Record<AnswerPreferenceUiMode, UiTranslationKey> = {
        manual: 'preferencesModeChangedManual',
        temporary: 'preferencesModeChangedTemporary',
        permanent: 'preferencesModeChangedPermanent',
        suppressed: 'preferencesModeChangedSuppressed',
      };
      deps.showNotification(deps.t(noticeKey[mode]), 'success');
    },
    deletePreference: (key) => {
      deleteAnswerPreference(key);
      deps.showNotification(deps.t('preferencesAnswerDeleted'), 'success');
    },
    clearAll: () => {
      clearAnswerPreferences();
      deps.showNotification(deps.t('preferencesAnswersCleared'), 'success');
    },
    notify: deps.showNotification,
    text: deps.t,
    formatDate: deps.formatUiDate,
  });
}
