import { GPSCoordinate } from '../../shared/types';
import { LocationPrivacy } from '../../shared/location';
import { WebGunService } from './web-gun-service';
import { CONFIG } from '../../shared/config';
import { getParentChatroom, findAppropriateChildChatroom } from '../../shared/location-to-chatroom';

export class WebChatroomService {
  private currentChatroomId?: string;
  private activeMembersUnsubscribe?: () => void;
  private membersUpdateTimeout?: NodeJS.Timeout | null; // Debounce Gun.js member updates
  private lastMembersUpdate: number = 0; // Timestamp of last member update (rate limiter)
  private readonly MIN_UPDATE_INTERVAL = 2000; // Minimum 2 seconds between member updates
  private memberCountSubscriptions: Map<string, () => void> = new Map(); // Track subscriptions for cleanup
  private userLocations: Map<string, GPSCoordinate> = new Map(); // Track user locations for FIFO eviction

  constructor(private gunService: WebGunService) {}

  async findOptimalChatroom(location: GPSCoordinate): Promise<string> {
    // Blur location and get the region
    const blurredLocation = LocationPrivacy.blurLocation(location);

    // Use the primary region with room_0 suffix
    // This ensures all users in the same region are in the same chatroom
    const chatroomId = `${blurredLocation.region}_room_0`;

    console.log(`🔍 Finding chatroom for region: ${blurredLocation.region} -> ${chatroomId}`);

    return chatroomId;
  }

  /**
   * Find optimal chatroom using hierarchical assignment logic
   *
   * Logic:
   * 1. New user: Always start at Global
   * 2. Re-entering user with lastChatroomId:
   *    - If last room is empty (0 users), move up to parent
   *    - If last room has capacity, rejoin it
   *    - If last room is full, will trigger FIFO in joinChatroom
   *
   * @param location User's GPS location
   * @param userId User's unique identifier
   * @param lastChatroomId Optional last chatroom from localStorage
   */
  async findOptimalChatroomHierarchical(
    location: GPSCoordinate,
    userId: string,
    lastChatroomId?: string,
  ): Promise<string> {
    console.log(`🔍 Finding optimal chatroom for user ${userId}`);
    console.log(`  Location: ${location.latitude}, ${location.longitude}`);
    console.log(`  Last chatroom: ${lastChatroomId || 'none (new user)'}`);

    // Store user location for FIFO eviction
    this.userLocations.set(userId, location);

    // If no last chatroom, start at Global
    if (!lastChatroomId) {
      console.log(`  → New user, starting at Global`);
      return CONFIG.GLOBAL_CHATROOM_ID;
    }

    // Check if last room is empty → move up to parent
    const lastRoomCount = await this.getMemberCount(lastChatroomId);
    console.log(`  Last room (${lastChatroomId}) member count: ${lastRoomCount}`);

    if (lastRoomCount === 0) {
      console.log(`  → Last room is empty, moving up to parent`);
      const parent = getParentChatroom(lastChatroomId);
      if (parent) {
        console.log(`  → Parent room: ${parent}`);
        return parent;
      } else {
        console.log(`  → No parent found, staying at Global`);
        return CONFIG.GLOBAL_CHATROOM_ID;
      }
    }

    // Last room has users, try to rejoin it
    // If it's at capacity, FIFO will be enforced in joinChatroom()
    console.log(`  → Re-entering last room: ${lastChatroomId}`);
    return lastChatroomId;
  }

  async joinChatroom(
    chatroomId: string,
    userId: string,
    stageName?: string,
    onMoved?: (newChatroomId: string) => void,
  ): Promise<void> {
    this.currentChatroomId = chatroomId;

    // Check capacity and handle FIFO eviction if enabled
    if (CONFIG.CHATROOM_ENABLE_FIFO) {
      await this.enforceCapacityLimit(chatroomId, userId);
    }

    const userData = {
      joinedAt: new Date().toISOString(),
      isActive: true,
      lastSeen: new Date().toISOString(),
      userId: userId,
      stageName: stageName || userId, // Use stageName if provided, otherwise fall back to userId
    };

    console.log(`👥 Joining chatroom: ${chatroomId} as user: ${userId}`);
    console.log(`📝 User data:`, userData);

    // Use Gun's graph structure properly
    const gun = this.gunService.getGun();

    gun
      .get('chatrooms')
      .get(chatroomId)
      .get('users')
      .get(userId)
      .put(userData, (ack: any) => {
        if (ack.err) {
          console.error(`❌ Failed to write user data to Gun.js:`, ack.err);
        } else {
          console.log(`✅ Successfully wrote user data to Gun.js for chatroom: ${chatroomId}`);
          console.log(`🔍 Gun.js write acknowledged, reading back data...`);

          // Read back to verify
          gun
            .get('chatrooms')
            .get(chatroomId)
            .get('users')
            .once((users: any) => {
              console.log(`📖 Current users in chatroom ${chatroomId}:`, users);
            });
        }
      });

    // Watch for FIFO eviction - if this user gets moved by another user joining
    this.watchForEviction(userId, chatroomId, onMoved);

    console.log(`✅ Successfully initiated join for chatroom: ${chatroomId}`);
  }

