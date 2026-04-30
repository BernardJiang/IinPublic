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

      const mockGet = jest.spyOn(gunService, 'get')
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce({
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
      expect(mockGet).toHaveBeenCalledWith('user-public-profile/user123');
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
