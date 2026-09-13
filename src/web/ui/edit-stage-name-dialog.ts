import type { User } from '../../shared/types';
import { escapeHtml } from './ui-formatters';
import type { UiTranslationKey } from './ui-translations';

export type EditStageNameDialogOptions = {
  user: Pick<User, 'id' | 'stageName'>;
  text: (key: UiTranslationKey) => string;
  formatText: (key: UiTranslationKey, values: Record<string, string | number>) => string;
  onStageNameChange?: ((userId: string, newStageName: string) => Promise<void>) | undefined;
};

export function showEditStageNameDialog(options: EditStageNameDialogOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h2 class="modal-title">${options.text('editStageName')}</h2>
          <p>${escapeHtml(options.formatText('stageDialogCurrent', { name: String(options.user.stageName || '') }))}</p>
        </div>
        <form id="edit-stagename-form">
          <div class="form-group">
            <label class="form-label">${options.text('stageDialogNewName')}</label>
            <input type="text" class="form-input" id="new-stage-name" name="new-stage-name"
                   data-testid="stage-name-input"
                   required minlength="3" maxlength="50"
                   placeholder="${escapeHtml(options.text('stageDialogPlaceholder'))}"
                   value="${escapeHtml(String(options.user.stageName || ''))}">
            <small style="color: #666; font-size: 0.85em;">${options.text('stageDialogLength')}</small>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn" id="cancel-edit-btn" style="background: var(--text-tertiary);">${options.text('stageDialogCancel')}</button>
            <button type="submit" class="btn" data-testid="save-stage-name-button">${options.text('stageDialogSave')}</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);
    const form = modal.querySelector<HTMLFormElement>('#edit-stagename-form')!;

    modal.querySelector<HTMLButtonElement>('#cancel-edit-btn')!.addEventListener('click', () => {
      modal.remove();
      resolve();
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const newStageName = new FormData(form).get('new-stage-name');
      const normalized = typeof newStageName === 'string' ? newStageName.trim() : '';
      if (normalized.length < 3) {
        alert(options.text('stageDialogTooShort'));
        return;
      }
      try {
        await options.onStageNameChange?.(options.user.id, normalized);
        modal.remove();
        resolve();
      } catch (error) {
        alert(options.text('stageDialogUpdateFailed'));
        reject(error);
      }
    });
  });
}