  /**
   * Watch if this user gets evicted from current chatroom by FIFO logic
   */
  private watchForEviction(
    userId: string,
    currentChatroomId: string,
    onMoved?: (newChatroomId: string) => void,
  ): void {
    const gun = this.gunService.getGun();

    // Watch for when this user gets marked as inactive in the current chatroom
    // or when they appear in a different chatroom
    gun
      .get('chatrooms')
      .get(currentChatroomId)
      .get('users')
      .get(userId)
      .on((userData: any) => {
        // If user becomes inactive in current room, they might have been moved
        if (userData && userData.isActive === false && userData.movedTo) {
          console.log(
            `🚨 FIFO Eviction detected: User moved from ${currentChatroomId} to ${userData.movedTo}`,
          );
          if (onMoved) {
            onMoved(userData.movedTo);
          }
        }
      });
  }

  async leaveChatroom(chatroomId: string, userId: string): Promise<void> {
    console.log(`🚪 Leaving chatroom: ${chatroomId} as user: ${userId}`);
    const gun = this.gunService.getGun();
    gun.get('chatrooms').get(chatroomId).get('users').get(userId).put({
      leftAt: new Date().toISOString(),
      isActive: false,
    });
    console.log(`✅ Initiated leave for chatroom: ${chatroomId}`);
  }

  async switchChatroom(userId: string, newChatroomId: string): Promise<void> {
    if (this.currentChatroomId) {
      await this.leaveChatroom(this.currentChatroomId, userId);
    }
    await this.joinChatroom(newChatroomId, userId);
  }

  async getActiveMembers(chatroomId: string): Promise<string[]> {
    try {
      const members: string[] = [];
      const gun = this.gunService.getGun();

      return new Promise((resolve) => {
        gun
          .get('chatrooms')
          .get(chatroomId)
          .get('users')
          .once((usersData: any) => {
            if (usersData) {
              for (const userId in usersData) {
                if (userId.startsWith('_')) continue; // Skip Gun.js metadata
                const memberData = usersData[userId];
                if (memberData && memberData.isActive) {
                  members.push(userId);
                }
              }
            }
            resolve(members);
          });

        // Timeout after 2 seconds
        setTimeout(() => resolve(members), 2000);
      });
    } catch (error) {
      console.error('Error getting active members:', error);
      return [];
    }
  }

  subscribeToMembers(
    chatroomId: string,
    callback: (members: Array<{ userId: string; stageName: string }>) => void,
  ): void {
    if (this.activeMembersUnsubscribe) {
      this.activeMembersUnsubscribe();
    }

    console.log(`👂 Subscribing to chatroom members: ${chatroomId}`);
    const gun = this.gunService.getGun();

    // Gun.js returns references when subscribing to a collection
    // We need to subscribe to each user individually to get the actual data
    const chatroomUsersRef = gun.get('chatrooms').get(chatroomId).get('users');

    // First, get the list of user IDs
    const off = chatroomUsersRef.map().on((memberData: any, userId: string) => {
      console.log(`📡 Received update for user ${userId}:`, memberData);

      // Skip Gun.js metadata
      if (userId.startsWith('_')) {
        console.log(`  ⏭️  Skipping Gun.js metadata key: ${userId}`);
        return;
      }

      // Now we have the actual member data, not a reference
      console.log(`  - User ${userId} data:`, memberData);
      console.log(`    stageName: ${memberData?.stageName}`);
      console.log(`    isActive: ${memberData?.isActive} (type: ${typeof memberData?.isActive})`);

      // After each update, collect all active members (rate-limited + debounced)
      // Only schedule if no timeout is already pending
      if (!this.membersUpdateTimeout) {
        const now = Date.now();
        const timeSinceLastUpdate = now - this.lastMembersUpdate;

        // If enough time has passed, schedule update immediately
        // Otherwise, schedule it for when the rate limit period expires
        const delay =
          timeSinceLastUpdate >= this.MIN_UPDATE_INTERVAL
            ? 500 // Normal debounce delay
            : this.MIN_UPDATE_INTERVAL - timeSinceLastUpdate + 500; // Wait until rate limit expires

        this.membersUpdateTimeout = setTimeout(() => {
          this.collectActiveMembers(chatroomId, callback);
          this.lastMembersUpdate = Date.now();
          this.membersUpdateTimeout = null; // Allow next update to schedule a new timeout
        }, delay);
      }
    });

    this.activeMembersUnsubscribe = () => off.off();

    // Do initial collection
    setTimeout(() => {
      this.collectActiveMembers(chatroomId, callback);
      this.lastMembersUpdate = Date.now(); // Set initial timestamp
    }, 500);
  }

