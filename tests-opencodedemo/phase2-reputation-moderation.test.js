/**
 * Phase 2: Reputation & Moderation Tests
 * Comprehensive test suite for reputation, rate limiting, content filtering, and blocking
 */

import {
  ReputationManager,
  RateLimiter,
  ContentFilter,
  BlockManager
} from '../src/ReputationModeration';

// Mock Gun.js
const createMockGun = () => {
  const storage = {};
  
  const mockGun = {
    get: function(path) {
      if (!storage[path]) {
        storage[path] = {};
      }
      return {
        get: (subpath) => mockGun.get(`${path}/${subpath}`),
        put: (data) => {
          storage[path] = { ...storage[path], ...data };
          return mockGun.get(path);
        },
        once: (callback) => {
          setTimeout(() => callback(storage[path]), 0);
          return mockGun.get(path);
        },
        on: (callback) => {
          callback(storage[path]);
          return mockGun.get(path);
        },
        map: () => mockGun.get(path)
      };
    }
  };
  
  mockGun._storage = storage;
  return mockGun;
};

describe('Phase 2: Reputation System - Unit Tests', () => {
  let gun;
  let reputationManager;

  beforeEach(() => {
    gun = createMockGun();
    reputationManager = new ReputationManager(gun);
  });

  describe('Reputation Initialization', () => {
    test('should initialize reputation for new user', () => {
      const userId = 'user1';
      const reputation = reputationManager.initializeReputation(userId);

      expect(reputation).toBeDefined();
      expect(reputation.questionsAnswered).toBe(0);
      expect(reputation.talksSent).toBe(0);
      expect(reputation.matchesFound).toBe(0);
      expect(reputation.starRating).toBe(0);
      expect(reputation.blockCount).toBe(0);
      expect(reputation.ageVerified).toBe(false);
      expect(reputation.privacyLevel).toBe('connections');
      expect(reputation.created).toBeDefined();
    });
  });

  describe('Reputation Metrics', () => {
    test('should update reputation metric', async () => {
      const userId = 'user1';
      reputationManager.initializeReputation(userId);

      await reputationManager.updateMetric(userId, 'questionsAnswered', 10);
      const reputation = await reputationManager.getReputation(userId);

      expect(reputation.questionsAnswered).toBe(10);
    });

    test('should increment reputation metric', async () => {
      const userId = 'user1';
      reputationManager.initializeReputation(userId);

      await reputationManager.updateMetric(userId, 'questionsAnswered', 5, true);
      await reputationManager.updateMetric(userId, 'questionsAnswered', 3, true);

      const reputation = await reputationManager.getReputation(userId);
      expect(reputation.questionsAnswered).toBe(8);
    });

    test('should update multiple metrics', async () => {
      const userId = 'user1';
      reputationManager.initializeReputation(userId);

      await reputationManager.updateMetric(userId, 'questionsAnswered', 10);
      await reputationManager.updateMetric(userId, 'talksSent', 5);
      await reputationManager.updateMetric(userId, 'matchesFound', 3);

      const reputation = await reputationManager.getReputation(userId);
      expect(reputation.questionsAnswered).toBe(10);
      expect(reputation.talksSent).toBe(5);
      expect(reputation.matchesFound).toBe(3);
    });
  });

  describe('Privacy Controls', () => {
    test('should set privacy level', () => {
      const userId = 'user1';
      reputationManager.initializeReputation(userId);

      reputationManager.setPrivacyLevel(userId, 'public');
      // Privacy level would be verified through getPublicReputation
    });

    test('should reject invalid privacy level', () => {
      const userId = 'user1';

      expect(() => {
        reputationManager.setPrivacyLevel(userId, 'invalid');
      }).toThrow('Invalid privacy level: invalid');
    });

    test('should respect public privacy level', async () => {
      const userId = 'user1';
      const viewerId = 'stranger';

      reputationManager.initializeReputation(userId);
      await reputationManager.updateMetric(userId, 'questionsAnswered', 50);
      await reputationManager.updateMetric(userId, 'matchesFound', 10);
      reputationManager.setPrivacyLevel(userId, 'public');

      const publicRep = await reputationManager.getPublicReputation(userId, viewerId);

      expect(publicRep.questionsAnswered).toBeDefined();
      expect(publicRep.starRating).toBeDefined();
      expect(publicRep.matchesFound).toBeUndefined(); // Not public
    });

    test('should show all metrics to user themselves', async () => {
      const userId = 'user1';

      reputationManager.initializeReputation(userId);
      await reputationManager.updateMetric(userId, 'questionsAnswered', 50);
      await reputationManager.updateMetric(userId, 'matchesFound', 10);
      reputationManager.setPrivacyLevel(userId, 'private');

      const ownRep = await reputationManager.getPublicReputation(userId, userId);

      expect(ownRep.questionsAnswered).toBe(50);
      expect(ownRep.matchesFound).toBe(10);
    });

    test('should hide metrics for private privacy level', async () => {
      const userId = 'user1';
      const viewerId = 'user2';

      reputationManager.initializeReputation(userId);
      await reputationManager.updateMetric(userId, 'questionsAnswered', 50);
      reputationManager.setPrivacyLevel(userId, 'private');

      const publicRep = await reputationManager.getPublicReputation(userId, viewerId);

      expect(Object.keys(publicRep).length).toBe(0);
    });
  });

  describe('Block Recording', () => {
    test('should record block and update reputation', async () => {
      const userId = 'user1';
      const blockerId = 'blocker1';

      reputationManager.initializeReputation(userId);

      await reputationManager.recordBlock(userId, blockerId);

      const reputation = await reputationManager.getReputation(userId);
      expect(reputation.blockCount).toBe(1);
    });

    test('should increment block count', async () => {
      const userId = 'user1';

      reputationManager.initializeReputation(userId);

      await reputationManager.recordBlock(userId, 'blocker1');
      await reputationManager.recordBlock(userId, 'blocker2');
      await reputationManager.recordBlock(userId, 'blocker3');

      const reputation = await reputationManager.getReputation(userId);
      expect(reputation.blockCount).toBe(3);
    });
  });

  describe('Star Rating Calculation', () => {
    test('should calculate star rating based on metrics', async () => {
      const userId = 'user1';

      reputationManager.initializeReputation(userId);
      await reputationManager.updateMetric(userId, 'questionsAnswered', 100);
      await reputationManager.updateMetric(userId, 'talksSent', 50);
      await reputationManager.updateMetric(userId, 'matchesFound', 20);
      await reputationManager.updateMetric(userId, 'blockCount', 0);

      const rating = await reputationManager.calculateStarRating(userId);

      expect(rating).toBeGreaterThan(3);
      expect(rating).toBeLessThanOrEqual(5);
    });

    test('should reduce rating for blocks', async () => {
      const userId = 'user1';

      reputationManager.initializeReputation(userId);
      await reputationManager.updateMetric(userId, 'questionsAnswered', 100);
      await reputationManager.updateMetric(userId, 'talksSent', 50);
      await reputationManager.updateMetric(userId, 'matchesFound', 20);
      await reputationManager.updateMetric(userId, 'blockCount', 10);

      const rating = await reputationManager.calculateStarRating(userId);

      expect(rating).toBeLessThan(4);
    });

    test('should not allow negative rating', async () => {
      const userId = 'user1';

      reputationManager.initializeReputation(userId);
      await reputationManager.updateMetric(userId, 'blockCount', 100);

      const rating = await reputationManager.calculateStarRating(userId);

      expect(rating).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Reputation Manipulation Prevention', () => {
    test('should prevent reputation manipulation', () => {
      const attacker = 'malicious';
      const target = 'victim';

      const result = reputationManager.attemptManipulation(attacker, target);

      expect(result.success).toBe(false);
      expect(result.reason).toBe('unauthorized');
    });
  });
});

describe('Phase 2: Rate Limiting - Unit Tests', () => {
  let gun;
  let rateLimiter;

  beforeEach(() => {
    gun = createMockGun();
    rateLimiter = new RateLimiter(gun);
  });

  describe('Bulk Send Rate Limiting', () => {
    test('should allow bulk sends within limit', async () => {
      const userId = 'user1';

      expect(await rateLimiter.canSendBulk(userId)).toBe(true);

      rateLimiter.recordAction(userId, 'bulkSend');
      expect(await rateLimiter.canSendBulk(userId)).toBe(true);

      rateLimiter.recordAction(userId, 'bulkSend');
      expect(await rateLimiter.canSendBulk(userId)).toBe(true);
    });

    test('should prevent spam bulk sending', async () => {
      const userId = 'user1';

      // Record 3 bulk sends (at limit)
      for (let i = 0; i < 3; i++) {
        rateLimiter.recordAction(userId, 'bulkSend');
      }

      // Should still be allowed (exactly at limit)
      const canSend = await rateLimiter.canSendBulk(userId);
      expect(canSend).toBe(true);

      // One more should exceed limit
      rateLimiter.recordAction(userId, 'bulkSend');
      const canSendAfter = await rateLimiter.canSendBulk(userId);
      expect(canSendAfter).toBe(false);
    });
  });

  describe('Send Capacity Based on Reputation', () => {
    test('should return default capacity for new user', async () => {
      const userId = 'newuser';

      const capacity = await rateLimiter.getSendCapacity(userId);
      expect(capacity).toBe(100);
    });

    test('should reduce capacity based on block count', async () => {
      const userId = 'user1';

      // Mock reputation with blocks
      gun.get('reputation').get(userId).put({
        blockCount: 3
      });

      const capacity = await rateLimiter.getSendCapacity(userId);
      expect(capacity).toBe(700); // 1000 * (1 - 0.3)
    });

    test('should enforce minimum capacity', async () => {
      const userId = 'baduser';

      // Mock reputation with many blocks
      gun.get('reputation').get(userId).put({
        blockCount: 100
      });

      const capacity = await rateLimiter.getSendCapacity(userId);
      expect(capacity).toBeGreaterThanOrEqual(10);
    });
  });

  describe('Rate Limit Record Management', () => {
    test('should record action with timestamp', () => {
      const userId = 'user1';
      const action = 'bulkSend';

      rateLimiter.recordAction(userId, action);

      // Verify action was recorded
      const storage = gun._storage;
      expect(storage[`rate-limits/${userId}/${action}`]).toBeDefined();
    });
  });
});

describe('Phase 2: Content Filtering - Unit Tests', () => {
  let gun;
  let contentFilter;

  beforeEach(() => {
    gun = createMockGun();
    contentFilter = new ContentFilter(gun);
  });

  describe('Adult Content Detection', () => {
    test('should detect adult content by tags', () => {
      const adultTalk = {
        tags: ['adult', 'dating'],
        questions: []
      };

      expect(contentFilter.isAdultContent(adultTalk)).toBe(true);
    });

    test('should not flag non-adult content', () => {
      const normalTalk = {
        tags: ['tennis', 'sports'],
        questions: []
      };

      expect(contentFilter.isAdultContent(normalTalk)).toBe(false);
    });

    test('should be case-insensitive', () => {
      const adultTalk = {
        tags: ['ADULT', 'Dating'],
        questions: []
      };

      expect(contentFilter.isAdultContent(adultTalk)).toBe(true);
    });
  });

  describe('Age Verification', () => {
    test('should filter adult content for underage users', async () => {
      const adultTalk = {
        tags: ['adult', 'dating'],
        questions: [{ text: 'Are you 18+?', answers: ['Yes', 'No'] }]
      };

      const underageUser = { id: 'user1', age: 16 };

      const result = await contentFilter.filterTalk(adultTalk, underageUser);

      expect(result.shouldShow).toBe(false);
      expect(result.reason).toBe('age_restriction');
    });

    test('should show adult content to verified adults', async () => {
      const adultTalk = {
        tags: ['adult', 'dating'],
        questions: [{ text: 'Age verification required', answers: ['18+', 'Under 18'] }]
      };

      const adultUser = { id: 'user1', age: 21 };

      // Mock age verification
      gun.get('reputation').get('user1').put({
        ageVerified: true
      });

      const result = await contentFilter.filterTalk(adultTalk, adultUser);

      expect(result.shouldShow).toBe(true);
    });

    test('should require age verification for adult content', async () => {
      const adultTalk = {
        tags: ['adult'],
        questions: []
      };

      const unverifiedAdult = { id: 'user1', age: 25 };

      // Mock unverified reputation
      gun.get('reputation').get('user1').put({
        ageVerified: false
      });

      const result = await contentFilter.filterTalk(adultTalk, unverifiedAdult);

      expect(result.shouldShow).toBe(false);
      expect(result.reason).toBe('age_verification_required');
    });
  });

  describe('Age Calculation', () => {
    test('should calculate age correctly', () => {
      const birthdate = '2000-01-01';
      const age = contentFilter.calculateAge(birthdate);

      expect(age).toBeGreaterThanOrEqual(24);
      expect(age).toBeLessThan(30);
    });

    test('should handle birthday not yet occurred this year', () => {
      const today = new Date();
      const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      const birthdate = `${today.getFullYear() - 25}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`;

      const age = contentFilter.calculateAge(birthdate);

      // Should still be 24 if birthday hasn't occurred yet
      expect(age).toBeGreaterThanOrEqual(24);
    });
  });

  describe('Age Verification Process', () => {
    test('should verify adult age', async () => {
      const userId = 'user1';
      const verification = {
        birthdate: '1990-01-01'
      };

      const result = await contentFilter.verifyAge(userId, verification);

      expect(result).toBe(true);
    });

    test('should reject underage verification', async () => {
      const userId = 'user1';
      const verification = {
        birthdate: '2010-01-01' // Too young
      };

      const result = await contentFilter.verifyAge(userId, verification);

      expect(result).toBe(false);
    });

    test('should require birthdate', async () => {
      const userId = 'user1';
      const verification = {};

      const result = await contentFilter.verifyAge(userId, verification);

      expect(result).toBe(false);
    });
  });

  describe('Content Filtering', () => {
    test('should show normal content', async () => {
      const normalTalk = {
        tags: ['tennis', 'sports'],
        questions: []
      };

      const user = { id: 'user1', age: 25, settings: {} };

      const result = await contentFilter.filterTalk(normalTalk, user);

      expect(result.shouldShow).toBe(true);
    });
  });
});

describe('Phase 2: Block Management - Unit Tests', () => {
  let gun;
  let blockManager;

  beforeEach(() => {
    gun = createMockGun();
    blockManager = new BlockManager(gun);
  });

  describe('Block/Unblock Functionality', () => {
    test('should block a user', async () => {
      const blocker = 'user1';
      const blocked = 'user2';

      await blockManager.block(blocker, blocked);

      const canSend = await blockManager.canSend(blocked, blocker);
      expect(canSend).toBe(false);
    });

    test('should unblock a user', async () => {
      const blocker = 'user1';
      const blocked = 'user2';

      await blockManager.block(blocker, blocked);
      blockManager.unblock(blocker, blocked);

      const canSend = await blockManager.canSend(blocked, blocker);
      expect(canSend).toBe(true);
    });
  });

  describe('Sending Permissions', () => {
    test('should prevent blocked user from sending', async () => {
      const blocker = 'user1';
      const blocked = 'user2';

      await blockManager.block(blocker, blocked);

      const canSend = await blockManager.canSend(blocked, blocker);
      expect(canSend).toBe(false);
    });

    test('should allow unblocked users to send', async () => {
      const sender = 'user1';
      const recipient = 'user2';

      const canSend = await blockManager.canSend(sender, recipient);
      expect(canSend).toBe(true);
    });
  });

  describe('Profile Viewing Permissions', () => {
    test('should prevent viewing blocked user profile', async () => {
      const blocker = 'user1';
      const blocked = 'user2';

      await blockManager.block(blocker, blocked);

      const canView = await blockManager.canView(blocker, blocked);
      expect(canView).toBe(false);
    });

    test('should prevent blocked user from viewing blocker profile', async () => {
      const blocker = 'user1';
      const blocked = 'user2';

      await blockManager.block(blocker, blocked);

      const canView = await blockManager.canView(blocked, blocker);
      expect(canView).toBe(false);
    });

    test('should allow unblocked users to view profiles', async () => {
      const viewer = 'user1';
      const profile = 'user2';

      const canView = await blockManager.canView(viewer, profile);
      expect(canView).toBe(true);
    });
  });

  describe('Block List Management', () => {
    test('should get list of blocked users', async () => {
      const blocker = 'user1';

      await blockManager.block(blocker, 'user2');
      await blockManager.block(blocker, 'user3');
      await blockManager.block(blocker, 'user4');

      const blockedUsers = await blockManager.getBlockedUsers(blocker);
      expect(blockedUsers).toContain('user2');
      expect(blockedUsers).toContain('user3');
      expect(blockedUsers).toContain('user4');
    });

    test('should return empty array for no blocks', async () => {
      const userId = 'user1';

      const blockedUsers = await blockManager.getBlockedUsers(userId);
      expect(blockedUsers).toEqual([]);
    });
  });

  describe('Block Count', () => {
    test('should get count of users who blocked this user', async () => {
      const blockedUser = 'user1';

      await blockManager.block('blocker1', blockedUser);
      await blockManager.block('blocker2', blockedUser);
      await blockManager.block('blocker3', blockedUser);

      const count = await blockManager.getBlockedByCount(blockedUser);
      expect(count).toBe(3);
    });

    test('should return 0 for user with no blocks', async () => {
      const userId = 'user1';

      const count = await blockManager.getBlockedByCount(userId);
      expect(count).toBe(0);
    });
  });
});

describe('Phase 2: Integration Tests', () => {
  test('should integrate reputation and rate limiting', async () => {
    const gun = createMockGun();
    const reputationManager = new ReputationManager(gun);
    const rateLimiter = new RateLimiter(gun);

    const userId = 'spammer';

    // Initialize reputation
    reputationManager.initializeReputation(userId);

    // Simulate multiple blocks
    await reputationManager.recordBlock(userId, 'blocker1');
    await reputationManager.recordBlock(userId, 'blocker2');
    await reputationManager.recordBlock(userId, 'blocker3');

    // Check reduced capacity
    const capacity = await rateLimiter.getSendCapacity(userId);
    expect(capacity).toBeLessThan(1000);
  });

  test('should integrate blocking and reputation', async () => {
    const gun = createMockGun();
    const blockManager = new BlockManager(gun);
    const reputationManager = new ReputationManager(gun);

    const blocker = 'user1';
    const blocked = 'user2';

    reputationManager.initializeReputation(blocked);

    await blockManager.block(blocker, blocked);

    const reputation = await reputationManager.getReputation(blocked);
    expect(reputation.blockCount).toBe(1);
  });
});
