import { escapeHtml } from './ui-formatters';
import type { UiTranslationKey } from './ui-translations';

/**
 * docs/TODO.md §V: confirms a question/answers set auto-captured from a matched-talk share
 * before it's added to the recipient's own Talks. Opened from inside an already-open
 * conversation detail overlay (z-index 1001) — this modal uses z-index 2000, found via a real
 * E2E run, matching the tier the media lightbox already uses for the same requirement.
 */
export function confirmCapturedQuestionDialog(
  parsed: { question: string; answers: string[] },
  t: (key: UiTranslationKey) => string,
): Promise<boolean> {
  document.getElementById('capture-question-confirm-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'capture-question-confirm-modal';
  modal.dataset.testid = 'capture-question-confirm-modal';
  modal.className = 'modal-overlay';
  modal.style.zIndex = '2000';
  modal.innerHTML = `
    <div class="modal-content" style="max-width:420px;">
      <div class="modal-header">
        <h2 class="modal-title">${t('captureConfirmTitle')}</h2>
        <p>${t('captureConfirmHelp')}</p>
      </div>
      <div style="padding:10px 0;">
        <div style="font-weight:600;">${escapeHtml(parsed.question)}</div>
        <ul style="margin:8px 0 0;padding-left:20px;font-size:0.9em;color:var(--text-secondary);">
          ${parsed.answers.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}
        </ul>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn" data-testid="capture-question-confirm-decline">${t('captureConfirmDecline')}</button>
        <button type="button" class="btn primary-btn" data-testid="capture-question-confirm-accept">${t('captureConfirmAccept')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  return new Promise<boolean>((resolve) => {
    const finish = (confirmed: boolean): void => {
      modal.remove();
      resolve(confirmed);
    };
    modal.querySelector('[data-testid="capture-question-confirm-accept"]')?.addEventListener('click', () => finish(true));
    modal.querySelector('[data-testid="capture-question-confirm-decline"]')?.addEventListener('click', () => finish(false));
    modal.addEventListener('click', (event) => {
      if (event.target === modal) finish(false);
    });
  });
}
