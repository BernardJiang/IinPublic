import { GunService } from '../../server/services/gun-service';
import { UserService } from '../../server/services/user-service';
import { TalkService } from '../../server/services/talk-service';
import { ReputationService } from '../../server/services/reputation-service';

// Mock Gun.js for integration tests
jest.mock('gun', () => {
  const mockGun = {
    get: jest.fn().mockReturnThis(),
    put: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    on: jest.fn().mockReturnThis(),
    once: jest.fn().mockReturnThis(),
    off: jest.fn().mockReturnThis(),
    map: jest.fn().mockReturnThis(),
    opt: jest.fn().mockReturnThis(),
  };

  return {
    __esModule: true,
    default: jest.fn(() => mockGun),
  };
});

describe('Service Integration Tests', () => {
  let gunService: GunService;
  let userService: UserService;
  let reputationService: ReputationService;
  let talkService: TalkService;

  beforeEach(() => {
    gunService = new GunService();
    userService = new UserService(gunService);
    reputationService = new ReputationService(gunService);
    talkService = new TalkService(gunService, reputationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GunService normalization', () => {
    it('deserializes Gun array objects back into arrays', async () => {
      const mockGun = gunService.getGun();
      mockGun.once.mockImplementationOnce((cb: (data: unknown) => void) => {
        cb({
          stageName: 'Tom',
          languages: { _isArray: true, _length: 2, 0: 'en', 1: 'zh' },
          profile: {
            _isArray: true,
            _length: 1,
            0: {
              id: 'profile_1',
              question: 'Favorite drink',
              answer: 'Coffee',
              isAuto: false,
              answeredAt: '2026-04-29T12:00:00.000Z',
            },
          },
        });
      });

      const result = await gunService.get('users/user-1');

      expect(result.languages).toEqual(['en', 'zh']);
      expect(Array.isArray(result.profile)).toBe(true);
      expect(result.profile[0]).toEqual(
        expect.objectContaining({
          question: 'Favorite drink',
          answer: 'Coffee',
        }),
      );
      expect(result.profile[0].answeredAt).toBeInstanceOf(Date);
    });
  });

  describe('UserService Integration', () => {
    it('should create user and store in Gun database', async () => {
      const userData = {
        stageName: 'TestUser',
        profile: [],
        languages: ['en'],
        interests: [],
      };

      // Mock Gun put method to simulate successful storage
      const mockPut = jest.spyOn(gunService, 'put').mockResolvedValue(undefined);

      const user = await userService.createUser(userData);

      expect(user).toBeDefined();
      expect(user.stageName).toBe('TestUser');
      expect(user.id).toBeDefined();
      expect(mockPut).toHaveBeenCalled();
    });

    it('should retrieve user from Gun database', async () => {
      const mockUser = {
        id: 'user123',
        stageName: 'TestUser',
        profile: [],
        reputation: {
          questionsAnswered: 5,
          talksSent: 3,
          matchesFound: 1,
          friendsCount: 10,
          mutualFriendsCount: 2,
          likedCount: 0,
          dislikedCount: 0,
          starRating: 4.0,
          reviewCount: 4,
          ageVerified: true,
          ageVerificationVotes: 8,
          blockCount: 0,
          isHidden: false,
        },
        location: { region: 'test-region', chatrooms: [] },
        languages: ['en'],
        interests: [],
        createdAt: new Date(),
        lastActive: new Date(),
      };

      const mockGet = jest.spyOn(gunService, 'get').mockResolvedValueOnce(mockUser);
      const mockGetOptional = jest.spyOn(gunService, 'getOptional').mockResolvedValueOnce({
          headshot: '😎',
          languagesJson: JSON.stringify(['en', 'zh']),
          profileJson: JSON.stringify([
            {
              id: 'profile_1',
              question: 'Favorite drink',
              answer: 'Coffee',
              isAuto: false,
              answeredAt: '2026-04-29T12:00:00.000Z',
            },
          ]),
          interestsJson: JSON.stringify([]),
        });
      const mockGetPath = jest
        .spyOn(gunService, 'getPath')
        .mockResolvedValueOnce(mockUser.reputation as any);

      const retrievedUser = await userService.getUser('user123');

      expect(retrievedUser).toEqual({
        ...mockUser,
        headshot: '😎',
        languages: ['en', 'zh'],
        profile: [
          {
            id: 'profile_1',
            question: 'Favorite drink',
            answer: 'Coffee',
            isAuto: false,
            answeredAt: '2026-04-29T12:00:00.000Z',
          },
        ],
        interests: [],
      });
      expect(mockGet).toHaveBeenCalledWith('users/user123');
      expect(mockGetOptional).toHaveBeenCalledWith('user-public-profile/user123', 500);
      expect(mockGetPath).toHaveBeenCalledWith(['users/user123', 'reputation']);
    });

    it('filters profile Q&A for GET user by visibility and known-people', async () => {
      const mockUser = {
        id: 'user123',
        stageName: 'TestUser',
        profile: [],
        reputation: {
          questionsAnswered: 5,
          talksSent: 3,
          matchesFound: 1,
          friendsCount: 10,
          mutualFriendsCount: 2,
          likedCount: 0,
          dislikedCount: 0,
          starRating: 4.0,
          reviewCount: 4,
          ageVerified: true,
          ageVerificationVotes: 8,
          blockCount: 0,
          isHidden: false,
        },
        location: { region: 'test-region', chatrooms: [] },
        languages: ['en'],
        interests: [],
        createdAt: new Date(),
        lastActive: new Date(),
      };
      const profileJson = JSON.stringify([
        {
          id: 'p1',
          question: 'Public',
          answer: 'Yes',
          isAuto: false,
          answeredAt: '2026-04-29T12:00:00.000Z',
          visibility: 'public',
        },
        {
          id: 'p2',
          question: 'Secret',
          answer: 'No',
          isAuto: false,
          answeredAt: '2026-04-29T12:00:00.000Z',
          visibility: 'private',
        },
        {
          id: 'p3',
          question: 'Friends',
          answer: 'Maybe',
          isAuto: false,
          answeredAt: '2026-04-29T12:00:00.000Z',
          visibility: 'contacts_only',
        },
      ]);
      const getSpy = jest.spyOn(gunService, 'get').mockImplementation(async (key: string) => {
        if (key === 'users/user123') return mockUser;
        return null;
      });
      const getOptionalSpy = jest.spyOn(gunService, 'getOptional').mockResolvedValue({
        languagesJson: JSON.stringify(['en']),
        profileJson,
        interestsJson: JSON.stringify([]),
      });
      let knownEntry: { userId: string; label: string; addedAt: string } | null = null;
      const pathSpy = jest.spyOn(gunService, 'getPath').mockImplementation(async (path: string[]) => {
        if (path.join('/') === 'users/user123/knownPeople/viewer9') return knownEntry;
        return null;
      });

      const stranger = await userService.getUser('user123', { viewerId: 'viewer9' });
      expect(stranger.profile.map((p) => p.id)).toEqual(['p1']);

      knownEntry = { userId: 'viewer9', label: 'friend', addedAt: '2026-01-01T00:00:00.000Z' };
      const asContact = await userService.getUser('user123', { viewerId: 'viewer9' });
      expect(asContact.profile.map((p) => p.id).sort()).toEqual(['p1', 'p3']);

      const anon = await userService.getUser('user123', { viewerId: null });
      expect(anon.profile.map((p) => p.id)).toEqual(['p1']);

      const self = await userService.getUser('user123', { viewerId: 'user123' });
      expect(self.profile.map((p) => p.id).sort()).toEqual(['p1', 'p2', 'p3']);

      getSpy.mockRestore();
      getOptionalSpy.mockRestore();
      pathSpy.mockRestore();
    });

    it('should retrieve server-enforced talk filters from the public mirror', async () => {
      const mockGet = jest.spyOn(gunService, 'get')
        .mockResolvedValueOnce({
          id: 'user123',
          languages: ['en'],
          reputation: { ageVerified: false },
        })
        .mockResolvedValueOnce({
          filtersJson: JSON.stringify({
            allowedLanguages: ['zh'],
            requireGoodGrammar: true,
            blockDirtyWords: true,
            allowedTalkTypes: ['tag'],
          }),
        });

      const filters = await userService.getUserTalkFilters('user123');

      expect(filters).toEqual({
        allowedLanguages: ['zh'],
        minDistanceMiles: 0,
        maxDistanceMiles: 50,
        requireGoodGrammar: true,
        blockDirtyWords: true,
        allowedTalkTypes: ['tag'],
        customBlockedTerms: [],
      });
      expect(mockGet).toHaveBeenCalledWith('user-talk-filters/user123');
    });

    it('should persist block mirrors and update block count when blocking and unblocking', async () => {
      const baseUser = {
        id: 'viewer',
        stageName: 'Viewer',
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
        location: { region: 'test-region', chatrooms: [] },
        languages: ['en'],
        interests: [],
        createdAt: new Date(),
        lastActive: new Date(),
      };
      const targetUser = {
        ...baseUser,
        id: 'target',
        stageName: 'Target',
      };

      let isBlocked = false;
      jest.spyOn(gunService, 'get').mockImplementation(async (key: string) => {
        switch (key) {
          case 'users/viewer':
            return baseUser;
          case 'users/target':
            return targetUser;
          case 'user-public-profile/target':
            return null;
          default:
            return null;
        }
      });
      jest.spyOn(gunService, 'getPath').mockImplementation(async (path: string[]) => {
        const key = path.join('/');
        if (key === 'user-blocks/viewer/target') {
          return isBlocked ? { blockedAt: '2026-04-30T00:00:00.000Z' } : null;
        }
        // readReputation uses getPath(['users/target', 'reputation'])
        if (key === 'users/target/reputation') {
          return { blockCount: 0, ageVerified: false, ageVerificationVotes: 0 };
        }
        return null;
      });

      const putPathSpy = jest.spyOn(gunService, 'putPath').mockImplementation(async (path: string[], value: unknown) => {
        if (path.join('/') === 'user-blocks/viewer/target') {
          isBlocked = value != null;
        }
      });

      // getBlockedUserIds now uses raw Gun map().once() — spy on it directly
      const getBlockedSpy = jest.spyOn(userService, 'getBlockedUserIds')
        .mockResolvedValueOnce(['target'])
        .mockResolvedValueOnce([]);

      const blockResult = await userService.blockUser('viewer', 'target');
      expect(blockResult.changed).toBe(true);
      expect(blockResult.blockedUserIds).toEqual(['target']);
      expect(putPathSpy).toHaveBeenCalledWith(['user-blocks', 'viewer', 'target'], expect.any(Object));
      expect(putPathSpy).toHaveBeenCalledWith(['user-blocked-by', 'target', 'viewer'], expect.any(Object));

      const unblockResult = await userService.unblockUser('viewer', 'target');
      expect(unblockResult.changed).toBe(true);
      expect(unblockResult.blockedUserIds).toEqual([]);
      expect(putPathSpy).toHaveBeenCalledWith(['user-blocks', 'viewer', 'target'], null);
      expect(putPathSpy).toHaveBeenCalledWith(['user-blocked-by', 'target', 'viewer'], null);
      expect(getBlockedSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('TalkService Integration', () => {
    it('should create and store a talk', async () => {
      const talkData = {
        title: 'Test Talk',
        authorId: 'user123',
        type: 'flow' as const,
        isAdult: false,
        language: 'en',
        questions: [
          {
            id: 'q1',
            text: 'What is your hobby?',
            answers: [
              // Flow rule: first answer is match-or-next; the rest are ignore.
              { id: 'a1', text: 'Reading.', isMatch: true, isTerminal: true },
              { id: 'a2', text: 'Sports.', isIgnore: true, isTerminal: true },
              { id: 'a_ignore', text: 'Skip.', isIgnore: true, isTerminal: true },
            ],
          },
        ],
      };

      const mockPut = jest.spyOn(gunService, 'put').mockResolvedValue(undefined);

      const talk = await talkService.createTalk(talkData);

      expect(talk).toBeDefined();
      expect(talk.title).toBe('Test Talk');
      expect(talk.id).toBeDefined();
      expect(mockPut).toHaveBeenCalled();
    });

    it('should validate talk structure before creation', async () => {
      const invalidTalkData = {
        title: 'Invalid Talk',
        authorId: 'user123',
        type: 'flow' as const,
        isAdult: false,
        language: 'en',
        questions: [
          {
            id: 'q1',
            text: 'Question with loop',
            answers: [
              { id: 'a1', text: 'Answer', nextQuestionId: 'q1' }, // Creates loop
            ],
          },
        ],
      };

      await expect(talkService.createTalk(invalidTalkData)).rejects.toThrow();
    });
  });

  describe('ReputationService Integration', () => {
    it('should update user reputation', async () => {
      const userId = 'user123';
      const action = 'question_answered';

      const mockGet = jest.spyOn(gunService, 'get').mockResolvedValue({
        questionsAnswered: 5,
        talksSent: 2,
        matchesFound: 1,
        friendsCount: 8,
        mutualFriendsCount: 1,
        likedCount: 0,
        dislikedCount: 0,
        starRating: 4.0,
        reviewCount: 3,
        ageVerified: false,
        ageVerificationVotes: 2,
        blockCount: 0,
        isHidden: false,
      });

      const mockPut = jest.spyOn(gunService, 'put').mockResolvedValue(undefined);

      await reputationService.updateUserReputation(userId, action);

      expect(mockGet).toHaveBeenCalledWith(`users/${userId}`);
      expect(mockPut).toHaveBeenCalled();
    });
  });

  describe('Cross-Service Integration', () => {
    it('should handle user creation with reputation initialization', async () => {
      const userData = {
        stageName: 'NewUser',
        languages: ['en'],
      };

      const mockUserPut = jest.spyOn(gunService, 'put').mockResolvedValue(undefined);

      const user = await userService.createUser(userData);

      expect(user.reputation).toBeDefined();
      expect(user.reputation.questionsAnswered).toBe(0);
      expect(user.reputation.talksSent).toBe(0);
      expect(user.reputation.starRating).toBe(3.0);
      expect(mockUserPut).toHaveBeenCalled();
    });

    it('should propagate reputation updates when user completes a talk', async () => {
      const userId = 'user123';

      // Mock user completion of a talk
      const mockGet = jest.spyOn(gunService, 'get').mockResolvedValueOnce({
        // User data
        id: userId,
        reputation: {
          questionsAnswered: 10,
          talksSent: 5,
          matchesFound: 2,
          friendsCount: 15,
          mutualFriendsCount: 3,
          likedCount: 0,
          dislikedCount: 0,
          starRating: 4.2,
          reviewCount: 6,
          ageVerified: true,
          ageVerificationVotes: 12,
          blockCount: 0,
          isHidden: false,
        },
      });

      const mockPut = jest.spyOn(gunService, 'put').mockResolvedValue(undefined);

      // Simulate talk completion
      await reputationService.updateUserReputation(userId, 'question_answered');

      expect(mockGet).toHaveBeenCalled();
      expect(mockPut).toHaveBeenCalled();
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle Gun database connection errors gracefully', async () => {
      jest.spyOn(gunService, 'get').mockRejectedValue(new Error('Connection failed'));

      await expect(userService.getUser('user123')).rejects.toThrow('Connection failed');
    });

    it.skip('should handle invalid data gracefully', async () => {
      const invalidUserData = {
        // Missing required stageName
        languages: ['en'],
      };

      await expect(userService.createUser(invalidUserData)).rejects.toThrow();
    }, 10000); // Increase timeout to 10 seconds
  });
});
