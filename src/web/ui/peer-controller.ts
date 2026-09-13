import type { KnownPerson, User } from '../../shared/types';
import { TECHSUPPORT_ROOT_USER_ID } from '../../shared/techsupport';
import {
  openRelationshipDialog,
  renderContactContextSummaryInto,
  saveKnownPerson as saveKnownPersonImpl,
  setBlocked as setBlockedImpl,
  type ContactsViewDeps,
} from './contacts-view';
import { getPeerNameCache, rememberPeerName } from './peer-name-cache';
import { registerTalkForPeer } from './talk-peer-registration';
import { openPeerDetailView } from './user-detail-view';
import type { UiTranslationKey } from './ui-translations';

export interface PeerControllerDeps {
  getCurrentUser: () => User | undefined;
  getCurrentUserId: () => string;
  getApiBase: () => string;
  getCurrentChatroomMembers: () => Array<{ userId: string; stageName: string }>;
  getIncomingTalkClusters: () => any[];
  getMyConversations: () => Record<string, any>;
  getMyTalks: () => Record<string, any>;
  getContactsViewDeps: () => ContactsViewDeps;
  getPublicProfileFoundationReader: () => ((userId: string) => Promise<any>) | undefined;
  getIdentityLinkChecker: () => ((pub: string) => Promise<boolean>) | undefined;
  showConversationDetail: (conversationId: string, talkId?: string) => void;
  showCreatorRepliesForTalk: (talkId: string, title: string) => void;
  displayContactsList: () => void;
  showNotification: (message: string, type: 'info') => void;
  allowOutgoingMessage: (message: string) => boolean;
  emit: (event: string, payload: unknown) => void;
  t: (key: UiTranslationKey) => string;
  formatTalkRelativeTime: (date: Date) => string;
  formatTalkType: (type: string) => string;
  formatTalkLanguage: (language: string) => string;
}

export interface PeerController {
  getKnownPeople(): KnownPerson[];
  getKnownPerson(userId: string): KnownPerson | undefined;
  isBlockedByMe(userId: string): boolean;
  hasSupportContact(): boolean;
  isTechSupportOnline(): boolean;
  setTechSupportOnlineStatus(online: boolean): void;
  isSupportNotificationsMuted(): boolean;
  setSupportNotificationsMuted(muted: boolean): Promise<void>;
  saveKnownPerson(
    userId: string,
    details: {
      labels: KnownPerson['labels'];
      nickname?: string;
      customLabel?: string;
      rating?: number;
      notes?: string;
    },
  ): Promise<void>;
  submitPeerReview(userId: string, rating: number): Promise<void>;
  vouchAgeVerified(userId: string): Promise<void>;
  setBlocked(userId: string, blocked: boolean): Promise<void>;
  getPeerName(userId: string, fallbackName?: string): string;
  rememberPeerName(userId: string, stageName: string): void;
  resolvePeerStageNameLive(userId: string): Promise<string | null>;
  isLinkedIdentityLive(peerId: string): Promise<boolean>;
  openPeerDetailForUser(userId: string, stageName: string): void;
  openDirectConversationWithPeer(peerId: string, peerName: string, talkId?: string): Promise<void>;
  openUserConversationFirst(userId: string, stageName: string): void;
}

