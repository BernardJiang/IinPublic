/**
 * The Preferences dialog over what the chatbot remembers (OPEN-106 step 2e v): the device graph's
 * remembered answers (`graph.remembered`), changed there (`graph.changeRemembered`). The dialog
 * renders synchronously, so the list is read once when it opens and kept up to date as it is
 * changed.
 */
import { showPreferencesDialog as openPreferencesDialog, type AnswerPreferenceUiMode, type PreferenceDisplayMap } from './preferences-dialog';
import { escapeHtml } from './ui-formatters';
import type { UiTranslationKey } from './ui-translations';
import type { RememberedAnswer } from '../../core/device-graph/answers';

/* eslint-disable @typescript-eslint/no-explicit-any */

type CoreCall = (request: any) => Promise<any>;
let core: CoreCall | null = null;

/** Set by the app once the core has a device graph. */
export function setRememberedAnswersSource(call: CoreCall | null): void {
  core = call;
}

export type OpenAnswerPreferencesDialogDeps = {
  showNotification: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  t: (key: UiTranslationKey) => string;
  formatUiDate: (date: Date) => string;
};

function displayOf(items: RememberedAnswer[]): PreferenceDisplayMap {
  const out: PreferenceDisplayMap = {};
  for (const item of items) {
    const answerText = item.answerTexts.join(', ');
    out[item.key] = {
      answerId: answerText,
      answerText,
      mode: item.reuse === 'once' ? 'manual' : item.reuse === 'whenever' ? 'whenever' : 'temporary',
      contextVersion: 2,
      questionText: item.questionText,
      allAnswers: item.choices.map((text) => ({ id: text, text })),
      ...(item.when ? { timestamp: new Date(item.when).toISOString() } : {}),
    };
  }
  return out;
}

export function openAnswerPreferencesDialog(deps: OpenAnswerPreferencesDialogDeps): void {
  // Opens at once; the list fills in when the core has read it (the UI never waits on the core).
  let shown: PreferenceDisplayMap = {};
  let changed = false;
  const change = (key: string, value: unknown): void => {
    changed = true;
    if (!core) return;
    void core({ name: 'graph.changeRemembered', key, change: value }).catch((error) => console.warn('[preferences] change failed:', error));
  };
  const dialog = openPreferencesDialog({
    getPreferences: () => shown,
    escapeHtml,
    updateAnswer: (key, _answerId, answerText) => {
      const entry = shown[key];
      if (!entry || !key.startsWith('ctx|')) return;
      shown = { ...shown, [key]: { ...entry, answerId: answerText, answerText } };
      change(key, { answerText });
      deps.showNotification(deps.t('preferencesAnswerUpdated'), 'success');
    },
    updateMode: (key, uiMode: AnswerPreferenceUiMode) => {
      const entry = shown[key];
      if (!entry) return;
      if (key.startsWith('whenever|')) {
        if (uiMode === 'auto') return;
        // A Whenever offered answer set to Manual is no longer offered by itself.
        const { [key]: _removed, ...rest } = shown;
        shown = rest;
        change(key, { forget: true });
        deps.showNotification(deps.t('preferencesModeChangedManual'), 'success');
        return;
      }
      shown = { ...shown, [key]: { ...entry, mode: uiMode === 'manual' ? 'manual' : 'temporary' } };
      change(key, { reuse: uiMode === 'manual' ? 'once' : 'auto' });
      deps.showNotification(deps.t(uiMode === 'manual' ? 'preferencesModeChangedManual' : 'preferencesModeChangedTemporary'), 'success');
    },
    deletePreference: (key) => {
      const { [key]: _removed, ...rest } = shown;
      shown = rest;
      change(key, { forget: true });
      deps.showNotification(deps.t('preferencesAnswerDeleted'), 'success');
    },
    clearAll: () => {
      shown = {};
      change('*', { forget: true });
      deps.showNotification(deps.t('preferencesAnswersCleared'), 'success');
    },
    notify: deps.showNotification,
    text: deps.t,
    formatDate: deps.formatUiDate,
  });
  if (!core) return;
  void core({ name: 'graph.remembered' }).catch(() => []).then((items: RememberedAnswer[]) => {
    if (changed) return; // the user already changed what was shown
    shown = displayOf(items);
    dialog.refresh();
  });
}