  private collectActiveMembers(
    chatroomId: string,
    callback: (members: Array<{ userId: string; stageName: string }>) => void,
  ): void {
    const gun = this.gunService.getGun();
    const members: Array<{ userId: string; stageName: string }> = [];

    gun
      .get('chatrooms')
      .get(chatroomId)
      .get('users')
      .map()
      .once((memberData: any, userId: string) => {
        if (!userId.startsWith('_') && memberData && memberData.isActive === true) {
          members.push({
            userId: userId,
            stageName: memberData.stageName || userId,
          });
        }
      });

    setTimeout(() => {
      console.log(`👥 Active members collected:`, members);
      callback(members);
    }, 200);
  }

  getCurrentChatroomId(): string | undefined {
    return this.currentChatroomId;
  }

  /**
   * Get the member count for a specific chatroom (without subscribing)
   * This is useful for displaying member counts in chatroom lists
   */
  async getMemberCount(chatroomId: string): Promise<number> {
    const gun = this.gunService.getGun();

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => resolve(0), 1000);

      gun
        .get('chatrooms')
        .get(chatroomId)
        .get('users')
        .once((usersData: any) => {
          clearTimeout(timeoutId);

          if (!usersData) {
            resolve(0);
            return;
          }

          let count = 0;
          for (const userId in usersData) {
            if (userId.startsWith('_')) continue; // Skip Gun.js metadata
            const memberData = usersData[userId];
            if (memberData && memberData.isActive === true) {
              count++;
            }
          }

          resolve(count);
        });
    });
  }

  /**
   * Subscribe to member count updates for a specific chatroom
   * Calls the callback whenever the member count changes
   */
  subscribeToMemberCount(chatroomId: string, callback: (count: number) => void): void {
    // Unsubscribe from previous subscription for this chatroom if exists
    const existingUnsubscribe = this.memberCountSubscriptions.get(chatroomId);
    if (existingUnsubscribe) {
      existingUnsubscribe();
    }

    console.log(`👂 Subscribing to member count for chatroom: ${chatroomId}`);
    const gun = this.gunService.getGun();

    // Subscribe to all user changes in this chatroom
    const off = gun
      .get('chatrooms')
      .get(chatroomId)
      .get('users')
      .map()
      .on(() => {
        // When any user data changes, re-count all active members
        // Use map().once() to ensure we get the latest data for each user
        const members: { [userId: string]: any } = {};
        let pendingUsers = 0;
        let completed = false;

        gun
          .get('chatrooms')
          .get(chatroomId)
          .get('users')
          .map()
          .once((memberData: any, userId: string) => {
            // Skip Gun.js metadata
            if (userId.startsWith('_')) return;

            pendingUsers++;
            members[userId] = memberData;
          });

        // Wait for Gun.js to finish loading data (with longer timeout for reliability)
        // Increased from 100ms to 1000ms to ensure Gun.js sync completes even on slow systems
        setTimeout(() => {
          if (completed) return;
          completed = true;

          let count = 0;
          for (const userId in members) {
            const memberData = members[userId];
            if (memberData && memberData.isActive === true) {
              count++;
            }
          }

          console.log(`📊 Member count update for ${chatroomId}: ${count} members`);
          console.log(`  - ${chatroomId}: ${count} members`);
          callback(count);
        }, 1000);
      });

    // Store unsubscribe function
    this.memberCountSubscriptions.set(chatroomId, () => off.off());
  }

  /**
   * Unsubscribe from all member count subscriptions
   */
  unsubscribeAllMemberCounts(): void {
    this.memberCountSubscriptions.forEach((unsubscribe) => unsubscribe());
    this.memberCountSubscriptions.clear();
  }

  /**
   * Enforce FIFO capacity limit on a chatroom using hierarchical assignment
   * When capacity is reached, evict the oldest user DOWN the hierarchy based on their GPS location
   */
  private async enforceCapacityLimit(chatroomId: string, newUserId: string): Promise<void> {
    try {
      const gun = this.gunService.getGun();
      const capacity = CONFIG.CHATROOM_CAPACITY;

      return new Promise((resolve) => {
        // Set timeout first to prevent hanging
        const timeoutId = setTimeout(() => {
          console.log(`⏱️  Capacity check timed out for ${chatroomId}, proceeding with join`);
          resolve();
        }, 2000);

        gun
          .get('chatrooms')
          .get(chatroomId)
          .get('users')
          .once(async (usersData: any) => {
            clearTimeout(timeoutId);

            if (!usersData) {
              console.log(`📭 Chatroom ${chatroomId} is empty, no capacity check needed`);
              resolve();
              return;
            }

            // Count active users (excluding the new user who hasn't joined yet)
            const activeUsers: Array<{ userId: string; joinedAt: string; stageName: string }> = [];

            for (const userId in usersData) {
              if (userId.startsWith('_')) continue; // Skip Gun.js metadata
              const memberData = usersData[userId];

              if (memberData && memberData.isActive === true && userId !== newUserId) {
                activeUsers.push({
                  userId: userId,
                  joinedAt: memberData.joinedAt,
                  stageName: memberData.stageName || userId,
                });
              }
            }

            console.log(
              `📊 Chatroom ${chatroomId} capacity check: ${activeUsers.length}/${capacity} users`,
            );

            // If chatroom is at capacity, evict the oldest user
            if (activeUsers.length >= capacity) {
              // Sort by joinedAt to find the oldest user (FIFO)
              activeUsers.sort((a, b) => {
                const dateA = new Date(a.joinedAt).getTime();
                const dateB = new Date(b.joinedAt).getTime();
                return dateA - dateB;
              });

              const oldestUser = activeUsers[0];
              console.log(`🚪 FIFO Eviction: Chatroom is full (${activeUsers.length}/${capacity})`);
              console.log(
                `👤 Evicting oldest user: ${oldestUser.stageName} (joined: ${oldestUser.joinedAt})`,
              );

              // Get the oldest user's location
              const oldestUserLocation = this.userLocations.get(oldestUser.userId);

              if (!oldestUserLocation) {
                console.log(
                  `⚠️  No location found for user ${oldestUser.stageName}, cannot determine child chatroom`,
                );
                resolve();
                return;
              }

              // Find appropriate child chatroom based on user's location
              const childChatroomId = findAppropriateChildChatroom(chatroomId, oldestUserLocation);

              if (childChatroomId) {
                console.log(
                  `📍 Moving ${oldestUser.stageName} to child chatroom: ${childChatroomId}`,
                );

                // Move user to child chatroom
                await this.moveUserToChatroom(
                  oldestUser.userId,
                  chatroomId,
                  childChatroomId,
                  oldestUser.stageName,
                );
              } else {
                console.log(
                  `⚠️  Already at most specific chatroom level, cannot evict ${oldestUser.stageName}`,
                );
                // At the leaf node, we can't go further down
                // In production, might want to create dynamic sub-rooms or just reject new user
                console.log(`  → Allowing join anyway (at leaf level)`);
              }
            }

            resolve();
          });
      });
    } catch (error) {
      console.error(`❌ Error enforcing capacity limit:`, error);
      // Don't block the join on capacity check errors
      return Promise.resolve();
    }
  }

  /**
   * Move a user from one chatroom to another
   */
  private async moveUserToChatroom(
    userId: string,
    fromChatroomId: string,
    toChatroomId: string,
    stageName: string,
  ): Promise<void> {
    console.log(`🔄 Moving user ${stageName} from ${fromChatroomId} to ${toChatroomId}`);

    const gun = this.gunService.getGun();

    // First, mark user as inactive in old chatroom and add movedTo field
    gun.get('chatrooms').get(fromChatroomId).get('users').get(userId).put({
      isActive: false,
      leftAt: new Date().toISOString(),
      movedTo: toChatroomId, // Signal to client they've been moved
    });

    // Then add user to new chatroom
    const userData = {
      joinedAt: new Date().toISOString(),
      isActive: true,
      lastSeen: new Date().toISOString(),
      userId: userId,
      stageName: stageName,
      movedFrom: fromChatroomId, // Track where they came from
    };

    gun.get('chatrooms').get(toChatroomId).get('users').get(userId).put(userData);

    console.log(`✅ User ${stageName} successfully moved to ${toChatroomId}`);
  }
}
