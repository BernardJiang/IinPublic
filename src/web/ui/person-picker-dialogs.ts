import { escapeHtml } from './ui-formatters';
import type { UiTranslationKey } from './ui-translations';

type NavigateToPerson = (person: { type: 'person'; id: string; name: string }) => void;

/** A modal listing people, closing and navigating to whichever row is clicked. */
function bindPersonPickerRows(modal: HTMLElement, rowSelector: string, navigateToPerson: NavigateToPerson, close: () => void): void {
  modal.querySelectorAll<HTMLElement>(rowSelector).forEach((row) => {
    row.addEventListener('click', () => {
      const id = row.dataset.userId || '';
      const name = row.dataset.userName || '';
      close();
      if (id) navigateToPerson({ type: 'person', id, name });
    });
  });
}

/** Talk-response "reply to whom" picker — several senders matched the same answer. */
export function showChooseWhoToDmPicker(
  people: Array<{ id: string; name: string }>,
  deps: { t: (key: UiTranslationKey) => string; navigateToPerson: NavigateToPerson },
): void {
  document.getElementById('talk-dm-picker-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'talk-dm-picker-modal';
  modal.className = 'modal-overlay';
  const rows = people
    .map(
      (person) => `
    <div class="talk-dm-picker-row" data-user-id="${escapeHtml(person.id)}" data-user-name="${escapeHtml(person.name)}" style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--bg-muted);border-radius:8px;margin-bottom:6px;cursor:pointer;">
      <span style="font-weight:600;">${escapeHtml(person.name)}</span>
    </div>
  `,
    )
    .join('');
  modal.innerHTML = `
    <div class="modal-content" style="max-width:380px;">
      <div class="modal-header">
        <h2 class="modal-title">${deps.t('talksChooseWhoToDm')}</h2>
        <button class="close-button" id="close-talk-dm-picker">&times;</button>
      </div>
      <div style="padding:16px;">${rows}</div>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  document.getElementById('close-talk-dm-picker')?.addEventListener('click', close);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) close();
  });
  bindPersonPickerRows(modal, '.talk-dm-picker-row', deps.navigateToPerson, close);
}

/**
 * TODO §N2: the "no matter which tab" affordance — reachable from every tab via #dm-inbox-btn
 * (badge-driven off the same aggregate unread count `renderMatchBadge` computes), lists senders
 * with unread messages sorted most-recent-first. Modeled on `showChooseWhoToDmPicker`'s modal
 * skeleton; picking a row navigates via the same `navigateToPerson` destination.
 */
export function showDmInboxPicker(deps: {
  t: (key: UiTranslationKey) => string;
  navigateToPerson: NavigateToPerson;
  getMyConversations: () => Record<string, any>;
  getPeerName: (userId: string, fallbackName?: string) => string;
}): void {
  document.getElementById('dm-inbox-modal')?.remove();
  const conversations = deps.getMyConversations();
  const unread = Object.entries(conversations)
    .filter(([, conv]: [string, any]) => conv?.unread && conv.supportChannel !== true && conv.otherUserId)
    .map(([, conv]: [string, any]) => ({
      id: String(conv.otherUserId),
      name: deps.getPeerName(conv.otherUserId, conv.otherUserName),
      unreadCount: Number(conv.unreadCount || 0) || 1,
      lastMessageTime: conv.lastMessageTime || conv.createdAt || '',
    }))
    .sort((a, b) => new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime());

  const modal = document.createElement('div');
  modal.id = 'dm-inbox-modal';
  modal.className = 'modal-overlay';
  const rows = unread.length > 0
    ? unread
        .map(
          (person) => `
    <div class="dm-inbox-row" data-user-id="${escapeHtml(person.id)}" data-user-name="${escapeHtml(person.name)}" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px;background:var(--bg-muted);border-radius:8px;margin-bottom:6px;cursor:pointer;">
      <span style="font-weight:600;">${escapeHtml(person.name)}</span>
      <span class="notification-badge" style="position:static;">${person.unreadCount > 99 ? '99+' : person.unreadCount}</span>
    </div>
  `,
        )
        .join('')
    : `<p style="text-align:center;color:#999;padding:16px 0;">${deps.t('dmInboxEmpty')}</p>`;
  modal.innerHTML = `
    <div class="modal-content" style="max-width:380px;">
      <div class="modal-header">
        <h2 class="modal-title">${deps.t('dmInboxTitle')}</h2>
        <button class="close-button" id="close-dm-inbox-modal">&times;</button>
      </div>
      <div style="padding:16px;">${rows}</div>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  document.getElementById('close-dm-inbox-modal')?.addEventListener('click', close);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) close();
  });
  bindPersonPickerRows(modal, '.dm-inbox-row', deps.navigateToPerson, close);
}
