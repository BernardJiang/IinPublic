/**
 * @jest-environment jsdom
 *
 * TODO §I — "Show verified direct links in peer detail without merging Contacts,
 * authorship, reputation, blocks, or Q&A." Covers openPeerDetailView's new
 * isLinkedIdentity-driven badge: rendered only when the dep resolves true, cleared on
 * every open (including a stale in-flight resolution for a peer the user has since
 * navigated away from), and purely informational — it renders no merged data.
 */

import { openPeerDetailView, type UserDetailViewDeps } from '../../web/ui/user-detail-view';
import { uiText } from '../../web/ui/ui-translations';

describe('openPeerDetailView — linked-identity badge (TODO §I)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="peer-detail-overlay" id="peer-detail-overlay" style="display: none;">
        <div class="peer-detail-header">
          <button id="back-from-peer-detail"></button>
          <div id="peer-detail-name"></div>
          <div id="peer-detail-subtitle"></div>
          <button id="peer-send-talks-btn"></button>
          <button id="peer-overflow-btn"></button>
          <div id="peer-overflow-panel"></div>
          <button id="peer-block-user-btn"></button>
        </div>
        <div class="peer-detail-body">
          <div id="peer-context-section"></div>
          <div id="peer-linked-identity-section"></div>
          <div id="peer-stats-section"></div>
          <div id="peer-conversations-section"></div>
          <textarea id="peer-dm-input"></textarea>
          <button id="peer-dm-send-btn"></button>
          <div id="peer-history-controls" style="display:none;"></div>
          <div id="peer-talk-history-list"></div>
          <input type="checkbox" id="peer-auto-mode-checkbox">
        </div>
      </div>
    `;
  });

  function baseDeps(overrides: Partial<UserDetailViewDeps> = {}): UserDetailViewDeps {
    return {
      currentUserId: 'me',
      apiBase: 'http://localhost',
      getMyConversations: () => ({}),
      getMyTalks: () => ({}),
      showConversationDetail: () => {},
      registerTalkForPeer: async () => {},
      isBlockedByMe: () => false,
      setBlocked: async () => {},
      isSupportContact: () => false,
      isSupportNotificationsMuted: () => false,
      setSupportNotificationsMuted: async () => {},
      sendDirectMessage: async () => {},
      openDirectConversation: () => {},
      getTransportStatus: () => ({ mode: 'direct-p2p' }),
      text: (key) => uiText('en', key),
      formatRelativeTime: () => '',
      formatType: (type) => type,
      formatLanguage: (code) => code,
      ...overrides,
    };
  }

  function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('renders the badge when isLinkedIdentity resolves true', async () => {
    const deps = baseDeps({ isLinkedIdentity: async () => true });
    openPeerDetailView('peer-1', 'Peer One', deps);
    await flush();
    const section = document.getElementById('peer-linked-identity-section')!;
    expect(section.innerHTML).toContain('peer-linked-identity-badge');
    expect(section.textContent).toContain(uiText('en', 'peerLinkedIdentityBadge'));
    expect(section.textContent).toContain(uiText('en', 'peerLinkedIdentityNote'));
  });

  it('renders nothing when isLinkedIdentity resolves false', async () => {
    const deps = baseDeps({ isLinkedIdentity: async () => false });
    openPeerDetailView('peer-1', 'Peer One', deps);
    await flush();
    const section = document.getElementById('peer-linked-identity-section')!;
    expect(section.innerHTML).toBe('');
  });

  it('renders nothing when isLinkedIdentity is not provided', async () => {
    const deps = baseDeps();
    openPeerDetailView('peer-1', 'Peer One', deps);
    await flush();
    const section = document.getElementById('peer-linked-identity-section')!;
    expect(section.innerHTML).toBe('');
  });

  it('clears a previous badge immediately when opening a different peer', async () => {
    const deps = baseDeps({ isLinkedIdentity: async () => true });
    openPeerDetailView('peer-1', 'Peer One', deps);
    await flush();
    expect(document.getElementById('peer-linked-identity-section')!.innerHTML).not.toBe('');

    const deps2 = baseDeps({ isLinkedIdentity: async () => false });
    openPeerDetailView('peer-2', 'Peer Two', deps2);
    // Reset happens synchronously, before the async isLinkedIdentity check resolves.
    expect(document.getElementById('peer-linked-identity-section')!.innerHTML).toBe('');
    await flush();
    expect(document.getElementById('peer-linked-identity-section')!.innerHTML).toBe('');
  });

  it('discards a stale resolution for a peer the user has since navigated away from', async () => {
    let resolveFirst!: (linked: boolean) => void;
    const firstCheck = new Promise<boolean>((resolve) => { resolveFirst = resolve; });
    const deps = baseDeps({ isLinkedIdentity: () => firstCheck });
    openPeerDetailView('peer-1', 'Peer One', deps);

    // Navigate to a second peer before the first peer's check resolves.
    const deps2 = baseDeps({ isLinkedIdentity: async () => false });
    openPeerDetailView('peer-2', 'Peer Two', deps2);

    // The first (stale) check now resolves true — must NOT paint the badge, since the
    // overlay is showing peer-2, not peer-1.
    resolveFirst(true);
    await flush();
    expect(document.getElementById('peer-linked-identity-section')!.innerHTML).toBe('');
  });
});
