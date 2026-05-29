import { ReputationManager } from '../../shared/reputation';
import { User, Reputation } from '../../shared/types';

describe('ReputationManager', () => {
  let mockUser: User;
  let mockReputation: Reputation;

  beforeEach(() => {
    mockReputation = {
      questionsAnswered: 10,
      talksSent: 5,
      matchesFound: 3,
      friendsCount: 20,
      mutualFriendsCount: 5,
      likedCount: 7,
      dislikedCount: 1,
      starRating: 4.2,
      reviewCount: 8,
      ageVerified: true,
      ageVerificationVotes: 15,
      blockCount: 0,
      isHidden: false,
    };

    mockUser = {
      id: 'user123',
      stageName: 'TestUser',
      profile: [],
      reputation: mockReputation,
      location: {
        region: 'region_40.71_-74.00',
        chatrooms: ['room1'],
      },
      languages: ['en'],
      interests: [],
      createdAt: new Date('2024-01-01'),
      lastActive: new Date(),
    };
  });

  describe('calculateReputationScore', () => {
    it('should calculate reputation score for normal user', () => {
      const score = ReputationManager.calculateReputationScore(mockReputation);

      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(100);
      expect(typeof score).toBe('number');
    });

    it('should penalize users with blocks', () => {
      const normalReputation = { ...mockReputation };
      const blockedReputation = { ...mockReputation, blockCount: 5 };

      const normalScore = ReputationManager.calculateReputationScore(normalReputation);
      const blockedScore = ReputationManager.calculateReputationScore(blockedReputation);

      expect(blockedScore).toBeLessThan(normalScore);
    });

    it('should reward age verified users', () => {
      const unverifiedReputation = { ...mockReputation, ageVerified: false };
      const verifiedReputation = { ...mockReputation, ageVerified: true };

      const unverifiedScore = ReputationManager.calculateReputationScore(unverifiedReputation);
      const verifiedScore = ReputationManager.calculateReputationScore(verifiedReputation);

      expect(verifiedScore).toBeGreaterThan(unverifiedScore);
    });

    it('should handle edge case with all zeros', () => {
      const zeroReputation: Reputation = {
        questionsAnswered: 0,
        talksSent: 0,
        matchesFound: 0,
        friendsCount: 0,
        mutualFriendsCount: 0,
        likedCount: 0,
        dislikedCount: 0,
        starRating: 0,
        reviewCount: 0,
        ageVerified: false,
        ageVerificationVotes: 0,
        blockCount: 0,
        isHidden: false,
      };

      const score = ReputationManager.calculateReputationScore(zeroReputation);
      expect(score).toBeLessThanOrEqual(0); // Should be negative due to starRating formula
    });
  });

  describe('getBulkSendCapacity', () => {
    it('should return bulk send capacity based on reputation', () => {
      const capacity = ReputationManager.getBulkSendCapacity(mockUser);

      expect(typeof capacity).toBe('number');
      expect(capacity).toBeGreaterThanOrEqual(0);
    });

    it('should return 0 for users with low reputation', () => {
      const lowRepUser = {
        ...mockUser,
        reputation: {
          ...mockReputation,
          questionsAnswered: 0,
          matchesFound: 0,
          friendsCount: 0,
          mutualFriendsCount: 0,
          starRating: 1,
          ageVerified: false,
          blockCount: 5,
        },
      };

      const capacity = ReputationManager.getBulkSendCapacity(lowRepUser);
      expect(capacity).toBe(0);
    });

    it('should increase capacity for users with high reputation', () => {
      const lowRepUser = {
        ...mockUser,
        reputation: {
          ...mockReputation,
          questionsAnswered: 5,
          matchesFound: 1,
          friendsCount: 10,
          mutualFriendsCount: 2,
          starRating: 3.5,
          ageVerified: false,
          blockCount: 0,
        },
      };

      const highRepUser = {
        ...mockUser,
        reputation: {
          ...mockReputation,
          questionsAnswered: 100,
          matchesFound: 20,
          friendsCount: 50,
          mutualFriendsCount: 15,
          starRating: 4.8,
          ageVerified: true,
          blockCount: 0,
        },
      };

      const lowCapacity = ReputationManager.getBulkSendCapacity(lowRepUser);
      const highCapacity = ReputationManager.getBulkSendCapacity(highRepUser);

      expect(highCapacity).toBeGreaterThan(lowCapacity);
    });
  });

  describe('updateReputation', () => {
    it('should increment questions answered', () => {
      const updatedRep = ReputationManager.updateReputation(mockReputation, 'question_answered');
      expect(updatedRep.questionsAnswered).toBe(mockReputation.questionsAnswered + 1);
    });

    it('should increment talks sent', () => {
      const updatedRep = ReputationManager.updateReputation(mockReputation, 'talk_sent');
      expect(updatedRep.talksSent).toBe(mockReputation.talksSent + 1);
    });

    it('should increment matches found', () => {
      const updatedRep = ReputationManager.updateReputation(mockReputation, 'match_found');
      expect(updatedRep.matchesFound).toBe(mockReputation.matchesFound + 1);
    });

    it('should increment block count', () => {
      const updatedRep = ReputationManager.updateReputation(mockReputation, 'blocked');
      expect(updatedRep.blockCount).toBe(mockReputation.blockCount + 1);
    });

    it('should increment liked and disliked counters', () => {
      const liked = ReputationManager.updateReputation(mockReputation, 'liked');
      const disliked = ReputationManager.updateReputation(mockReputation, 'disliked');
      expect(liked.likedCount).toBe(mockReputation.likedCount + 1);
      expect(disliked.dislikedCount).toBe(mockReputation.dislikedCount + 1);
    });

    it('should not modify original reputation object', () => {
      const originalQuestions = mockReputation.questionsAnswered;
      ReputationManager.updateReputation(mockReputation, 'question_answered');
      expect(mockReputation.questionsAnswered).toBe(originalQuestions);
    });
  });

  // describe('isEligibleForMatching', () => {
  //   it('should allow eligible users to match', () => {
  //     const result = ReputationManager.isEligibleForMatching(mockReputation);
  //     expect(result).toBe(true);
  //   });

  //   it('should block users with too many blocks', () => {
  //     const blockedRep = { ...mockReputation, blockCount: 25 };
  //     const result = ReputationManager.isEligibleForMatching(blockedRep);
  //     expect(result).toBe(false);
  //   });

  //   it('should require minimum activity for matching', () => {
  //     const inactiveRep = { ...mockReputation, questionsAnswered: 0, talksSent: 0 };
  //     const result = ReputationManager.isEligibleForMatching(inactiveRep);
  //     expect(result).toBe(false);
  //   });
  // });
});
