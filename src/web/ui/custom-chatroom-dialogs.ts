import { escapeHtml } from './ui-formatters';
import type { UiTranslationKey } from './ui-translations';

export interface CustomChatroomDraft {
  type: 'business' | 'custom';
  name: string;
  description?: string;
  businessInfo?: { headline?: string };
}

export type CustomChatroomDialogText = (key: UiTranslationKey) => string;

export interface CustomChatroomDialogDeps {
  text: CustomChatroomDialogText;
  showWarning: (message: string) => void;
}

export function showCreateCustomChatroomDialog(
  deps: CustomChatroomDialogDeps,
): Promise<CustomChatroomDraft | null> {
  const { text, showWarning } = deps;
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content" style="max-width:420px;">
        <div class="modal-header">
          <h2 class="modal-title">${escapeHtml(text('chatroomCreateTitle'))}</h2>
          <p style="color:#666;font-size:0.9em;">${escapeHtml(text('chatroomCreateHelp'))}</p>
        </div>
        <form id="create-custom-chatroom-form">
          <div class="form-group">
            <label class="form-label">${escapeHtml(text('chatroomType'))}</label>
            <select class="form-input" id="custom-room-type" name="type">
              <option value="custom">${escapeHtml(text('chatroomTypeCommunity'))}</option>
              <option value="business">${escapeHtml(text('chatroomTypeBusiness'))}</option>
            </select>
          </div>
          <div class="form-group" id="custom-room-business-headline-group" style="display:none;">
            <label class="form-label">${escapeHtml(text('chatroomBusinessHeadline'))}</label>
            <input type="text" class="form-input" id="custom-room-business-headline" maxlength="120" placeholder="${escapeHtml(text('chatroomBusinessPlaceholder'))}" />
          </div>
          <div class="form-group">
            <label class="form-label">${escapeHtml(text('chatroomName'))}</label>
            <input type="text" class="form-input" id="custom-room-name" name="name" required minlength="2" maxlength="80" data-testid="custom-room-name-input" />
          </div>
          <div class="form-group">
            <label class="form-label">${escapeHtml(text('chatroomDescriptionOptional'))}</label>
            <textarea class="form-input" id="custom-room-description" rows="2" maxlength="500"></textarea>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn" id="cancel-custom-room-btn" style="background:var(--text-tertiary);">${escapeHtml(text('chatroomCancel'))}</button>
            <button type="submit" class="btn primary-btn" data-testid="custom-room-submit-btn">${escapeHtml(text('chatroomCreate'))}</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(modal);

    const typeSelect = modal.querySelector('#custom-room-type') as HTMLSelectElement;
    const businessGroup = modal.querySelector('#custom-room-business-headline-group') as HTMLElement;
    const syncBusinessFields = () => {
      businessGroup.style.display = typeSelect.value === 'business' ? 'block' : 'none';
    };
    typeSelect.addEventListener('change', syncBusinessFields);
    syncBusinessFields();

    const cleanup = () => {
      document.body.removeChild(modal);
    };

    modal.querySelector('#cancel-custom-room-btn')?.addEventListener('click', () => {
      cleanup();
      resolve(null);
    });

    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        cleanup();
        resolve(null);
      }
    });

    const form = modal.querySelector('#create-custom-chatroom-form') as HTMLFormElement;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const type = typeSelect.value === 'business' ? 'business' : 'custom';
      const name = (modal.querySelector('#custom-room-name') as HTMLInputElement).value.trim();
      const description = (
        modal.querySelector('#custom-room-description') as HTMLTextAreaElement
      ).value.trim();
      const headline = (
        modal.querySelector('#custom-room-business-headline') as HTMLInputElement
      ).value.trim();
      if (name.length < 2) {
        showWarning(text('chatroomNameTooShort'));
        return;
      }
      const draft: CustomChatroomDraft = { type, name };
      if (description) draft.description = description;
      if (type === 'business' && headline) draft.businessInfo = { headline };
      cleanup();
      resolve(draft);
    });
  });
}
