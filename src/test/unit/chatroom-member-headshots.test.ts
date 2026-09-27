/** @jest-environment jsdom */

import { updateChatroomMembers } from '../../web/ui/chatrooms-view';

const PHOTO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function buildDeps(overrides: Record<string, unknown> = {}): any {
  return {
    currentChatroom: 'global',
    chatroomMemberCounts: new Map(),
    chatroomVisitCounts: new Map(),
    chatroomBrowseMode: 'tree',
    expandedChatrooms: new Set(),
    matchedUserIds: new Set(),
    customChatrooms: [],
    setChatroomBrowseMode: jest.fn(),
    setCurrentChatroom: jest.fn(),
    setCurrentChatroomMembers: jest.fn(),
    escapeHtml: (t: string) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'),
    renderChatroomList: jest.fn(),
    openPeerDetail: jest.fn(),
    emit: jest.fn(),
    currentUserId: 'me',
    apiBase: '', // skips the relationship-stats fetch
    text: (key: string) => key,
    formatDate: () => '',
    isTechSupportOnline: () => false,
    isUserOnline: () => false,
    ...overrides,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('chatroom roster shows peers\' profile photos', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="current-chatroom-status"></div><div id="chatroom-members-list"></div>';
  });

  const members = [
    { userId: 'me', stageName: 'Me' },
    { userId: 'honor', stageName: 'UserHonor' },
    { userId: 'plain', stageName: 'Plain' },
  ];
  const avatar = (userId: string) =>
    document.querySelector(`.chatroom-member-item[data-user-id="${userId}"] .chatroom-member-avatar`) as HTMLElement;

  it('renders a photo already in the session cache immediately, and the initial for everyone else', () => {
    updateChatroomMembers(
      buildDeps({ getCachedHeadshot: (id: string) => (id === 'honor' ? PHOTO : null) }),
      members,
      'me',
    );
    expect(avatar('honor').querySelector('img.profile-avatar-image')?.getAttribute('src')).toBe(PHOTO);
    expect(avatar('plain').querySelector('img')).toBeNull();
    expect(avatar('plain').textContent).toBe('P');
  });

  it('fetches missing photos after the first render and patches the avatar in place', async () => {
    const resolvePeerHeadshot = jest.fn(async (id: string) => (id === 'honor' ? PHOTO : null));
    updateChatroomMembers(buildDeps({ resolvePeerHeadshot }), members, 'me');
    expect(avatar('honor').querySelector('img')).toBeNull(); // not there yet: fetch is non-blocking
    await flush();
    expect(avatar('honor').querySelector('img.profile-avatar-image')?.getAttribute('src')).toBe(PHOTO);
    expect(avatar('plain').textContent).toBe('P');
    // The signed-in user is not resolved, and TechSupport's pinned row is never asked for a photo.
    expect(resolvePeerHeadshot).not.toHaveBeenCalledWith('me');
  });

  it('shows a peer\'s newly set photo on the next render and reverts to the initial if it is removed', async () => {
    let current: string | null = null;
    const resolvePeerHeadshot = jest.fn(async () => current);
    const deps = () => buildDeps({ resolvePeerHeadshot });

    updateChatroomMembers(deps(), members, 'me');
    await flush();
    expect(avatar('honor').querySelector('img')).toBeNull();

    current = PHOTO; // UserHonor uploads a photo
    updateChatroomMembers(deps(), members, 'me');
    await flush();
    expect(avatar('honor').querySelector('img')).not.toBeNull();

    current = null; // ...and later removes it
    updateChatroomMembers(deps(), members, 'me');
    await flush();
    // (the re-render rebuilt the row from cache; with no cache dep it starts as the initial)
    expect(avatar('honor').querySelector('img')).toBeNull();
    expect(avatar('honor').textContent).toBe('U');
  });

  it('ignores a resolver failure and keeps the initial', async () => {
    const resolvePeerHeadshot = jest.fn(async () => {
      throw new Error('offline');
    });
    updateChatroomMembers(buildDeps({ resolvePeerHeadshot }), members, 'me');
    await flush();
    expect(avatar('honor').textContent).toBe('U');
  });

  it('never treats a non-image "headshot" (an emoji choice) as a photo URL', () => {
    updateChatroomMembers(buildDeps({ getCachedHeadshot: () => '😎' }), members, 'me');
    expect(avatar('honor').querySelector('img')).toBeNull();
    expect(avatar('honor').textContent).toBe('😎');
  });
});
