/**
 * The Preferences dialog over the chatbot's remembered answers (OPEN-91 P4): the edits themselves
 * live in the device core (`src/core/answer-preference-mutations.ts`), over this GUI's stores.
 */
import { showPreferencesDialog as openPreferencesDialog, type AnswerPreferenceUiMode } from './preferences-dialog';
import {
  clearAnswerPreferences,
  getAnswerPreferences,
  getExactChatbotMemory,
  getFlattenedAnswerPreferences,
  getQuestionDefaultContracts,
  setAnswerPreferences,
  setExactChatbotMemory,
  setFlattenedAnswerPreferences,
  setQuestionDefaultContracts,
} from './answer-preferences-storage';
import { createAnswerPreferenceMutations, type StoredAnswerPreferenceMode } from '../../core/answer-preference-mutations';
import { escapeHtml } from './ui-formatters';
import type { UiTranslationKey } from './ui-translations';
import { getAutoAnswerScope } from './ui-settings-storage';

export { normalizePreferenceMode, type StoredAnswerPreferenceMode } from '../../core/answer-preference-mutations';

const mutations = createAnswerPreferenceMutations({
  getAnswerPreferences,
  getExactChatbotMemory,
  getFlattenedAnswerPreferences,
  getQuestionDefaultContracts,
  setAnswerPreferences,
  setExactChatbotMemory,
  setFlattenedAnswerPreferences,
  setQuestionDefaultContracts,
});

export const {
  applyPreferenceModeToExactMemory,
  getAnswerPreferencesForDisplay,
  applyAutoAnswerScopeToStoredPreferences,
  deleteAnswerPreference,
  deleteAnswerPreferencesForTalk,
} = mutations;

export type OpenAnswerPreferencesDialogDeps = {
  showNotification: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  t: (key: UiTranslationKey) => string;
  formatUiDate: (date: Date) => string;
};

export function openAnswerPreferencesDialog(deps: OpenAnswerPreferencesDialogDeps): void {
  openPreferencesDialog({
    getPreferences: getAnswerPreferencesForDisplay,
    escapeHtml,
    updateAnswer: (key, answerId, answerText) => {
      if (!mutations.updateAnswerPreferenceAnswer(key, answerId, answerText)) return;
      deps.showNotification(deps.t('preferencesAnswerUpdated'), 'success');
    },
    updateMode: (key, uiMode: AnswerPreferenceUiMode) => {
      const mode = mutations.storedModeFor(key, uiMode === 'manual' ? 'manual' : 'auto', getAutoAnswerScope());
      if (!mode) return;
      mutations.updateAnswerPreferenceMode(key, mode);
      const noticeKey: Record<StoredAnswerPreferenceMode, UiTranslationKey> = {
        manual: 'preferencesModeChangedManual',
        temporary: 'preferencesModeChangedTemporary',
        whenever: 'preferencesModeChangedWhenever',
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
