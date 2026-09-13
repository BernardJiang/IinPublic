import type { User } from '../../shared/types';
import { TECHSUPPORT_ROOT_USER_ID } from '../../shared/techsupport';
import { escapeHtml } from './ui-formatters';
import { avatarInnerHtml } from './profile-avatar';
import {
  renderChatroomList as renderChatrooms,
  showChatroomDetail as openChatroomDetail,
  updateChatroomMembers as renderChatroomMembers,
  type CustomChatroomRow,
} from './chatrooms-view';
import { normalizeStringList, normalizeTalkFilterShape } from './settings-view';
import type { CustomChatroomDraft } from './custom-chatroom-dialogs';

type ChatroomsViewDeps = Parameters<typeof renderChatrooms>[0];

export type ChatroomShellControllerDeps = {
  getApiBase: () => string;
  getCurrentChatroom: () => string;
  getCurrentUserId: () => string;
  getCurrentUser: () => User | undefined;
  getChatroomMemberCounts: () => ChatroomsViewDeps['chatroomMemberCounts'];
  getChatroomVisitCounts: () => ChatroomsViewDeps['chatroomVisitCounts'];
  getChatroomBrowseMode: () => ChatroomsViewDeps['chatroomBrowseMode'];
  getExpandedChatrooms: () => Set<string>;
  getMatchedUserIds: () => Set<string>;
  getCustomChatrooms: () => CustomChatroomRow[];
  setSessionUser: (user: User) => void;
  setCurrentUserId: (userId: string) => void;
  setChatroomBrowseMode: (mode: ChatroomsViewDeps['chatroomBrowseMode']) => void;
  setCurrentChatroom: (chatroomId: string) => void;
  setCurrentChatroomMembers: (members: Array<{ userId: string; stageName: string }>) => void;
  setChatroomsDetailRoomId: (chatroomId: string | null) => void;
  applyShellTranslations: () => void;
  renderSettingsView: (user: User) => void;
  displayAnswersList: () => void;
  syncReturnHomeButton: () => void;
  syncAppBarOverflow: () => void;
  openPeerDetail: (userId: string, stageName: string) => void;
  rememberPeerName: (userId: string, stageName: string) => void;
  showCreateCustomChatroomDialog: () => Promise<CustomChatroomDraft | null>;
  upsertCustomChatroomFromServer: (row: CustomChatroomRow) => void;
  showNotification: (message: string, type: 'success' | 'error') => void;
  emit: (eventName: string, payload: unknown) => void;
  isTechSupportOnline: () => boolean;
  isUserOnline: (userId: string) => boolean;
  formatDate: (date: Date) => string;
  t: (key: any) => string;
  tf: (key: any, values: Record<string, string | number>) => string;
};

export type ChatroomShellController = ReturnType<typeof createChatroomShellController>;

