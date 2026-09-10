import { escapeHtml } from './ui-formatters';
import { TALK_TEMPLATES } from './talk-templates';
import type { UiTranslationKey } from './ui-translations';

export type TalkTemplatePickerDeps = {
  t: (key: UiTranslationKey) => string;
  /** Opens the talk editor, optionally pre-built from the chosen template ("Start from scratch" passes undefined). */
  openEditor: (existingTalk?: any) => void;
};

/** "+ Create Talk" entry point: pick a built-in template or start from scratch. */
export function showTalkTemplatePicker(deps: TalkTemplatePickerDeps): void {
  const { t, openEditor } = deps;
  document.getElementById('talk-template-picker-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'talk-template-picker-modal';
  modal.className = 'modal-overlay';
  const templateRows = TALK_TEMPLATES.map(
    (template) => `
    <div class="chatroom-item talk-template-row" data-testid="talk-template-${template.id}" data-template-id="${template.id}">
      <div class="chatroom-icon">${template.icon}</div>
      <div class="chatroom-info">
        <div class="chatroom-name">${escapeHtml(t(template.labelKey))}</div>
        <div class="chatroom-description">${escapeHtml(t(template.descKey))}</div>
      </div>
      <div class="chatroom-arrow">›</div>
    </div>
  `,
  ).join('');
  modal.innerHTML = `
    <div class="modal-content" style="max-width:440px;">
      <div class="modal-header">
        <h2 class="modal-title">${t('talkTemplatePickerTitle')}</h2>
        <button class="close-button" id="close-talk-template-picker">&times;</button>
      </div>
      <p style="padding:0 20px;margin:0 0 12px;color:var(--text-secondary);font-size:0.9em;">${escapeHtml(t('talkTemplatePickerSubtitle'))}</p>
      <div style="padding:0 20px 20px;">
        ${templateRows}
        <div class="chatroom-item talk-template-row" data-testid="talk-template-scratch" data-template-id="scratch">
          <div class="chatroom-icon">✏️</div>
          <div class="chatroom-info">
            <div class="chatroom-name">${escapeHtml(t('talkTemplateScratch'))}</div>
            <div class="chatroom-description">${escapeHtml(t('talkTemplateScratchDesc'))}</div>
          </div>
          <div class="chatroom-arrow">›</div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  document.getElementById('close-talk-template-picker')?.addEventListener('click', close);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) close();
  });
  modal.querySelectorAll<HTMLElement>('.talk-template-row').forEach((row) => {
    row.addEventListener('click', () => {
      const templateId = row.dataset.templateId || '';
      close();
      const template = TALK_TEMPLATES.find((t2) => t2.id === templateId);
      openEditor(template?.build());
    });
  });
}
