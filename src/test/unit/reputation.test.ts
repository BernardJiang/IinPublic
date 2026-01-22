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
      starRating: 4.2,
      reviewCount: 8,
      ageVerified: true,
      ageVerificationVotes: 15,
      blockCount: 0,
      isHidden: false
    };

    mockUser = {
      id: 'user123',
      stageName: 'TestUser',
      profile: [],
      reputation: mockReputation,
      location: {
        region: 'region_40.71_-74.00',
        chatrooms: ['room1']
      },
      languages: ['en'],
      interests: [],
      createdAt: new Date('2024-01-01'),
      lastActive: new Date()
    };
  });

  describe('calculateTrustScore', () => {
    it('should calculate trust score for normal user', () => {
      const trustScore = ReputationManager.calculateTrustScore(mockReputation);

      expect(trustScore).toBeGreaterThan(0);
      expect(trustScore).toBeLessThanOrEqual(100);
      expect(typeof trustScore).toBe('number');
    });

    it('should penalize users with blocks', () => {
      const normalReputation = { ...mockReputation };
      const blockedReputation = { ...mockReputation, blockCount: 5 };

      const normalScore = ReputationManager.calculateTrustScore(normalReputation);
      const blockedScore = ReputationManager.calculateTrustScore(blockedReputation);

      expect(blockedScore).toBeLessThan(normalScore);
    });

    it('should reward age verified users', () => {
      const unverifiedReputation = { ...mockReputation, ageVerified: false };
      const verifiedReputation = { ...mockReputation, ageVerified: true };

      const unverifiedScore = ReputationManager.calculateTrustScore(unverifiedReputation);
      const verifiedScore = ReputationManager.calculateTrustScore(verifiedReputation);

      expect(verifiedScore).toBeGreaterThan(unverifiedScore);
    });

    it('should handle edge case with all zeros', () => {
      const zeroReputation: Reputation = {
        questionsAnswered: 0,
        talksSent: 0,
        matchesFound: 0,
        friendsCount: 0,
        mutualFriendsCount: 0,
        starRating: 0,
        reviewCount: 0,
        ageVerified: false,
        ageVerificationVotes: 0,
        blockCount: 0,
        isHidden: false
      };

      const trustScore = ReputationManager.calculateTrustScore(zeroReputation);
      expect(trustScore).toBeGreaterThanOrEqual(0);
    });
  });

  describe('shouldShowProfile', () => {
    it('should show profile for users with good reputation', () => {
      const result = ReputationManager.shouldShowProfile(mockReputation, mockUser);
      expect(result).toBe(true);
    });

    it('should not show profile for users who hid it', () => {
      const hiddenReputation = { ...mockReputation, isHidden: true };
      const result = ReputationManager.shouldShowProfile(hiddenReputation, mockUser);
      expect(result).toBe(false);
    });

    it('should not show profile for heavily blocked users', () => {
      const blockedReputation = { ...mockReputation, blockCount: 50 };
      const result = ReputationManager.shouldShowProfile(blockedReputation, mockUser);
      expect(result).toBe(false);
    });
  });

  describe('filterByReputation', () => {
    it('should filter users by minimum trust score', () => {
      const users = [
        { ...mockUser, id: 'user1', reputation: { ...mockReputation, starRating: 4.8 } },
        { ...mockUser, id: 'user2', reputation: { ...mockReputation, starRating: 2.1, blockCount: 10 } },
        { ...mockUser, id: 'user3', reputation: { ...mockReputation, starRating: 4.5 } }
      ];

      const filtered = ReputationManager.filterByReputation(users, 70);

      expect(filtered.length).toBeLessThanOrEqual(users.length);
      // All filtered users should have decent trust scores
      filtered.forEach(user => {
        const trustScore = ReputationManager.calculateTrustScore(user.reputation);
        expect(trustScore).toBeGreaterThanOrEqual(70);
      });
    });

    it('should return empty array when no users meet criteria', () => {
      const badUsers = [
        { ...mockUser, id: 'user1', reputation: { ...mockReputation, blockCount: 100 } },
        { ...mockUser, id: 'user2', reputation: { ...mockReputation, blockCount: 100 } }
      ];

      const filtered = ReputationManager.filterByReputation(badUsers, 90);
      expect(filtered).toHaveLength(0);
    });
  });

  describe('getReputationLevel', () => {
    it('should return correct reputation levels', () => {
      const newUserRep = { ...mockReputation, questionsAnswered: 2, talksSent: 1 };
      expect(ReputationManager.getReputationLevel(newUserRep)).toBe('newcomer');

      const regularUserRep = { ...mockReputation, questionsAnswered: 25, talksSent: 15 };
      expect(ReputationManager.getReputationLevel(regularUserRep)).toBe('regular');

      const trustedUserRep = { ...mockReputation, questionsAnswered: 150, talksSent: 75, starRating: 4.8 };
      expect(ReputationManager.getReputationLevel(trustedUserRep)).toBe('trusted');
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

    it('should not modify original reputation object', () => {
      const originalQuestions = mockReputation.questionsAnswered;
      ReputationManager.updateReputation(mockReputation, 'question_answered');
      expect(mockReputation.questionsAnswered).toBe(originalQuestions);
    });
  });

  describe('isEligibleForMatching', () => {
    it('should allow eligible users to match', () => {
      const result = ReputationManager.isEligibleForMatching(mockReputation);
      expect(result).toBe(true);
    });

    it('should block users with too many blocks', () => {
      const blockedRep = { ...mockReputation, blockCount: 25 };
      const result = ReputationManager.isEligibleForMatching(blockedRep);
      expect(result).toBe(false);
    });

    it('should require minimum activity for matching', () => {
      const inactiveRep = { ...mockReputation, questionsAnswered: 0, talksSent: 0 };
      const result = ReputationManager.isEligibleForMatching(inactiveRep);
      expect(result).toBe(false);
    });
  });
});