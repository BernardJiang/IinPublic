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
    opt: jest.fn().mockReturnThis()
  };
  
  return {
    __esModule: true,
    default: jest.fn(() => mockGun)
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

  describe('UserService Integration', () => {
    it('should create user and store in Gun database', async () => {
      const userData = {
        stageName: 'TestUser',
        profile: [],
        languages: ['en'],
        interests: []
      };

      // Mock Gun put method to simulate successful storage
      const mockPut = jest.spyOn(gunService, 'put').mockResolvedValue({ ok: true });

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
          starRating: 4.0,
          reviewCount: 4,
          ageVerified: true,
          ageVerificationVotes: 8,
          blockCount: 0,
          isHidden: false
        },
        location: { region: 'test-region', chatrooms: [] },
        languages: ['en'],
        interests: [],
        createdAt: new Date(),
        lastActive: new Date()
      };

      const mockGet = jest.spyOn(gunService, 'get').mockResolvedValue(mockUser);

      const retrievedUser = await userService.getUser('user123');

      expect(retrievedUser).toEqual(mockUser);
      expect(mockGet).toHaveBeenCalledWith('users/user123');
    });
  });

  describe('TalkService Integration', () => {
    it('should create and store a talk', async () => {
      const talkData = {
        title: 'Test Talk',
        authorId: 'user123',
        type: 'matching' as const,
        isAdult: false,
        language: 'en',
        questions: [
          {
            id: 'q1',
            text: 'What is your hobby?',
            answers: [
              { id: 'a1', text: 'Reading', isTerminal: true },
              { id: 'a2', text: 'Sports', isTerminal: true }
            ]
          }
        ]
      };

      const mockPut = jest.spyOn(gunService, 'put').mockResolvedValue({ ok: true });

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
        type: 'matching' as const,
        isAdult: false,
        language: 'en',
        questions: [
          {
            id: 'q1',
            text: 'Question with loop',
            answers: [
              { id: 'a1', text: 'Answer', nextQuestionId: 'q1' } // Creates loop
            ]
          }
        ]
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
        starRating: 4.0,
        reviewCount: 3,
        ageVerified: false,
        ageVerificationVotes: 2,
        blockCount: 0,
        isHidden: false
      });

      const mockPut = jest.spyOn(gunService, 'put').mockResolvedValue({ ok: true });

      await reputationService.updateUserReputation(userId, action);

      expect(mockGet).toHaveBeenCalledWith(`users/${userId}/reputation`);
      expect(mockPut).toHaveBeenCalled();
      
      // Verify that the put call includes incremented questionsAnswered
      const putCall = mockPut.mock.calls.find(call => 
        call[0] === `users/${userId}/reputation`
      );
      expect(putCall).toBeDefined();
      expect(putCall![1].questionsAnswered).toBe(6); // 5 + 1
    });
  });

  describe('Cross-Service Integration', () => {
    it('should handle user creation with reputation initialization', async () => {
      const userData = {
        stageName: 'NewUser',
        languages: ['en']
      };

      const mockUserPut = jest.spyOn(gunService, 'put').mockResolvedValue({ ok: true });

      const user = await userService.createUser(userData);

      expect(user.reputation).toBeDefined();
      expect(user.reputation.questionsAnswered).toBe(0);
      expect(user.reputation.talksSent).toBe(0);
      expect(user.reputation.starRating).toBe(3.0);
      expect(mockUserPut).toHaveBeenCalled();
    });

    it('should propagate reputation updates when user completes a talk', async () => {
      const userId = 'user123';
      const talkId = 'talk456';

      // Mock user completion of a talk
      const mockGet = jest.spyOn(gunService, 'get')
        .mockResolvedValueOnce({ // User data
          id: userId,
          reputation: {
            questionsAnswered: 10,
            talksSent: 5,
            matchesFound: 2,
            friendsCount: 15,
            mutualFriendsCount: 3,
            starRating: 4.2,
            reviewCount: 6,
            ageVerified: true,
            ageVerificationVotes: 12,
            blockCount: 0,
            isHidden: false
          }
        });

      const mockPut = jest.spyOn(gunService, 'put').mockResolvedValue({ ok: true });

      // Simulate talk completion
      await reputationService.updateUserReputation(userId, 'question_answered');

      expect(mockGet).toHaveBeenCalled();
      expect(mockPut).toHaveBeenCalled();
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle Gun database connection errors gracefully', async () => {
      const mockGet = jest.spyOn(gunService, 'get').mockRejectedValue(new Error('Connection failed'));

      await expect(userService.getUser('user123')).rejects.toThrow('Connection failed');
    });

    it('should handle invalid data gracefully', async () => {
      const invalidUserData = {
        // Missing required stageName
        languages: ['en']
      };

      await expect(userService.createUser(invalidUserData)).rejects.toThrow();
    });
  });
});