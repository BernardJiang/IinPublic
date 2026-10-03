import type { StarterPracticeContact, StarterPracticeContactId } from './starter-talk-seeds';
import type { UiTranslationKey } from './ui-translations';

type StarterContactsViewDeps = {
  escapeHtml: (text: string) => string;
  text: (key: UiTranslationKey) => string;
  removeStarterPracticeContact: (id: StarterPracticeContactId) => void;
};

export function renderStarterContactRows(
  contacts: StarterPracticeContact[],
  deps: StarterContactsViewDeps,
): string {
  return contacts.map((contact) => `
    <div class="contact-item starter-practice-contact" data-starter-contact-id="${deps.escapeHtml(contact.id)}" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px;margin-bottom:8px;background:var(--accent-soft);border-radius:12px;border:1px solid var(--accent-border);">
      <div style="display:flex;align-items:center;gap:12px;min-width:0;">
        <span class="contact-item-avatar" aria-hidden="true" style="width:40px;height:40px;border-radius:50%;background:var(--surface);display:flex;align-items:center;justify-content:center;font-size:1.2em;flex-shrink:0;">${contact.icon}</span>
        <div style="min-width:0;">
          <div class="contact-item-name" style="font-weight:700;">${deps.escapeHtml(contact.name)}<span class="talk-badge" style="margin-left:8px;">${deps.escapeHtml(deps.text('starterContactDemoBadge'))}</span></div>
          <div class="contact-item-meta" style="font-size:0.85em;color:var(--text-secondary);margin-top:4px;">${deps.escapeHtml(contact.description)}</div>
        </div>
      </div>
      <button type="button" class="btn starter-contact-remove" data-starter-contact-id="${deps.escapeHtml(contact.id)}">${deps.escapeHtml(deps.text('starterContactRemove'))}</button>
    </div>`).join('');
}

export function bindStarterContactRemoval(root: HTMLElement, deps: StarterContactsViewDeps): void {
  root.querySelectorAll<HTMLButtonElement>('.starter-contact-remove').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      deps.removeStarterPracticeContact(button.dataset.starterContactId as StarterPracticeContactId);
    });
  });
}
