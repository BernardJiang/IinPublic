import type { KnownPerson } from '../../shared/types';
import { listContactGroups, resolveContactGroupUserIds } from '../../shared/contact-groups';
import { formatContactGroupLabel } from './broadcast-controller';
import type { UiTranslationKey } from './ui-translations';

/** Structural subset of ContactsViewDeps this modal actually needs — narrow enough that
 *  user-detail-view.ts's app-bar quick-block button can reuse it without carrying the rest of
 *  ContactsViewDeps in its own deps type. */
export type BlockNotifyModalDeps = {
  getKnownPeople: () => KnownPerson[];
  isBlockedByMe: (userId: string) => boolean;
  escapeHtml: (text: string) => string;
  text: (key: UiTranslationKey) => string;
};

function formatText(deps: Pick<BlockNotifyModalDeps, 'text'>, key: UiTranslationKey, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, String(value)),
    deps.text(key),
  );
}

export type BlockNotifyResult = { groupId: string; recipientUserIds: string[] };

/**
 * Opt-in friend-circle block signal (src/shared/block-signal.ts) — shown right after a block
 * succeeds. Modeled on broadcast-controller.ts's showBroadcastToGroupDialog: same group
 * selector (listContactGroups/resolveContactGroupUserIds/formatContactGroupLabel), reused
 * rather than duplicated. Resolves to the selected group id AND its already-narrowed recipient
 * list — the group id is what app.ts persists as this target's current share scope (a status,
 * not a one-time push; see src/shared/block-signal.ts's resolveSharedSignalsForContact), the
 * recipient list is who to notify right now. Null if the blocker skipped notifying anyone.
 * Shared by contacts-view.ts's relationship-modal block button and user-detail-view.ts's
 * app-bar quick-block button.
 */
export function showBlockNotifyModal(deps: BlockNotifyModalDeps): Promise<BlockNotifyResult | null> {
  return new Promise((resolve) => {
    const knownPeople = deps.getKnownPeople();
    if (knownPeople.length === 0) {
      resolve(null);
      return;
    }
    const blockedUserIds = knownPeople
      .filter((person) => deps.isBlockedByMe(person.userId))
      .map((person) => person.userId);
    const groups = listContactGroups(knownPeople);

    document.getElementById('block-notify-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'block-notify-modal';
    modal.dataset.testid = 'block-notify-modal';
    modal.className = 'modal-overlay';
    modal.style.zIndex = '2000';
    const groupOptions = groups
      .map((group) => `<option value="${deps.escapeHtml(group.id)}">${deps.escapeHtml(formatContactGroupLabel(group, deps.text))} (${group.memberCount})</option>`)
      .join('');
    modal.innerHTML = `
      <div class="modal-content" style="max-width:420px;">
        <div class="modal-header"><h2 class="modal-title">${deps.text('blockNotifyModalTitle')}</h2></div>
        <p style="font-size:0.9em;color:var(--text-secondary);margin-top:6px;">${deps.text('blockNotifyModalBody')}</p>
        <p style="font-size:0.82em;color:var(--text-tertiary);margin-top:6px;">${deps.text('blockNotifySafetyResourceNote')}</p>
        <label style="display:block;margin-top:10px;font-size:0.9em;">
          <span>${deps.text('blockNotifyPickGroup')}</span>
          <select id="block-notify-group-select" class="form-input" data-testid="block-notify-group-select">${groupOptions}</select>
        </label>
        <div id="block-notify-preview" style="margin-top:10px;font-size:0.88em;color:var(--text-secondary);" data-testid="block-notify-preview"></div>
        <div class="modal-actions">
          <button type="button" class="btn" data-testid="block-notify-skip">${deps.text('blockNotifySkip')}</button>
          <button type="button" class="btn primary-btn" data-testid="block-notify-confirm">${deps.text('blockNotifyConfirm')}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const groupSelect = modal.querySelector('#block-notify-group-select') as HTMLSelectElement;
    const preview = modal.querySelector('#block-notify-preview') as HTMLElement;
    const selectedUserIds = () => resolveContactGroupUserIds(knownPeople, groupSelect.value, blockedUserIds);
    const updatePreview = () => {
      preview.textContent = formatText(deps, 'blockNotifyPreview', { count: selectedUserIds().length });
    };
    groupSelect.addEventListener('change', updatePreview);
    updatePreview();

    const finish = (result: BlockNotifyResult | null) => {
      modal.remove();
      resolve(result);
    };
    modal.querySelector('[data-testid="block-notify-skip"]')?.addEventListener('click', () => finish(null));
    modal.addEventListener('click', (event) => {
      if (event.target === modal) finish(null);
    });
    modal.querySelector('[data-testid="block-notify-confirm"]')?.addEventListener('click', () => {
      finish({ groupId: groupSelect.value, recipientUserIds: selectedUserIds() });
    });
  });
}