export function createChatroomShellController(deps: ChatroomShellControllerDeps) {
  let controller: {
    renderChatroomList: () => void;
    showChatroomDetail: (chatroomId: string) => void;
  };

  const viewDeps = (): ChatroomsViewDeps => ({
    currentChatroom: deps.getCurrentChatroom(),
    chatroomMemberCounts: deps.getChatroomMemberCounts(),
    chatroomVisitCounts: deps.getChatroomVisitCounts(),
    chatroomBrowseMode: deps.getChatroomBrowseMode(),
    expandedChatrooms: deps.getExpandedChatrooms(),
    matchedUserIds: deps.getMatchedUserIds(),
    customChatrooms: deps.getCustomChatrooms(),
    setChatroomBrowseMode: deps.setChatroomBrowseMode,
    setCurrentChatroom: (chatroomId) => {
      deps.setCurrentChatroom(chatroomId);
      deps.syncReturnHomeButton();
    },
    setCurrentChatroomMembers: deps.setCurrentChatroomMembers,
    escapeHtml,
    renderChatroomList: () => controller.renderChatroomList(),
    openPeerDetail: deps.openPeerDetail,
    emit: deps.emit,
    currentUserId: deps.getCurrentUserId(),
    apiBase: deps.getApiBase(),
    text: deps.t,
    formatDate: deps.formatDate,
    isTechSupportOnline: deps.isTechSupportOnline,
    isUserOnline: deps.isUserOnline,
    onChatroomDetailOpened: (chatroomId) => deps.setChatroomsDetailRoomId(chatroomId),
  });

  const renderChatroomList = (): void => {
    renderChatrooms(viewDeps());
  };

  const showChatroomDetail = (chatroomId: string): void => {
    openChatroomDetail(viewDeps(), chatroomId);
    deps.syncReturnHomeButton();
  };

  const updateChatroomMembers = (
    members: Array<{ userId: string; stageName: string }>,
    currentUserId: string,
  ): void => {
    deps.setCurrentUserId(currentUserId);
    for (const member of members) {
      if (member.userId && member.stageName) deps.rememberPeerName(member.userId, member.stageName);
    }
    console.log(`📊 Updating member count for ${deps.getCurrentChatroom()}: ${members.length} total members`);
    renderChatroomMembers(viewDeps(), members, currentUserId);
  };

  const handleCreateCustomChatroomClick = async (): Promise<void> => {
    const payload = await deps.showCreateCustomChatroomDialog();
    if (!payload) return;
    const creatorId = deps.getCurrentUserId()
      || deps.getCurrentUser()?.id
      || localStorage.getItem('iinpublic_user_id')
      || 'local-user';
    try {
      const response = await fetch(`${deps.getApiBase()}/api/chatrooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: payload.name,
          type: payload.type,
          createdBy: creatorId,
          ...(payload.description != null ? { description: payload.description } : {}),
          ...(payload.capacity != null ? { capacity: payload.capacity } : {}),
          ...(payload.businessInfo != null ? { businessInfo: payload.businessInfo } : {}),
        }),
      });
      const text = await response.text();
      if (!response.ok) {
        deps.showNotification(text || deps.t('chatroomCreateFailed'), 'error');
        return;
      }
      const created = text ? JSON.parse(text) as Partial<CustomChatroomRow> : null;
      const createdId = String(created?.id || '').trim();
      if (createdId) {
        deps.upsertCustomChatroomFromServer({
          id: createdId,
          name: String(created?.name || payload.name),
          type: created?.type === 'business' ? 'business' : 'custom',
          description: String(created?.description || payload.description || ''),
          createdBy: String(created?.createdBy || creatorId),
          ...(created?.capacity != null || payload.capacity != null
            ? { capacity: created?.capacity ?? payload.capacity! }
            : {}),
          ...(created?.createdAt != null ? { createdAt: created.createdAt } : {}),
          ...(created?.businessInfo != null || payload.businessInfo != null
            ? { businessInfo: created?.businessInfo ?? payload.businessInfo! }
            : {}),
        });
        showChatroomDetail(createdId);
      }
      deps.showNotification(deps.tf('chatroomCreated', { name: created?.name || payload.name }), 'success');
    } catch (error) {
      deps.showNotification(deps.tf('chatroomCreateFailedWithReason', {
        reason: (error as Error).message,
      }), 'error');
    }
  };

  const showChatroomList = (): void => {
    deps.setChatroomsDetailRoomId(null);
    const listContainer = document.getElementById('chatroom-list-container');
    const detailContainer = document.getElementById('chatroom-detail-container');
    if (listContainer) listContainer.style.display = 'flex';
    if (detailContainer) detailContainer.style.display = 'none';
    const backButton = document.getElementById('back-to-chatrooms') as HTMLElement | null;
    if (backButton) backButton.style.display = 'none';
    const createButton = document.getElementById('create-custom-chatroom-btn') as HTMLButtonElement | null;
    if (createButton) {
      createButton.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        void handleCreateCustomChatroomClick();
      };
    }
    const ownerBar = document.getElementById('chatroom-owner-bar');
    if (ownerBar) {
      ownerBar.style.display = 'none';
      ownerBar.innerHTML = '';
    }
    const metadata = document.getElementById('chatroom-metadata');
    if (metadata) {
      metadata.style.display = 'none';
      metadata.innerHTML = '';
    }
    const headerTitle = document.getElementById('header-title');
    if (headerTitle) headerTitle.textContent = '';
    renderChatroomList();
    deps.syncReturnHomeButton();
  };

  const showMainInterface = (user: User): void => {
    user.languages = normalizeStringList(user.languages, ['en']).map((language) => language.toLowerCase());
    user.talkFilters = normalizeTalkFilterShape(user.talkFilters, user.languages);
    deps.setSessionUser(user);
    deps.applyShellTranslations();
    const headerStatus = document.getElementById('header-status');
    const headerUserInfo = document.getElementById('header-user-info');
    if (headerUserInfo) {
      const supportBadge = user.id === TECHSUPPORT_ROOT_USER_ID
        ? `<span class="techsupport-root-badge" data-testid="techsupport-root-badge">${escapeHtml(deps.t('techSupportRootBadge'))}</span>`
        : '';
      headerUserInfo.innerHTML = `
        <div class="user-avatar">
          ${avatarInnerHtml(user.headshot, user.stageName.charAt(0).toUpperCase(), escapeHtml)}
        </div>
        <span class="visually-hidden" data-testid="user-stage-name">${user.stageName}</span>
        ${supportBadge}`;
    }
    if (headerStatus) headerStatus.style.display = 'flex';
    deps.renderSettingsView(user);
    deps.displayAnswersList();
    const chatroomInfo = document.getElementById('chatroom-info');
    if (chatroomInfo) {
      chatroomInfo.innerHTML = `
        <div class="chatroom-title">Global Chatroom</div>
        <div class="chatroom-status">Connected • Ready to meet people nearby</div>`;
    }
    const startupList = document.getElementById('chatroom-list');
    if (!startupList?.querySelector('.chatroom-item')) showChatroomList();
    else {
      deps.syncReturnHomeButton();
      deps.syncAppBarOverflow();
    }
  };

  controller = { renderChatroomList, showChatroomDetail };
  return {
    handleCreateCustomChatroomClick,
    renderChatroomList,
    showChatroomDetail,
    showChatroomList,
    showMainInterface,
    updateChatroomMembers,
  };
}
