import type { AnswerPreferenceMap } from './answer-preferences-storage';
import type { UiTranslationKey } from './ui-translations';

type PreferencesDialogOptions = {
  getPreferences: () => AnswerPreferenceMap;
  escapeHtml: (text: string) => string;
  updateAnswer: (key: string, answerId: string, answerText: string) => void;
  updateMode: (key: string, isAuto: boolean) => void;
  deletePreference: (key: string) => void;
  clearAll: () => void;
  notify: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  text?: (key: UiTranslationKey) => string;
  formatDate?: (date: Date) => string;
};

export function showPreferencesDialog(options: PreferencesDialogOptions): void {
  const text = (key: UiTranslationKey, fallback: string): string => options.text?.(key) || fallback;
  const format = (key: UiTranslationKey, fallback: string, values: Record<string, string | number>): string =>
    Object.entries(values).reduce(
      (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
      text(key, fallback),
    );
  const formatDate = (date: Date): string => options.formatDate?.(date) || date.toLocaleString();
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'preferences-modal';

  const closeModal = (): void => {
    if (document.body.contains(modal)) {
      document.body.removeChild(modal);
    }
  };

  const render = (): void => {
    const preferences = options.getPreferences();
    const preferenceEntries = Object.entries(preferences);

    modal.innerHTML = `
      <div class="modal-content" style="max-width: 800px; max-height: 90vh; overflow-y: auto;">
        <div class="modal-header">
          <h2 class="modal-title">${text('preferencesAnswersTitle', 'My Answers')}</h2>
          <button class="close-button" id="close-preferences-modal" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #666;">&times;</button>
        </div>
        <div style="padding: 20px;">
          ${
            preferenceEntries.length === 0
              ? `<p style="text-align: center; color: #666;">${text('preferencesNoAnswers', 'No answered questions yet. When you answer a question, it will appear here and you can manage your preferences.')}</p>`
              : `
            <p style="margin-bottom: 20px; color: #666;">${format('preferencesSummary', 'You have answered {count} question(s). You can change your answers or toggle between Auto/Manual mode for future use.', { count: preferenceEntries.length })}</p>
            <div style="max-height: 500px; overflow-y: auto;">
              ${preferenceEntries
                .map(
                  ([key, pref]) => `
                  <div class="preference-item" style="background: #f9f9f9; border: 2px solid #e0e0e0; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                    <div style="margin-bottom: 15px;">
                      <div style="font-weight: 600; font-size: 1.1em; color: #333; margin-bottom: 8px;">
                        ${options.escapeHtml(pref.questionText || text('preferencesQuestionFallback', 'Question'))}
                      </div>
                      <div style="font-size: 0.8em; color: #999; margin-bottom: 12px;">
                        ${format('preferencesLastAnswered', 'Last answered: {date}', { date: pref.timestamp ? formatDate(new Date(pref.timestamp)) : text('preferencesUnavailable', 'N/A') })}
                      </div>
                    </div>
                    <div style="margin-bottom: 15px;">
                      <label style="display: block; font-size: 0.9em; font-weight: 600; color: #666; margin-bottom: 8px;">
                        ${text('preferencesYourAnswer', 'Your Answer:')}
                      </label>
                      ${
                        pref.allAnswers && pref.allAnswers.length > 0
                          ? `<select
                        class="answer-select"
                        data-pref-key="${key}"
                        style="width: 100%; padding: 10px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 1em; background: white; cursor: pointer;"
                      >
                        ${pref.allAnswers
                          .map(
                            (ans: any) => `
                            <option value="${ans.id}" ${ans.id === pref.answerId ? 'selected' : ''}>
                              ${options.escapeHtml(ans.text)}
                            </option>
                          `,
                          )
                          .join('')}
                      </select>`
                          : `<div style="width: 100%; padding: 10px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 1em; background: #f5f5f5; color: #666;">
                        ${options.escapeHtml(pref.answerText)}
                        <div style="font-size: 0.75em; margin-top: 4px; color: #999;">
                          ${text('preferencesOptionsUnavailable', '(Other options not available - answer this question again to enable editing)')}
                        </div>
                      </div>`
                      }
                    </div>
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px;">
                      <div>
                        <label style="font-size: 0.9em; font-weight: 600; color: #666;">
                          ${text('preferencesMode', 'Mode:')}
                        </label>
                        <div style="font-size: 0.85em; color: #999; margin-top: 4px;">
                          ${text('preferencesAutoHelp', 'Auto mode will use this answer automatically next time')}
                        </div>
                      </div>
                      <label class="toggle-switch" style="position: relative; display: inline-block; width: 60px; height: 34px;">
                        <input
                          type="checkbox"
                          class="mode-toggle"
                          data-pref-key="${key}"
                          ${pref.mode === 'auto' ? 'checked' : ''}
                          style="opacity: 0; width: 0; height: 0;"
                        >
                        <span style="
                          position: absolute;
                          cursor: pointer;
                          top: 0;
                          left: 0;
                          right: 0;
                          bottom: 0;
                          background-color: ${pref.mode === 'auto' ? '#10b981' : '#dc2626'};
                          transition: 0.4s;
                          border-radius: 34px;
                        ">
                          <span style="
                            position: absolute;
                            content: '';
                            height: 26px;
                            width: 26px;
                            left: 4px;
                            bottom: 4px;
                            background-color: white;
                            transition: 0.4s;
                            border-radius: 50%;
                            transform: translateX(${pref.mode === 'auto' ? '26px' : '0'});
                          "></span>
                        </span>
                      </label>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                      <div class="mode-badge-${key}" style="font-size: 0.85em; padding: 6px 12px; border-radius: 6px; font-weight: 600; ${
                        pref.mode === 'auto'
                          ? 'background: #d1fae5; color: #065f46;'
                          : 'background: #fee2e2; color: #991b1b;'
                      }">
                        ${pref.mode === 'auto' ? `🟢 ${text('preferencesAutoBadge', 'AUTO')}` : `🔴 ${text('preferencesManualBadge', 'MANUAL')}`}
                      </div>
                      <button
                        class="delete-pref-btn"
                        data-pref-key="${key}"
                        style="background: #e53e3e; color: white; border: none; border-radius: 6px; padding: 8px 16px; cursor: pointer; font-size: 0.85em; font-weight: 600;"
                      >
                        🗑️ ${text('preferencesDelete', 'Delete')}
                      </button>
                    </div>
                  </div>
                `,
                )
                .join('')}
            </div>
            <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #e0e0e0;">
              <button
                id="clear-all-prefs-btn"
                style="background: #e53e3e; color: white; border: none; border-radius: 8px; padding: 12px 24px; cursor: pointer; font-weight: 600; font-size: 1em;"
              >
                🗑️ ${text('preferencesClearAll', 'Clear All Answers')}
              </button>
            </div>
          `
          }
        </div>
      </div>
    `;

    const closeBtn = modal.querySelector('#close-preferences-modal');
    closeBtn?.addEventListener('click', closeModal);

    modal.querySelectorAll('.answer-select').forEach((select) => {
      select.addEventListener('change', (event) => {
        const target = event.currentTarget as HTMLSelectElement;
        const key = target.dataset.prefKey;
        if (!key) return;
        const newAnswerId = target.value;
        const newAnswerText = target.options[target.selectedIndex]?.text || '';
        options.updateAnswer(key, newAnswerId, newAnswerText);
      });
    });

    modal.querySelectorAll('.mode-toggle').forEach((toggle) => {
      toggle.addEventListener('change', (event) => {
        const target = event.currentTarget as HTMLInputElement;
        const key = target.dataset.prefKey;
        if (!key) return;
        options.updateMode(key, target.checked);

        const toggleSpan = target.nextElementSibling as HTMLElement | null;
        if (toggleSpan) {
          toggleSpan.style.backgroundColor = target.checked ? '#10b981' : '#dc2626';
          const innerSpan = toggleSpan.querySelector('span') as HTMLElement | null;
          if (innerSpan) {
            innerSpan.style.transform = target.checked ? 'translateX(26px)' : 'translateX(0)';
          }
        }

        const modeBadge = modal.querySelector(`.mode-badge-${key}`) as HTMLElement | null;
        if (modeBadge) {
          modeBadge.textContent = target.checked
            ? `🟢 ${text('preferencesAutoBadge', 'AUTO')}`
            : `🔴 ${text('preferencesManualBadge', 'MANUAL')}`;
          modeBadge.style.background = target.checked ? '#d1fae5' : '#fee2e2';
          modeBadge.style.color = target.checked ? '#065f46' : '#991b1b';
        }
      });
    });

    modal.querySelectorAll('.delete-pref-btn').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        const key = (event.currentTarget as HTMLElement).dataset.prefKey;
        if (!key) return;
        options.deletePreference(key);
        render();
      });
    });

    const clearAllBtn = modal.querySelector('#clear-all-prefs-btn');
    clearAllBtn?.addEventListener('click', () => {
      if (!confirm(text('preferencesClearConfirm', 'Are you sure you want to clear all saved answers?'))) return;
      options.clearAll();
      render();
    });
  };

  render();

  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });

  document.body.appendChild(modal);
}
