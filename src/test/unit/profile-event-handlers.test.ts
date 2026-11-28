import {
  registerProfileEventHandlers,
  type ProfileEventHandlerDeps,
} from '../../web/app/profile-event-handlers';
import type { User } from '../../shared/types';

const user = (): User => ({
  id: 'me',
  stageName: 'Mine',
  languages: ['en'],
  profile: [],
  interests: [],
  knownPeople: [],
  blockedUserIds: [],
  reputation: { score: 0, totalRatings: 0, isHidden: false },
} as unknown as User);

const setup = () => {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const ui: Record<string, any> = {
    on: jest.fn((name: string, handler: (...args: any[]) => unknown) => handlers.set(name, handler)),
    showNotification: jest.fn(),
    showMainInterface: jest.fn(),
    adoptSessionUser: jest.fn(),
    formatAgeVoteSubmitted: jest.fn(() => 'age vote submitted'),
    formatUserBlockChanged: jest.fn(() => 'block changed'),
    formatStageNameUpdated: jest.fn(() => 'name updated'),
    formatProfileUpdated: jest.fn(() => 'profile updated'),
  };
  const users: Record<string, jest.Mock> = {
    updateTalkFilters: jest.fn(async () => undefined),
    updateReputationVisibility: jest.fn(async () => undefined),
    getUser: jest.fn(async () => ({ id: 'peer', stageName: 'Peer', pub: 'peer-pub' })),
    addKnownPerson: jest.fn(async () => undefined),
    setFriendMark: jest.fn(async () => undefined),
    submitPeerReview: jest.fn(async () => undefined),
    vouchAgeVerified: jest.fn(async () => undefined),
    blockUser: jest.fn(async () => ['peer']),
    unblockUser: jest.fn(async () => []),
    updateStageName: jest.fn(async () => undefined),
    syncPublicUserForRelay: jest.fn(async () => undefined),
    updateProfileFoundation: jest.fn(async (_id, updates) => ({ ...user(), ...updates })),
  };
  const current = { value: user() };
  const deps = {
    ui,
    users,
    gun: {
      getStoredPair: jest.fn(() => null),
      getGun: jest.fn(),
    },
    chatrooms: { refreshMembershipStageName: jest.fn() },
    blockSignals: {
      resendToContact: jest.fn(async () => undefined),
      fanOut: jest.fn(async () => undefined),
    },
    blockStatus: { invalidate: jest.fn() },
    currentUser: jest.fn(() => current.value),
    setCurrentUser: jest.fn((next: User) => { current.value = next; }),
    writeCachedUser: jest.fn(),
    refreshStatusBar: jest.fn(),
    refreshNearby: jest.fn(),
    currentRoomId: jest.fn(() => undefined),
    backendApiBase: jest.fn(() => 'http://example.test'),
    renderSupportGreeting: jest.fn(async () => undefined),
  } as unknown as ProfileEventHandlerDeps;
  registerProfileEventHandlers(deps);
  return { deps, handlers, ui, users, current };
};

describe('registerProfileEventHandlers', () => {
  it('registers the profile/contact feature event surface', () => {
    const { handlers, ui } = setup();
    expect([...handlers.keys()]).toEqual([
      'updateTalkFilters',
      'setCreditVisibility',
      'saveKnownPerson',
      'submitPeerReview',
      'vouchAgeVerified',
      'setUserBlocked',
    ]);
    expect(ui.onStageNameChange).toEqual(expect.any(Function));
    expect(ui.onProfileChange).toEqual(expect.any(Function));
  });

  it('updates filters locally before persistence', async () => {
    const { deps, handlers, users, current } = setup();
    const filters = { contactsOnlyTalks: true };
    await handlers.get('updateTalkFilters')?.(filters);

    expect(current.value.talkFilters).toBe(filters);
    expect(deps.writeCachedUser).toHaveBeenCalledWith(current.value);
    expect(users.updateTalkFilters).toHaveBeenCalledWith('me', filters);
  });

  it('updates block state and fans out an opted-in block signal', async () => {
    const { deps, handlers, current, ui } = setup();
    await handlers.get('setUserBlocked')?.({
      userId: 'peer',
      blocked: true,
      notify: { groupId: 'friends', recipientUserIds: ['friend-1'] },
    });

    expect(current.value.blockedUserIds).toEqual(['peer']);
    expect(deps.blockStatus.invalidate).toHaveBeenCalledWith('peer');
    expect(ui.adoptSessionUser).toHaveBeenCalledWith(current.value);
    expect(deps.blockSignals.fanOut).toHaveBeenCalledWith(
      'peer',
      'friends',
      ['friend-1'],
    );
  });

  it('refreshes the cached session and Nearby after a stage-name save', async () => {
    const { deps, ui, users, current } = setup();
    await ui.onStageNameChange('me', 'Renamed');

    expect(users.updateStageName).toHaveBeenCalledWith('me', 'Renamed');
    expect(current.value.stageName).toBe('Renamed');
    expect(deps.writeCachedUser).toHaveBeenCalledWith(current.value);
    expect(deps.refreshStatusBar).toHaveBeenCalled();
    expect(deps.refreshNearby).toHaveBeenCalled();
    expect(ui.showNotification).toHaveBeenCalledWith('name updated', 'success');
  });

  it('merges a successful profile save back into the latest session user', async () => {
    const { deps, ui, current } = setup();
    await ui.onProfileChange('me', {
      languages: ['fr'],
      profile: [{ id: 'p', question: 'Q', answer: 'A', isAuto: false, answeredAt: new Date() }],
      interests: [],
    });

    expect(current.value.languages).toEqual(['fr']);
    expect(deps.setCurrentUser).toHaveBeenCalled();
    expect(deps.writeCachedUser).toHaveBeenCalledWith(current.value);
    expect(ui.showNotification).toHaveBeenCalledWith('profile updated', 'success');
  });
});
