/**
 * Reputation and Moderation System
 * Implements permission-based reputation, rate limiting, age verification,
 * and block/unblock functionality for the IinPublic platform
 */

/**
 * Reputation Manager
 * Handles user reputation metrics with privacy controls
 */
class ReputationManager {
  constructor(gun) {
    this.gun = gun;
  }

  /**
   * Initialize reputation for a new user
   * @param {String} userId
   * @returns {Object} Initial reputation data
   */
  initializeReputation(userId) {
    const initialReputation = {
      questionsAnswered: 0,
      talksSent: 0,
      matchesFound: 0,
      starRating: 0,
      blockCount: 0,
      ageVerified: false,
      created: Date.now(),
      privacyLevel: 'connections' // public, connections, private, hidden
    };

    this.gun.get('reputation').get(userId).put(initialReputation);
    return initialReputation;
  }

  /**
   * Update a specific reputation metric
   * @param {String} userId
   * @param {String} metric
   * @param {Number} value - New value or increment
   * @param {Boolean} increment - If true, add to existing value
   */
  async updateMetric(userId, metric, value, increment = false) {
    const reputationPath = this.gun.get('reputation').get(userId);
    
    if (increment) {
      return new Promise((resolve) => {
        reputationPath.get(metric).once((currentValue) => {
          const newValue = (currentValue || 0) + value;
          reputationPath.get(metric).put(newValue);
          resolve(newValue);
        });
      });
    } else {
      reputationPath.get(metric).put(value);
      return value;
    }
  }

  /**
   * Get user reputation
   * @param {String} userId
   * @returns {Promise<Object>} Reputation data
   */
  async getReputation(userId) {
    return new Promise((resolve) => {
      this.gun.get('reputation').get(userId).once((data) => {
        resolve(data || this.initializeReputation(userId));
      });
    });
  }

  /**
   * Get public reputation based on privacy settings
   * @param {String} userId - User whose reputation to view
   * @param {String} viewerId - User viewing the reputation
   * @returns {Promise<Object>} Filtered reputation data
   */
  async getPublicReputation(userId, viewerId) {
    const reputation = await this.getReputation(userId);
    const privacyLevel = reputation.privacyLevel || 'connections';
    
    // Check if viewer is in user's connections
    const isConnection = await this.isConnection(userId, viewerId);
    
    // Define what metrics are visible at each privacy level
    const visibilityLevels = {
      public: ['questionsAnswered', 'starRating', 'ageVerified'],
      connections: ['questionsAnswered', 'starRating', 'matchesFound', 'talksSent', 'ageVerified'],
      private: [],
      hidden: []
    };
    
    // Determine which fields to show
    let visibleFields = [];
    
    if (privacyLevel === 'public') {
      visibleFields = visibilityLevels.public;
    } else if (privacyLevel === 'connections' && (isConnection || viewerId === userId)) {
      visibleFields = visibilityLevels.connections;
    } else if (viewerId === userId) {
      // User viewing their own reputation
      return reputation;
    } else {
      visibleFields = visibilityLevels.hidden;
    }
    
    // Filter reputation data
    const filteredReputation = {};
    visibleFields.forEach(field => {
      if (reputation[field] !== undefined) {
        filteredReputation[field] = reputation[field];
      }
    });
    
    return filteredReputation;
  }

  /**
   * Set privacy level for reputation data
   * @param {String} userId
   * @param {String} level - 'public', 'connections', 'private', 'hidden'
   */
  setPrivacyLevel(userId, level) {
    const validLevels = ['public', 'connections', 'private', 'hidden'];
    if (!validLevels.includes(level)) {
      throw new Error(`Invalid privacy level: ${level}`);
    }
    
    this.gun.get('reputation').get(userId).get('privacyLevel').put(level);
  }

  /**
   * Check if two users are connected
   * @param {String} userId1
   * @param {String} userId2
   * @returns {Promise<Boolean>}
   */
  async isConnection(userId1, userId2) {
    return new Promise((resolve) => {
      this.gun.get('connections')
        .get(userId1)
        .get(userId2)
        .once((data) => {
          resolve(!!data);
        });
    });
  }

