import type { KnownPerson } from '../../shared/types';
import { listContactGroups, resolveContactGroupUserIds, type ContactGroupOption } from '../../shared/contact-groups';
import { escapeHtml } from './ui-formatters';
import {
  getUnsentBroadcastTalkIds,
  getUnsentBroadcastTalkIdsForReceiver,
  getUnsentBroadcastTalkReceiverIds,
} from './broadcast-delivery-selection';

export type BroadcastMember = { userId: string; stageName: string };

export type BroadcastControllerDeps = {
  getCurrentChatroom: () => string;
  setCurrentChatroom: (chatroomId: string) => void;
  getCurrentUserId: () => string;
  getCurrentChatroomMembers: () => BroadcastMember[];
  getKnownPeople: () => KnownPerson[];
  getBlockedUserIds: () => string[];
  getBroadcastableTalkIds: () => string[];
  /** Public or private: a contact-group send is deliberate (OPEN-112). */
  getGroupSendableTalkIds: () => string[];
  getMyTalks: () => Record<string, any>;
  getPeerName: (userId: string) => string;
  showNotification: (message: string, type: 'info' | 'warning') => void;
  showTalkEditorDialog: () => void;
  emit: (event: string, payload: unknown) => void;
  t: (key: any) => string;
  tf: (key: any, vars: Record<string, string | number>) => string;
};

export type BroadcastController = ReturnType<typeof createBroadcastController>;

/** Exported for reuse by contacts-view.ts's block-notify group picker — same group-id → label mapping. */
export function formatContactGroupLabel(group: ContactGroupOption, t: BroadcastControllerDeps['t']): string {
  const builtInKeys: Record<string, string> = {
    all: 'allRelations',
    friend: 'friends',
    relative: 'relatives',
    coworker: 'coworkers',
    acquaintance: 'acquaintances',
    partner: 'partners',
    custom: 'custom',
  };
  const key = builtInKeys[group.id];
  return key ? t(key) : group.displayLabel;
}

function readRosterMembers(): BroadcastMember[] {
  return Array.from(
    document.querySelectorAll('#chatroom-members-list .chatroom-member-item[data-user-id]'),
  ).map((element) => {
    const node = element as HTMLElement;
    return {
      userId: node.dataset.userId || '',
      stageName: (node.dataset.stageName || 'User').trim() || 'User',
    };
  });
}

export function createBroadcastController(deps: BroadcastControllerDeps) {
  const getUnsentTalkIds = (receiverIds: string[]): string[] =>
    getUnsentBroadcastTalkIds(receiverIds);

  const getPendingBroadcastTalkIds = (): string[] => {
    const receiverIds = [
      ...deps.getCurrentChatroomMembers().map((member) => member.userId),
      ...readRosterMembers().map((member) => member.userId),
    ]
      .map((id) => String(id || '').trim())
      .filter((id) => Boolean(id) && id !== deps.getCurrentUserId());
    return getUnsentTalkIds([...new Set(receiverIds)]);
  };

  const getUnsentTalkReceiverIds = (
    talkIds: string[],
    receiverIds: string[],
  ): Record<string, string[]> => getUnsentBroadcastTalkReceiverIds(talkIds, receiverIds);

  const broadcastPendingTalksToMembers = (members: BroadcastMember[]): void => {
    const chatroomId = deps.getCurrentChatroom();
    if (!chatroomId) return;
    for (const peer of members) {
      const talkIds = getUnsentBroadcastTalkIdsForReceiver(peer.userId);
      if (talkIds.length > 0) {
        deps.emit('broadcastTalk', { chatroomId, members: [peer], talkIds, automatic: true });
      }
    }
  };

  const broadcastPendingTalksOnRoomEntry = (): void => {
    if (!deps.getCurrentChatroom()) return;
    broadcastPendingTalksToMembers(deps.getCurrentChatroomMembers());
  };

  const showBroadcastToGroupDialog = (): void => {
    const knownPeople = deps.getKnownPeople();
    const groups = listContactGroups(knownPeople);
    const talkIds = deps.getGroupSendableTalkIds();
    if (talkIds.length === 0) {
      deps.showNotification(deps.t('chatroomNoTalksToBroadcast'), 'info');
      return;
    }
    const myTalks = deps.getMyTalks();

    document.getElementById('broadcast-group-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'broadcast-group-modal';
    modal.dataset.testid = 'broadcast-group-modal';
    modal.className = 'modal-overlay';
    modal.style.zIndex = '2000';
    const groupOptions = groups
      .map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(formatContactGroupLabel(group, deps.t))} (${group.memberCount})</option>`)
      .join('');
    const talkOptions = talkIds
      .map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(myTalks[id]?.title || id)}</option>`)
      .join('');
    modal.innerHTML = `
      <div class="modal-content" style="max-width:420px;">
        <div class="modal-header"><h2 class="modal-title">${deps.t('broadcastGroupTitle')}</h2></div>
        <label style="display:block;margin-top:10px;font-size:0.9em;">
          <span>${deps.t('broadcastGroupPickGroup')}</span>
          <select id="broadcast-group-select" class="form-input" data-testid="broadcast-group-select">${groupOptions}</select>
        </label>
        <label style="display:block;margin-top:10px;font-size:0.9em;">
          <span>${deps.t('broadcastGroupPickTalk')}</span>
          <select id="broadcast-group-talk-select" class="form-input" data-testid="broadcast-group-talk-select">${talkOptions}</select>
        </label>
        <div id="broadcast-group-preview" style="margin-top:10px;font-size:0.88em;color:var(--text-secondary);" data-testid="broadcast-group-preview"></div>
        <div class="modal-actions">
          <button type="button" class="btn" data-testid="broadcast-group-cancel">${deps.t('captureConfirmDecline')}</button>
          <button type="button" class="btn primary-btn" data-testid="broadcast-group-confirm">${deps.t('conversationSend')}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const groupSelect = modal.querySelector('#broadcast-group-select') as HTMLSelectElement;
    const talkSelect = modal.querySelector('#broadcast-group-talk-select') as HTMLSelectElement;
    const preview = modal.querySelector('#broadcast-group-preview') as HTMLElement;
    const selectedUserIds = () => resolveContactGroupUserIds(
      knownPeople,
      groupSelect.value,
      deps.getBlockedUserIds(),
    );
    const updatePreview = () => {
      preview.textContent = deps.tf('broadcastGroupPreview', { count: selectedUserIds().length });
    };
    groupSelect.addEventListener('change', updatePreview);
    updatePreview();

    const close = () => modal.remove();
    modal.querySelector('[data-testid="broadcast-group-cancel"]')?.addEventListener('click', close);
    modal.addEventListener('click', (event) => {
      if (event.target === modal) close();
    });
    modal.querySelector('[data-testid="broadcast-group-confirm"]')?.addEventListener('click', () => {
      const userIds = selectedUserIds();
      if (userIds.length === 0) {
        deps.showNotification(deps.t('broadcastGroupEmpty'), 'info');
        return;
      }
      const members = userIds.map((userId) => ({ userId, stageName: deps.getPeerName(userId) }));
      deps.emit('broadcastToContactGroup', { talkId: talkSelect.value, members });
      close();
    });
  };

  return {
    broadcastPendingTalksOnRoomEntry,
    broadcastPendingTalksToMembers,
    getPendingBroadcastTalkIds,
    getUnsentTalkIds,
    getUnsentTalkReceiverIds,
    showBroadcastToGroupDialog,
  };
}
