import { WebUserService } from '../../web/services/web-user-service';
import type { GunPair } from '../../web/services/gun-bridge';
import type { User } from '../../shared/types';

const pair: GunPair = {
  pub: 'pub-key',
  priv: 'priv-key',
  epub: 'epub-key',
  epriv: 'epriv-key',
};

describe('WebUserService', () => {
  it('creates a public user record and stores owner-only fields privately', async () => {
    const gunService = {
      put: jest.fn().mockResolvedValue(undefined),
      putPrivate: jest.fn().mockResolvedValue(undefined),
      getStoredPair: jest.fn(() => pair),
    };

    const service = new WebUserService(gunService as any);
    const user = await service.createUser({
      stageName: 'Alice',
      headshot: 'data:image/png;base64,abc',
      profile: [
        {
          id: 'qa1',
          question: 'Coffee?',
          answer: 'Yes',
          isAuto: false,
          answeredAt: new Date('2026-04-21T10:00:00.000Z'),
        },
      ],
      languages: ['en', 'fr'],
      interests: [{ id: 'coffee', name: 'Coffee', category: 'other', popularity: 1 }],
      knownPeople: [
        {
          userId: 'friend-1',
          label: 'friend',
          addedAt: new Date('2026-04-21T11:00:00.000Z'),
        },
      ],
      pub: pair.pub,
      epub: pair.epub,
    });

    // users, user-public-profile, user-talk-filters, user-tags, tag-index/<tag>
    expect(gunService.put).toHaveBeenCalledTimes(5);
    const publicRecord = gunService.put.mock.calls[0][1] as User;
    expect(publicRecord.stageName).toBe('Alice');
    expect(publicRecord.pub).toBe(pair.pub);
    expect(publicRecord.epub).toBe(pair.epub);
    expect(publicRecord.profile).toEqual(user.profile);
    expect(publicRecord.languages).toEqual(['en', 'fr']);
    expect(publicRecord.interests).toEqual([{ id: 'coffee', name: 'Coffee', category: 'other', popularity: 1 }]);
    expect(publicRecord.knownPeople).toEqual([]);
    expect(publicRecord.headshot).toBe('data:image/png;base64,abc');
    const createdUserId = publicRecord.id;
    expect(gunService.put).toHaveBeenCalledWith(
      `user-public-profile/${createdUserId}`,
      expect.objectContaining({
        headshot: 'data:image/png;base64,abc',
        languagesJson: JSON.stringify(['en', 'fr']),
        profileJson: JSON.stringify(user.profile),
      }),
    );
    expect(gunService.put).toHaveBeenCalledWith(
      `user-talk-filters/${createdUserId}`,
      expect.objectContaining({
        filtersJson: JSON.stringify({
          allowedLanguages: ['en', 'fr'],
          minDistanceMiles: 0,
          maxDistanceMiles: 50,
          requireGoodGrammar: true,
          blockDirtyWords: true,
          allowedTalkTypes: ['flow', 'survey', 'tag', 'route'],
        }),
      }),
    );
    expect(gunService.put).toHaveBeenCalledWith(
      `user-tags/${createdUserId}`,
      expect.objectContaining({
        version: 1,
        hash: expect.any(String),
        tags: { coffee: 1 },
      }),
    );
    // Inverted index (spec §22.4.1): the new user is registered under each tag.
    expect(gunService.put).toHaveBeenCalledWith(
      `tag-index/coffee`,
      { [createdUserId]: true },
    );

    expect(gunService.putPrivate).toHaveBeenCalledWith(
      'profile',
      expect.objectContaining({
        headshot: 'data:image/png;base64,abc',
        profile: user.profile,
        languages: ['en', 'fr'],
        knownPeople: user.knownPeople,
        blockedUserIds: [],
      }),
    );
  });

  it('merges private user data back into the current user record', async () => {
    const publicUser: User = {
      id: 'user-1',
      stageName: 'Alice',
      profile: [],
      reputation: {
        questionsAnswered: 0,
        talksSent: 0,
        matchesFound: 0,
        friendsCount: 0,
        mutualFriendsCount: 0,
        likedCount: 0,
        dislikedCount: 0,
        starRating: 3,
        reviewCount: 0,
        ageVerified: false,
        ageVerificationVotes: 0,
        blockCount: 0,
        isHidden: false,
      },
      location: { region: 'region-1', chatrooms: [] },
      languages: ['en'],
      interests: [],
      createdAt: new Date('2026-04-21T10:00:00.000Z'),
      lastActive: new Date('2026-04-21T10:00:00.000Z'),
      knownPeople: [],
      pub: pair.pub,
      epub: pair.epub,
    };
    const gunService = {
      get: jest.fn(async (path: string) => path === 'user-public-profile/user-1' ? null : publicUser),
      getPrivate: jest.fn().mockResolvedValue({
        headshot: 'data:image/png;base64,private',
        profile: [
          {
            id: 'qa1',
            question: 'Coffee?',
            answer: 'Yes',
            isAuto: false,
            answeredAt: new Date('2026-04-21T12:00:00.000Z'),
          },
        ],
        languages: ['en', 'fr'],
        interests: [{ id: 'coffee', name: 'Coffee', category: 'other', popularity: 1 }],
        knownPeople: [
          {
            userId: 'friend-1',
            label: 'friend',
            addedAt: new Date('2026-04-21T11:00:00.000Z'),
          },
        ],
        blockedUserIds: ['blocked-1'],
        talkFilters: {
          allowedLanguages: ['en', 'zh'],
          requireGoodGrammar: true,
          blockDirtyWords: true,
          allowedTalkTypes: ['tag', 'flow'],
        },
      }),
      getStoredPair: jest.fn(() => pair),
    };

    const service = new WebUserService(gunService as any);
    const user = await service.getUser('user-1');

    expect(gunService.getPrivate).toHaveBeenCalledWith('profile');
    expect(user.headshot).toBe('data:image/png;base64,private');
    expect(user.languages).toEqual(['en', 'fr']);
    expect(user.profile).toHaveLength(1);
    expect(user.knownPeople).toHaveLength(1);
    expect(user.blockedUserIds).toEqual(['blocked-1']);
    expect(user.talkFilters?.allowedLanguages).toEqual(['en', 'zh']);
  });

  it('loads the public profile headshot marker over stale graph and private values', async () => {
    const publicUser = {
      id: 'user-1',
      stageName: 'Alice',
      headshot: '🙂',
      profile: [],
      languages: ['en'],
      interests: [],
      knownPeople: [],
      pub: pair.pub,
      reputation: {} as User['reputation'],
      location: { region: '', chatrooms: [] },
      createdAt: new Date(),
      lastActive: new Date(),
    } as User;
    const gunService = {
      get: jest.fn(async (path: string) => path === 'user-public-profile/user-1'
        ? { headshot: 'data:image/png;base64,new', languagesJson: '["en"]', profileJson: '[]', interestsJson: '[]' }
        : publicUser),
      getPrivate: jest.fn().mockResolvedValue({ ...publicUser, headshot: 'data:image/png;base64,stale' }),
      getStoredPair: jest.fn(() => pair),
    };

    const user = await new WebUserService(gunService as any).getUser('user-1');

    expect(user.headshot).toBe('data:image/png;base64,new');
  });

  it('keeps a cleared public profile headshot removed after reload', async () => {
    const publicUser = {
      id: 'user-1',
      stageName: 'Alice',
      headshot: 'data:image/png;base64,old',
      profile: [],
      languages: ['en'],
      interests: [],
      knownPeople: [],
      pub: pair.pub,
      reputation: {} as User['reputation'],
      location: { region: '', chatrooms: [] },
      createdAt: new Date(),
      lastActive: new Date(),
    } as User;
    const gunService = {
      get: jest.fn(async (path: string) => path === 'user-public-profile/user-1'
        ? { headshot: '', languagesJson: '["en"]', profileJson: '[]', interestsJson: '[]' }
        : publicUser),
      getPrivate: jest.fn().mockResolvedValue({ ...publicUser, headshot: 'data:image/png;base64,old' }),
      getStoredPair: jest.fn(() => pair),
    };

    const user = await new WebUserService(gunService as any).getUser('user-1');

    expect(user.headshot).toBeUndefined();
  });

  it('publishes identity keys without rewriting private user fields', async () => {
    const gunService = {
      put: jest.fn().mockResolvedValue(undefined),
    };

    const service = new WebUserService(gunService as any);
    await service.publishIdentityKeys('user-1', pair);

    expect(gunService.put).toHaveBeenCalledWith('users/user-1', {
      pub: pair.pub,
      epub: pair.epub,
    });
  });

  it('updates profile foundation fields in both public and private storage', async () => {
    const currentUser: User = {
      id: 'user-1',
      stageName: 'Alice',
      headshot: '🙂',
      profile: [],
      reputation: {
        questionsAnswered: 0,
        talksSent: 0,
        matchesFound: 0,
        friendsCount: 0,
        mutualFriendsCount: 0,
        likedCount: 0,
        dislikedCount: 0,
        starRating: 3,
        reviewCount: 0,
        ageVerified: false,
        ageVerificationVotes: 0,
        blockCount: 0,
        isHidden: false,
      },
      location: { region: 'region-1', chatrooms: [] },
      languages: ['en'],
      interests: [],
      createdAt: new Date('2026-04-21T10:00:00.000Z'),
      lastActive: new Date('2026-04-21T10:00:00.000Z'),
      knownPeople: [],
      pub: pair.pub,
      epub: pair.epub,
    };
    const gunService = {
      get: jest.fn().mockResolvedValue(currentUser),
      getPrivate: jest.fn().mockResolvedValue(null),
      put: jest.fn().mockResolvedValue(undefined),
      putPrivate: jest.fn().mockResolvedValue(undefined),
      getStoredPair: jest.fn(() => pair),
    };

    const service = new WebUserService(gunService as any);
    const updated = await service.updateProfileFoundation('user-1', {
      headshot: '😎',
      languages: ['en', 'zh'],
      profile: [
        {
          id: 'profile_1',
          question: 'Favorite drink',
          answer: 'Coffee',
          isAuto: false,
          answeredAt: new Date('2026-04-21T10:00:00.000Z'),
        },
      ],
      interests: [{ id: 'int_tennis', name: 'Tennis', category: 'other', popularity: 1 }],
    });

    expect(updated.headshot).toBe('😎');
    expect(updated.languages).toEqual(['en', 'zh']);
    expect(updated.profile).toHaveLength(1);
    expect(updated.interests).toEqual([{ id: 'int_tennis', name: 'Tennis', category: 'other', popularity: 1 }]);
    expect(gunService.put).toHaveBeenCalledWith(
      'users/user-1',
      expect.objectContaining({
        headshot: '😎',
        languages: ['en', 'zh'],
        profile: updated.profile,
        interests: updated.interests,
      }),
    );
    expect(gunService.put).toHaveBeenCalledWith(
      'user-public-profile/user-1',
      expect.objectContaining({
        headshot: '😎',
        languagesJson: JSON.stringify(['en', 'zh']),
        profileJson: JSON.stringify(updated.profile),
        interestsJson: JSON.stringify(updated.interests),
      }),
    );
    expect(gunService.put).toHaveBeenCalledWith(
      'user-tags/user-1',
      expect.objectContaining({
        version: 1,
        hash: expect.any(String),
        tags: { tennis: 1 },
      }),
    );
    expect(gunService.putPrivate).toHaveBeenCalledWith(
      'profile',
      expect.objectContaining({
        headshot: '😎',
        languages: ['en', 'zh'],
        profile: updated.profile,
        interests: updated.interests,
      }),
    );
  });

  it('writes clear markers when a public headshot is removed', async () => {
    const currentUser: User = {
      id: 'user-1',
      stageName: 'Alice',
      headshot: 'data:image/png;base64,old',
      profile: [],
      reputation: {
        questionsAnswered: 0, talksSent: 0, matchesFound: 0, friendsCount: 0, mutualFriendsCount: 0,
        likedCount: 0, dislikedCount: 0, starRating: 3, reviewCount: 0, ageVerified: false,
        ageVerificationVotes: 0, blockCount: 0, isHidden: false,
      },
      location: { region: 'region-1', chatrooms: [] },
      languages: ['en'],
      interests: [],
      createdAt: new Date('2026-04-21T10:00:00.000Z'),
      lastActive: new Date('2026-04-21T10:00:00.000Z'),
      knownPeople: [],
      pub: pair.pub,
      epub: pair.epub,
    };
    const gunService = {
      get: jest.fn().mockResolvedValue(currentUser),
      getPrivate: jest.fn().mockResolvedValue(null),
      put: jest.fn().mockResolvedValue(undefined),
      putPrivate: jest.fn().mockResolvedValue(undefined),
      getStoredPair: jest.fn(() => pair),
    };

    const service = new WebUserService(gunService as any);
    const updated = await service.updateProfileFoundation('user-1', {
      languages: ['en'],
      profile: [],
      interests: [],
    });

    expect(updated.headshot).toBeUndefined();
    expect(gunService.put).toHaveBeenCalledWith('users/user-1', expect.objectContaining({ headshot: '' }));
    expect(gunService.put).toHaveBeenCalledWith('user-public-profile/user-1', expect.objectContaining({ headshot: '' }));
    expect(gunService.putPrivate).toHaveBeenCalledWith('profile', expect.objectContaining({ headshot: '' }));
  });

  it('updates talk filters in both public mirror and private storage', async () => {
    const currentUser: User = {
      id: 'user-1',
      stageName: 'Alice',
      profile: [],
      reputation: {
        questionsAnswered: 0,
        talksSent: 0,
        matchesFound: 0,
        friendsCount: 0,
        mutualFriendsCount: 0,
        likedCount: 0,
        dislikedCount: 0,
        starRating: 3,
        reviewCount: 0,
        ageVerified: false,
        ageVerificationVotes: 0,
        blockCount: 0,
        isHidden: false,
      },
      location: { region: 'region-1', chatrooms: [] },
      languages: ['en'],
      interests: [],
      createdAt: new Date('2026-04-21T10:00:00.000Z'),
      lastActive: new Date('2026-04-21T10:00:00.000Z'),
      knownPeople: [],
      pub: pair.pub,
      epub: pair.epub,
      talkFilters: {
        allowedLanguages: ['en'],
        requireGoodGrammar: false,
        blockDirtyWords: false,
        allowedTalkTypes: ['flow', 'survey', 'tag', 'route'],
      },
    };
    const gunService = {
      get: jest.fn().mockResolvedValue(currentUser),
      getPrivate: jest.fn().mockResolvedValue(null),
      put: jest.fn().mockResolvedValue(undefined),
      putPrivate: jest.fn().mockResolvedValue(undefined),
      getStoredPair: jest.fn(() => pair),
    };
    const service = new WebUserService(gunService as any);

    await service.updateTalkFilters('user-1', {
      allowedLanguages: ['zh'],
      requireGoodGrammar: true,
      blockDirtyWords: true,
      allowedTalkTypes: ['tag'],
      minDistanceMiles: 5,
    });

    expect(gunService.put).toHaveBeenCalledWith(
      'user-talk-filters/user-1',
      expect.objectContaining({
        filtersJson: JSON.stringify({
          allowedLanguages: ['zh'],
          requireGoodGrammar: true,
          blockDirtyWords: true,
          allowedTalkTypes: ['tag'],
          minDistanceMiles: 5,
        }),
      }),
    );
    expect(gunService.putPrivate).toHaveBeenCalledWith(
      'profile',
      expect.objectContaining({
        talkFilters: expect.objectContaining({
          allowedLanguages: ['zh'],
          requireGoodGrammar: true,
          blockDirtyWords: true,
          allowedTalkTypes: ['tag'],
          minDistanceMiles: 5,
        }),
      }),
    );
  });

  it('persists block and unblock state in the public mirror and private profile data', async () => {
    const currentUser: User = {
      id: 'user-1',
      stageName: 'Alice',
      profile: [],
      reputation: {
        questionsAnswered: 0,
        talksSent: 0,
        matchesFound: 0,
        friendsCount: 0,
        mutualFriendsCount: 0,
        likedCount: 0,
        dislikedCount: 0,
        starRating: 3,
        reviewCount: 0,
        ageVerified: false,
        ageVerificationVotes: 0,
        blockCount: 0,
        isHidden: false,
      },
      location: { region: 'region-1', chatrooms: [] },
      languages: ['en'],
      interests: [],
      createdAt: new Date('2026-04-21T10:00:00.000Z'),
      lastActive: new Date('2026-04-21T10:00:00.000Z'),
      knownPeople: [],
      blockedUserIds: [],
      pub: pair.pub,
      epub: pair.epub,
    };
    // Mock Gun graph: gun.get(segment).get(segment).put(data, cb) -> cb({ok:true})
    const mockGun = {
      get: jest.fn().mockReturnThis(),
      put: jest.fn((_data, _cb) => _cb && _cb({ ok: true })),
    };
    const gunService = {
      get: jest.fn().mockResolvedValue(currentUser),
      getPrivate: jest.fn().mockResolvedValue(null),
      put: jest.fn().mockResolvedValue(undefined),
      putPrivate: jest.fn().mockResolvedValue(undefined),
      getStoredPair: jest.fn(() => pair),
      getGun: jest.fn(() => mockGun),
    };
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const service = new WebUserService(gunService as any);

    const blocked = await service.blockUser('user-1', 'user-2');
    expect(blocked).toEqual(['user-2']);
    // putNested uses getGun() directly, not gunService.put
    // but put() IS used for updating target's reputation blockCount
    const putCalls = (gunService.put as any).mock.calls;
    expect(putCalls.length).toBeGreaterThanOrEqual(1);
    const hasReputationUpdate = putCalls.some(
      (call: [string, any]) => call[0]?.startsWith('users/user-2/reputation')
    );
    expect(hasReputationUpdate).toBe(true);
    // putNested calls: user-blocks/user-1/user-2 and user-blocked-by/user-2/user-1
    expect(mockGun.put).toHaveBeenCalledTimes(2);

    gunService.get.mockResolvedValue({ ...currentUser, blockedUserIds: ['user-2'] });
    const unblocked = await service.unblockUser('user-1', 'user-2');
    expect(unblocked).toEqual([]);
    // unblock also calls putNested twice (null) and put() for reputation
  });
});