  /**
   * Record a block against a user (impacts reputation)
   * @param {String} userId - User being blocked
   * @param {String} blockerId - User doing the blocking
   */
  async recordBlock(userId, blockerId) {
    await this.updateMetric(userId, 'blockCount', 1, true);
    
    // Store block record
    this.gun.get('blocks')
      .get(userId)
      .get('blocked-by')
      .get(blockerId)
      .put(Date.now());
  }

  /**
   * Calculate star rating based on reputation metrics
   * @param {String} userId
   * @returns {Promise<Number>} Star rating (0-5)
   */
  async calculateStarRating(userId) {
    const reputation = await this.getReputation(userId);
    
    // Rating algorithm
    const questionsWeight = 0.3;
    const talksWeight = 0.2;
    const matchesWeight = 0.3;
    const blocksWeight = -0.2;
    
    const questionsScore = Math.min(reputation.questionsAnswered / 100, 1);
    const talksScore = Math.min(reputation.talksSent / 50, 1);
    const matchesScore = Math.min(reputation.matchesFound / 20, 1);
    const blocksScore = Math.max(1 - (reputation.blockCount / 10), 0);
    
    const rating = (
      questionsScore * questionsWeight +
      talksScore * talksWeight +
      matchesScore * matchesWeight +
      blocksScore * blocksWeight
    ) * 5;
    
    const starRating = Math.max(0, Math.min(5, rating));
    
    // Update stored rating
    await this.updateMetric(userId, 'starRating', starRating);
    
    return starRating;
  }

  /**
   * Prevent reputation manipulation attempts
   * @param {String} attackerId
   * @param {String} targetId
   * @returns {Object} {success: Boolean, reason: String}
   */
  attemptManipulation(attackerId, targetId) {
    // In a real system, this would detect and prevent manipulation
    // For now, we just return unauthorized
    return {
      success: false,
      reason: 'unauthorized'
    };
  }
}

/**
 * Rate Limiter
 * Prevents spam and abuse with progressive penalties
 */
class RateLimiter {
  constructor(gun) {
    this.gun = gun;
    this.limits = {
      bulkSend: { count: 3, window: 3600000 }, // 3 per hour
      messages: { count: 100, window: 3600000 }, // 100 per hour
      talkCreation: { count: 10, window: 3600000 } // 10 per hour
    };
  }

  /**
   * Check if user can perform bulk send
   * @param {String} userId
   * @returns {Promise<Boolean>}
   */
  async canSendBulk(userId) {
    return this.checkLimit(userId, 'bulkSend');
  }

  /**
   * Check if user can send message
   * @param {String} userId
   * @returns {Promise<Boolean>}
   */
  async canSendMessage(userId) {
    return this.checkLimit(userId, 'messages');
  }

  /**
   * Check if user can create talk
   * @param {String} userId
   * @returns {Promise<Boolean>}
   */
  async canCreateTalk(userId) {
    return this.checkLimit(userId, 'talkCreation');
  }

  /**
   * Generic rate limit checker
   * @param {String} userId
   * @param {String} action
   * @returns {Promise<Boolean>}
   */
  async checkLimit(userId, action) {
    const limit = this.limits[action];
    if (!limit) return true;
    
    return new Promise((resolve) => {
      const now = Date.now();
      const windowStart = now - limit.window;
      
      this.gun.get('rate-limits')
        .get(userId)
        .get(action)
        .once((data) => {
          if (!data) {
            resolve(true);
            return;
          }
          
          // Filter actions within current window
          const recentActions = Object.values(data)
            .filter(timestamp => timestamp > windowStart && typeof timestamp === 'number')
            .length;
          
          resolve(recentActions < limit.count);
        });
    });
  }

  /**
   * Record an action for rate limiting
   * @param {String} userId
   * @param {String} action
   */
  recordAction(userId, action) {
    const timestamp = Date.now();
    this.gun.get('rate-limits')
      .get(userId)
      .get(action)
      .get(timestamp.toString())
      .put(timestamp);
  }