export function createPeerController(deps: PeerControllerDeps): PeerController {
  let techSupportOnline = false;
  let controller: PeerController;

  const patchTechSupportPresenceIndicators = () => {
    document.querySelectorAll<HTMLElement>('.techsupport-presence-indicator').forEach((element) => {
      element.classList.toggle('online', techSupportOnline);
      element.classList.toggle('away', !techSupportOnline);
      element.setAttribute('data-techsupport-online', String(techSupportOnline));
      element.setAttribute(
        'aria-label',
        deps.t(techSupportOnline ? 'contactsSupportOnline' : 'contactsSupportAway'),
      );
    });
  };

  const renderPeerContextSection = (
    container: HTMLElement,
    peerId: string,
    peerName: string,
  ) => {
    container.innerHTML = '';
    const contactDeps = deps.getContactsViewDeps();
    const button = document.createElement('button');
    button.id = 'contact-edit-relationship-btn';
    button.className = 'btn';
    button.type = 'button';
    button.setAttribute('data-testid', 'contact-edit-relationship-btn');
    button.textContent = deps.t(
      peerId === TECHSUPPORT_ROOT_USER_ID
        ? 'contactSupportControls'
        : 'contactRelationshipCredit',
    );
    button.style.cssText = 'margin:12px 16px 0;padding:6px 12px;font-size:0.85em;';
    button.addEventListener('click', () => {
      void openRelationshipDialog(contactDeps, peerId, peerName);
    });
    container.appendChild(button);
    renderContactContextSummaryInto(
      container,
      contactDeps,
      peerId,
      null,
      controller.isBlockedByMe(peerId),
      false,
    );
  };

  const openDirectConversationWithPeer = async (
    peerId: string,
    peerName: string,
    talkId?: string,
  ) => {
    try {
      const conversationId = await new Promise<string>((resolve, reject) => {
        deps.emit('openDirectConversation', { peerId, peerName, resolve, reject });
      });
      if (conversationId) deps.showConversationDetail(conversationId, talkId);
    } catch {
      // The peer layout stays open when its DM channel cannot be opened.
    }
  };

  const openPeerDetailForUser = (userId: string, stageName: string) => {
    const knownPerson = controller.getKnownPerson(userId);
    openPeerDetailView(userId, stageName, {
      currentUserId: deps.getCurrentUserId(),
      apiBase: deps.getApiBase(),
      getMyConversations: deps.getMyConversations,
      getMyTalks: deps.getMyTalks,
      getCurrentInterests: () => deps.getCurrentUser()?.interests || [],
      getProfileLanguages: () => deps.getCurrentUser()?.languages || ['en'],
      showConversationDetail: deps.showConversationDetail,
      registerTalkForPeer,
      isBlockedByMe: controller.isBlockedByMe,
      setBlocked: controller.setBlocked,
      isSupportContact: (candidateId) => candidateId === TECHSUPPORT_ROOT_USER_ID,
      isSupportNotificationsMuted: controller.isSupportNotificationsMuted,
      setSupportNotificationsMuted: controller.setSupportNotificationsMuted,
      getTransportStatus: () => {
        const conversation = Object.values(deps.getMyConversations())
          .filter((candidate: any) => candidate?.otherUserId === userId)
          .sort((a: any, b: any) =>
            new Date(b.lastMessageTime || b.createdAt || 0).getTime()
            - new Date(a.lastMessageTime || a.createdAt || 0).getTime())
          [0] as any;
        return {
          mode: String(conversation?.transportMode || 'direct-p2p'),
          fallbackReason: conversation?.transportFallbackReason ?? null,
          lastHealthyAt: conversation?.lastMessageTime ?? null,
        };
      },
      text: deps.t,
      formatRelativeTime: deps.formatTalkRelativeTime,
      formatType: deps.formatTalkType,
      formatLanguage: deps.formatTalkLanguage,
      ...(deps.getPublicProfileFoundationReader()
        ? { getPublicProfileFoundation: deps.getPublicProfileFoundationReader()! }
        : {}),
      sendDirectMessage: (targetId, targetName, text) => new Promise<void>((resolve, reject) => {
        if (!deps.allowOutgoingMessage(text)) {
          reject(new Error('content_filter_blocked'));
          return;
        }
        deps.emit('sendDirectMessage', {
          peerId: targetId,
          peerName: targetName,
          text,
          resolve,
          reject,
        });
      }),
      openDirectConversation: (targetId, targetName, talkId) => {
        void openDirectConversationWithPeer(targetId, targetName, talkId);
      },
      openTalkResponses: deps.showCreatorRepliesForTalk,
      renderPeerContext: renderPeerContextSection,
      resolvePeerStageName: (peerId) => controller.resolvePeerStageNameLive(peerId),
      isLinkedIdentity: (peerId) => controller.isLinkedIdentityLive(peerId),
      ...(knownPerson ? { knownPerson } : {}),
    });
  };

  controller = {
    getKnownPeople: () => {
      const people = deps.getCurrentUser()?.knownPeople;
      return Array.isArray(people) ? people : [];
    },
    getKnownPerson(userId) {
      return controller.getKnownPeople().find((entry) => entry.userId === userId);
    },
    isBlockedByMe(userId) {
      const blocked = deps.getCurrentUser()?.blockedUserIds;
      return Array.isArray(blocked) && blocked.includes(userId);
    },
    hasSupportContact() {
      return Object.values(deps.getMyConversations()).some(
        (conversation: any) => conversation?.supportChannel === true
          && conversation?.otherUserId === TECHSUPPORT_ROOT_USER_ID,
      );
    },
    isTechSupportOnline: () => techSupportOnline,
    setTechSupportOnlineStatus(online) {
      if (techSupportOnline === online) return;
      techSupportOnline = online;
      if (document.querySelector('.nav-btn[data-view="contacts"]')?.classList.contains('active')) {
        deps.displayContactsList();
      }
      patchTechSupportPresenceIndicators();
    },
    isSupportNotificationsMuted() {
      const userId = deps.getCurrentUserId();
      return !!userId
        && localStorage.getItem(`iinpublic_support_notifications_muted:${userId}`) === '1';
    },
    async setSupportNotificationsMuted(muted) {
      const userId = deps.getCurrentUserId();
      if (!userId) return;
      localStorage.setItem(`iinpublic_support_notifications_muted:${userId}`, muted ? '1' : '0');
      deps.showNotification(
        deps.t(muted ? 'contactSupportMutedNotice' : 'contactSupportUnmutedNotice'),
        'info',
      );
      deps.displayContactsList();
    },
    async saveKnownPerson(userId, details) {
      saveKnownPersonImpl(userId, details, {
        getCurrentUser: deps.getCurrentUser,
        emit: deps.emit,
        refreshContactsList: () => void deps.displayContactsList(),
      });
    },
    async submitPeerReview(userId, rating) {
      deps.emit('submitPeerReview', { userId, rating });
    },
    async vouchAgeVerified(userId) {
      deps.emit('vouchAgeVerified', { userId });
    },
    async setBlocked(userId, blocked) {
      return setBlockedImpl(userId, blocked, {
        getCurrentUser: deps.getCurrentUser,
        apiBase: deps.getApiBase(),
        currentUserId: deps.getCurrentUserId(),
        emit: deps.emit,
        refreshContactsList: () => void deps.displayContactsList(),
      });
    },
    getPeerName(userId, fallbackName) {
      const currentMember = deps.getCurrentChatroomMembers()
        .find((member) => member.userId === userId);
      const conversation = Object.values(deps.getMyConversations()).find(
        (candidate: any) => candidate.otherUserId === userId && candidate.otherUserName,
      ) as { otherUserName?: string } | undefined;
      const incomingName = deps.getIncomingTalkClusters()
        .flatMap((cluster: any) => Object.values(cluster?.senders || {}) as any[])
        .find((sender) => sender?.senderId === userId && sender?.senderName)?.senderName;
      const resolved = currentMember?.stageName
        || conversation?.otherUserName
        || incomingName
        || getPeerNameCache()[userId]
        || fallbackName
        || 'Unknown';
      if (resolved !== 'Unknown') controller.rememberPeerName(userId, resolved);
      return resolved;
    },
    rememberPeerName(userId, stageName) {
      rememberPeerName(userId, stageName, deps.getMyConversations);
    },
    async resolvePeerStageNameLive(userId) {
      try {
        const app = (window as any).__iinpublic_app?.getApp?.();
        const user = await app?.gunService?.getPublicUser?.(userId);
        const name = String(user?.stageName || '').trim();
        if (!name) return null;
        controller.rememberPeerName(userId, name);
        return name;
      } catch {
        return null;
      }
    },
    async isLinkedIdentityLive(peerId) {
      const checker = deps.getIdentityLinkChecker();
      if (!checker) return false;
      try {
        const app = (window as any).__iinpublic_app?.getApp?.();
        const user = await app?.gunService?.getPublicUser?.(peerId);
        const pub = String(user?.pub || '').trim();
        return pub ? await checker(pub) : false;
      } catch {
        return false;
      }
    },
    openPeerDetailForUser,
    openDirectConversationWithPeer,
    openUserConversationFirst(userId, stageName) {
      openPeerDetailForUser(userId, stageName);
      void openDirectConversationWithPeer(userId, stageName);
    },
  };

  return controller;
}
