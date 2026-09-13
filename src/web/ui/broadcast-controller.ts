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
  getMyTalks: () => Record<string, any>;
  getPeerName: (userId: string) => string;
  showNotification: (message: string, type: 'info' | 'warning') => void;
  showTalkEditorDialog: () => void;
  maybeShowPreSendSafetyToast: () => void;
  emit: (event: string, payload: unknown) => void;
  t: (key: any) => string;
  tf: (key: any, vars: Record<string, string | number>) => string;
};

export type BroadcastController = ReturnType<typeof createBroadcastController>;

function formatContactGroupLabel(group: ContactGroupOption, t: BroadcastControllerDeps['t']): string {
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

function uniqueMembers(members: BroadcastMember[]): BroadcastMember[] {
  const byId = new Map<string, BroadcastMember>();
  for (const member of members) {
    const userId = String(member.userId || '').trim();
    if (!userId || byId.has(userId)) continue;
    byId.set(userId, { userId, stageName: member.stageName || userId });
  }
  return [...byId.values()];
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

  const runBroadcastFromCurrentRoom = async (automatic: boolean): Promise<void> => {
    let chatroomId = deps.getCurrentChatroom();
    if (!chatroomId) {
      const fromApp = (
        window as unknown as {
          __iinpublic_app?: { getApp: () => { chatroomService?: { getCurrentChatroomId: () => string } } };
        }
      ).__iinpublic_app?.getApp?.()?.chatroomService?.getCurrentChatroomId?.();
      if (fromApp) {
        chatroomId = fromApp;
        deps.setCurrentChatroom(fromApp);
      }
    }
    if (!chatroomId) {
      deps.showNotification(deps.t('chatroomOpenFirst'), 'info');
      return;
    }

    // Saving a newly-created talk finishes asynchronously after the editor closes. Give that
    // local write a short bounded window before treating the room as having no outgoing talks.
    let broadcastableIds = deps.getBroadcastableTalkIds();
    if (broadcastableIds.length === 0) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 75));
        broadcastableIds = deps.getBroadcastableTalkIds();
        if (broadcastableIds.length > 0) break;
      }
    }
    if (broadcastableIds.length === 0) {
      deps.showTalkEditorDialog();
      setTimeout(() => deps.showNotification(deps.t('chatroomNoTalksToBroadcast'), 'info'), 0);
      return;
    }

    const members = uniqueMembers([...deps.getCurrentChatroomMembers(), ...readRosterMembers()]);
    const talkIds = getPendingBroadcastTalkIds();
    if (talkIds.length === 0) {
      deps.showNotification(deps.t('chatroomAlreadyBroadcast'), 'info');
      return;
    }
    const talkReceiverIds = getUnsentTalkReceiverIds(
      talkIds,
      members.map((member) => member.userId),
    );
    deps.maybeShowPreSendSafetyToast();
    deps.emit('broadcastTalk', { chatroomId, members, talkIds, talkReceiverIds, automatic });

    const list = document.getElementById('chatroom-members-list');
    if (list) {
      list.querySelectorAll('.chatroom-member-item').forEach((element) => {
        element.classList.add('broadcast-sent-to');
      });
      setTimeout(() => {
        list.querySelectorAll('.chatroom-member-item').forEach((element) => {
          element.classList.remove('broadcast-sent-to');
        });
      }, 2500);
    }
  };

  const showBroadcastToGroupDialog = (): void => {
    const knownPeople = deps.getKnownPeople();
    const groups = listContactGroups(knownPeople);
    const talkIds = deps.getBroadcastableTalkIds();
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
    runBroadcastFromCurrentRoom,
    showBroadcastToGroupDialog,
  };
}