  /**
   * Get send capacity based on reputation
   * @param {String} userId
   * @returns {Promise<Number>} Number of users that can be targeted
   */
  async getSendCapacity(userId) {
    return new Promise((resolve) => {
      this.gun.get('reputation').get(userId).once((reputation) => {
        if (!reputation) {
          resolve(100); // Default capacity
          return;
        }
        
        const blockCount = reputation.blockCount || 0;
        
        // Progressive penalty: reduce capacity by 10% per block
        const penaltyFactor = Math.max(0, 1 - (blockCount * 0.1));
        const capacity = Math.floor(1000 * penaltyFactor);
        
        resolve(Math.max(10, capacity)); // Minimum 10
      });
    });
  }

  /**
   * Clean up old rate limit records
   * @param {String} userId
   */
  async cleanupOldRecords(userId) {
    const now = Date.now();
    const maxWindow = Math.max(...Object.values(this.limits).map(l => l.window));
    const cutoff = now - maxWindow;
    
    return new Promise((resolve) => {
      this.gun.get('rate-limits')
        .get(userId)
        .once((actions) => {
          if (!actions) {
            resolve();
            return;
          }
          
          Object.keys(actions).forEach(action => {
            if (actions[action] && typeof actions[action] === 'object') {
              Object.keys(actions[action]).forEach(timestamp => {
                if (parseInt(timestamp) < cutoff) {
                  this.gun.get('rate-limits')
                    .get(userId)
                    .get(action)
                    .get(timestamp)
                    .put(null); // Delete old record
                }
              });
            }
          });
          
          resolve();
        });
    });
  }
}

/**
 * Content Filter
 * Age verification and content filtering
 */
class ContentFilter {
  constructor(gun) {
    this.gun = gun;
    this.adultTags = ['adult', 'dating', '18+', 'nsfw', 'mature'];
    this.dirtyWords = []; // Would be loaded from configuration
  }

  /**
   * Filter talk based on user settings and age
   * @param {Object} talk
   * @param {Object} user
   * @returns {Object} {shouldShow: Boolean, reason: String}
   */
  async filterTalk(talk, user) {
    // Age verification check
    if (this.isAdultContent(talk)) {
      if (!user.age || user.age < 18) {
        return {
          shouldShow: false,
          reason: 'age_restriction'
        };
      }
      
      // Check if user is age verified
      const reputation = await new ReputationManager(this.gun).getReputation(user.id);
      if (!reputation.ageVerified) {
        return {
          shouldShow: false,
          reason: 'age_verification_required'
        };
      }
    }
    
    // Dirty words filter
    if (user.settings?.filters?.dirtyWords && this.containsDirtyWords(talk)) {
      return {
        shouldShow: false,
        reason: 'content_filter'
      };
    }
    
    // Language filter
    if (user.settings?.languageFilters && !this.matchesLanguage(talk, user.settings.languageFilters)) {
      return {
        shouldShow: false,
        reason: 'language_filter'
      };
    }
    
    return { shouldShow: true };
  }

  /**
   * Check if talk contains adult content
   * @param {Object} talk
   * @returns {Boolean}
   */
  isAdultContent(talk) {
    const tags = talk.tags || [];
    return tags.some(tag => 
      this.adultTags.includes(tag.toLowerCase())
    );
  }

  /**
   * Check if talk contains dirty words
   * @param {Object} talk
   * @returns {Boolean}
   */
  containsDirtyWords(talk) {
    const text = this.getTalkText(talk).toLowerCase();
    return this.dirtyWords.some(word => text.includes(word));
  }

  /**
   * Extract all text from talk
   * @param {Object} talk
   * @returns {String}
   */
  getTalkText(talk) {
    let text = '';
    if (talk.questions) {
      talk.questions.forEach(q => {
        text += q.text + ' ';
        if (q.answers) {
          text += q.answers.join(' ') + ' ';
        }
      });
    }
    return text;
  }

  /**
   * Check if talk matches user's language filters
   * @param {Object} talk
   * @param {Array} languages
   * @returns {Boolean}
   */
  matchesLanguage(talk, languages) {
    // Simple check - would use language detection in production
    return true;
  }

