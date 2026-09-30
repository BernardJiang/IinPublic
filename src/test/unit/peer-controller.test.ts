/** @jest-environment jsdom */

const openPeerDetailView = jest.fn();
jest.mock('../../web/ui/user-detail-view', () => ({
  openPeerDetailView: (...args: unknown[]) => openPeerDetailView(...args),
}));

import { createPeerController, type PeerControllerDeps } from '../../web/ui/peer-controller';
import { uiText } from '../../web/ui/ui-translations';

function deps(overrides: Partial<PeerControllerDeps> = {}): PeerControllerDeps {
  const currentUser: any = {
    id: 'me',
    knownPeople: [{ userId: 'known', labels: ['friend'] }],
    blockedUserIds: ['blocked'],
    interests: [],
    languages: ['en'],
  };
  return {
    getCurrentUser: () => currentUser,
    getCurrentUserId: () => 'me',
    getApiBase: () => '',
    getCurrentChatroomMembers: () => [],
    getIncomingTalkClusters: () => [],
    getMyConversations: () => ({}),
    getMyTalks: () => ({}),
    getContactsViewDeps: jest.fn() as any,
    getPublicProfileFoundationReader: () => undefined,
    getHandshakeDiagnosticsReader: () => undefined,
    getIdentityLinkChecker: () => undefined,
    showConversationDetail: jest.fn(),
    showCreatorRepliesForTalk: jest.fn(),
    displayContactsList: jest.fn(),
    showNotification: jest.fn(),
    allowOutgoingMessage: () => true,
    emit: jest.fn(),
    t: (key) => uiText('en', key),
    formatTalkRelativeTime: () => 'Just now',
    formatTalkType: (type) => type,
    formatTalkLanguage: (language) => language,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.replaceChild(document.createElement('body'), document.body);
});

describe('peer controller', () => {
  it('reads known and blocked relationships from the live user', () => {
    const controller = createPeerController(deps());
    expect(controller.getKnownPerson('known')?.userId).toBe('known');
    expect(controller.isBlockedByMe('blocked')).toBe(true);
    expect(controller.isBlockedByMe('other')).toBe(false);
  });

  it('resolves live roster names before stored conversation fallbacks', () => {
    const conversations = {
      c1: { otherUserId: 'peer', otherUserName: 'Stored Name' },
    };
    const controller = createPeerController(deps({
      getCurrentChatroomMembers: () => [{ userId: 'peer', stageName: 'Live Name' }],
      getMyConversations: () => conversations,
    }));
    expect(controller.getPeerName('peer', 'Fallback')).toBe('Live Name');
    expect(conversations.c1.otherUserName).toBe('Live Name');
  });

  it('patches TechSupport presence without replacing the roster', () => {
    document.body.innerHTML = `
      <button class="nav-btn active" data-view="contacts"></button>
      <span class="techsupport-presence-indicator away"></span>`;
    const displayContactsList = jest.fn();
    const controller = createPeerController(deps({ displayContactsList }));
    controller.setTechSupportOnlineStatus(true);

    const indicator = document.querySelector('.techsupport-presence-indicator') as HTMLElement;
    expect(controller.isTechSupportOnline()).toBe(true);
    expect(indicator.classList.contains('online')).toBe(true);
    expect(indicator.dataset.techsupportOnline).toBe('true');
    expect(displayContactsList).toHaveBeenCalledTimes(1);
  });

  it('persists per-user support mute state and refreshes contacts', async () => {
    const showNotification = jest.fn();
    const displayContactsList = jest.fn();
    const controller = createPeerController(deps({ showNotification, displayContactsList }));
    await controller.setSupportNotificationsMuted(true);

    expect(controller.isSupportNotificationsMuted()).toBe(true);
    expect(localStorage.getItem('iinpublic_support_notifications_muted:me')).toBe('1');
    expect(showNotification).toHaveBeenCalledWith(expect.any(String), 'info');
    expect(displayContactsList).toHaveBeenCalledTimes(1);
  });

  it('opens the resolved direct conversation and preserves talk scope', async () => {
    const emit = jest.fn((_event, payload: any) => payload.resolve('conversation-1'));
    const showConversationDetail = jest.fn();
    const controller = createPeerController(deps({ emit, showConversationDetail }));
    await controller.openDirectConversationWithPeer('peer', 'Peer', 'talk-1');

    expect(emit).toHaveBeenCalledWith('openDirectConversation', expect.objectContaining({
      peerId: 'peer',
      peerName: 'Peer',
    }));
    expect(showConversationDetail).toHaveBeenCalledWith('conversation-1', 'talk-1');
  });

  describe('openPeerDetailForUser — scenario 2 build-trust wiring (§16)', () => {
    beforeEach(() => {
      openPeerDetailView.mockClear();
    });

    it('computes the same sorted-pair conversationId WebConversationService uses and forwards the reader result', () => {
      const diagnostics = { buildTrust: 'official-verified' } as any;
      const reader = jest.fn().mockReturnValue(diagnostics);
      const controller = createPeerController(deps({ getHandshakeDiagnosticsReader: () => reader }));
      controller.openPeerDetailForUser('zeta-peer', 'Zeta');

      const passedDeps = openPeerDetailView.mock.calls[0][2];
      expect(passedDeps.getBuildTrustLabel()).toBe('official-verified');
      // 'me' < 'zeta-peer' lexicographically, matching WebConversationService.buildPairConversationId's sort.
      expect(reader).toHaveBeenCalledWith('conv_pair_me_zeta-peer', 'me');
    });

    it('sorts the conversationId the other way when the peer id sorts first', () => {
      const reader = jest.fn().mockReturnValue({ buildTrust: 'community-build' });
      const controller = createPeerController(deps({ getHandshakeDiagnosticsReader: () => reader }));
      controller.openPeerDetailForUser('aaa-peer', 'Aaa');

      const passedDeps = openPeerDetailView.mock.calls[0][2];
      expect(passedDeps.getBuildTrustLabel()).toBe('community-build');
      expect(reader).toHaveBeenCalledWith('conv_pair_aaa-peer_me', 'me');
    });

    it('returns undefined (never throws) when no reader has been wired', () => {
      const controller = createPeerController(deps({ getHandshakeDiagnosticsReader: () => undefined }));
      controller.openPeerDetailForUser('peer', 'Peer');
      const passedDeps = openPeerDetailView.mock.calls[0][2];
      expect(passedDeps.getBuildTrustLabel()).toBeUndefined();
    });
  });
});