  /**
   * Verify user's age
   * @param {String} userId
   * @param {Object} verification - Age verification data
   * @returns {Promise<Boolean>}
   */
  async verifyAge(userId, verification) {
    // In production, this would integrate with ID verification service
    // For now, we just mark as verified
    
    if (!verification || !verification.birthdate) {
      return false;
    }
    
    const age = this.calculateAge(verification.birthdate);
    
    if (age >= 18) {
      // Update reputation
      const reputationManager = new ReputationManager(this.gun);
      await reputationManager.updateMetric(userId, 'ageVerified', true);
      
      // Store verification record
      this.gun.get('age-verification')
        .get(userId)
        .put({
          verified: true,
          timestamp: Date.now(),
          age: age
        });
      
      return true;
    }
    
    return false;
  }

  /**
   * Calculate age from birthdate
   * @param {String} birthdate - ISO date string
   * @returns {Number}
   */
  calculateAge(birthdate) {
    const today = new Date();
    const birth = new Date(birthdate);
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    
    return age;
  }
}

/**
 * Block Manager
 * Handles user blocking and unblocking
 */
class BlockManager {
  constructor(gun) {
    this.gun = gun;
  }

  /**
   * Block a user
   * @param {String} blockerId - User doing the blocking
   * @param {String} blockedId - User being blocked
   */
  async block(blockerId, blockedId) {
    // Record block
    this.gun.get('blocks')
      .get(blockerId)
      .get('blocked')
      .get(blockedId)
      .put(Date.now());
    
    // Update reputation
    const reputationManager = new ReputationManager(this.gun);
    await reputationManager.recordBlock(blockedId, blockerId);
  }

  /**
   * Unblock a user
   * @param {String} blockerId
   * @param {String} blockedId
   */
  unblock(blockerId, blockedId) {
    this.gun.get('blocks')
      .get(blockerId)
      .get('blocked')
      .get(blockedId)
      .put(null); // Remove block
  }

  /**
   * Check if user can send to another user
   * @param {String} senderId
   * @param {String} recipientId
   * @returns {Promise<Boolean>}
   */
  async canSend(senderId, recipientId) {
    return new Promise((resolve) => {
      // Check if sender is blocked by recipient
      this.gun.get('blocks')
        .get(recipientId)
        .get('blocked')
        .get(senderId)
        .once((blockTimestamp) => {
          resolve(!blockTimestamp);
        });
    });
  }

  /**
   * Check if user can view another user's profile
   * @param {String} viewerId
   * @param {String} profileId
   * @returns {Promise<Boolean>}
   */
  async canView(viewerId, profileId) {
    return new Promise((resolve) => {
      // Check if either user has blocked the other
      this.gun.get('blocks')
        .get(viewerId)
        .get('blocked')
        .get(profileId)
        .once((viewerBlockedProfile) => {
          if (viewerBlockedProfile) {
            resolve(false);
            return;
          }
          
          this.gun.get('blocks')
            .get(profileId)
            .get('blocked')
            .get(viewerId)
            .once((profileBlockedViewer) => {
              resolve(!profileBlockedViewer);
            });
        });
    });
  }

  /**
   * Get list of blocked users
   * @param {String} userId
   * @returns {Promise<Array>}
   */
  async getBlockedUsers(userId) {
    return new Promise((resolve) => {
      this.gun.get('blocks')
        .get(userId)
        .get('blocked')
        .once((blocks) => {
          if (!blocks) {
            resolve([]);
            return;
          }
          
          const blockedIds = Object.keys(blocks)
            .filter(key => blocks[key] && typeof blocks[key] === 'number');
          
          resolve(blockedIds);
        });
    });
  }

  /**
   * Get count of users who blocked this user
   * @param {String} userId
   * @returns {Promise<Number>}
   */
  async getBlockedByCount(userId) {
    return new Promise((resolve) => {
      this.gun.get('blocks')
        .get(userId)
        .get('blocked-by')
        .once((blocks) => {
          if (!blocks) {
            resolve(0);
            return;
          }
          
          const count = Object.keys(blocks)
            .filter(key => blocks[key] && typeof blocks[key] === 'number')
            .length;
          
          resolve(count);
        });
    });
  }
}

// Export classes
export {
  ReputationManager,
  RateLimiter,
  ContentFilter,
  BlockManager
};
