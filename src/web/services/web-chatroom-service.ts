import { GPSCoordinate } from '../../shared/types';
import { LocationPrivacy } from '../../shared/location';
import { WebGunService } from './web-gun-service';
import { CONFIG } from '../../shared/config';

export class WebChatroomService {
  private currentChatroomId?: string;
  private activeMembersUnsubscribe?: () => void;
  private membersUpdateTimeout?: NodeJS.Timeout | null; // Debounce Gun.js member updates
  private lastMembersUpdate: number = 0; // Timestamp of last member update (rate limiter)
  private readonly MIN_UPDATE_INTERVAL = 2000; // Minimum 2 seconds between member updates

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

  async joinChatroom(chatroomId: string, userId: string, stageName?: string): Promise<void> {
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

    console.log(`✅ Successfully initiated join for chatroom: ${chatroomId}`);
  }

  async leaveChatroom(chatroomId: string, userId: string): Promise<void> {
    const gun = this.gunService.getGun();
    gun.get('chatrooms').get(chatroomId).get('users').get(userId).put({
      leftAt: new Date().toISOString(),
      isActive: false,
    });
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
   * Enforce FIFO capacity limit on a chatroom
   * When capacity is reached, evict the oldest user to a smaller regional chatroom
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

              // Determine smaller regional chatroom
              const smallerChatroomId = this.getSmallerRegionalChatroom(chatroomId);

              if (smallerChatroomId) {
                console.log(
                  `📍 Moving ${oldestUser.stageName} to smaller chatroom: ${smallerChatroomId}`,
                );

                // Move user to smaller chatroom
                await this.moveUserToChatroom(
                  oldestUser.userId,
                  chatroomId,
                  smallerChatroomId,
                  oldestUser.stageName,
                );
              } else {
                console.log(
                  `⚠️  No smaller chatroom available, forcing user to leave: ${oldestUser.stageName}`,
                );
                // Just mark as inactive if no smaller room exists
                await this.leaveChatroom(chatroomId, oldestUser.userId);
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
   * Get a smaller regional chatroom ID based on the current chatroom
   * Hierarchy: Global -> Continental -> Country -> State -> City -> Neighborhood
   */
  private getSmallerRegionalChatroom(currentChatroomId: string): string | null {
    // Parse the current chatroom ID to determine its level
    // Format: region_lat_lon_room_0 or global_room_0

    if (currentChatroomId.startsWith('global')) {
      // If already at global, create continental chatrooms
      // For simplicity, we'll use hemisphere-based splits
      return `hemisphere_north_room_0`; // Could be more sophisticated
    }

    if (currentChatroomId.startsWith('hemisphere')) {
      // Move to continental level
      return `continent_na_room_0`; // North America
    }

    if (currentChatroomId.startsWith('continent')) {
      // Move to country level
      return `country_us_room_0`; // USA
    }

    if (currentChatroomId.startsWith('country')) {
      // Move to state level
      return `state_ca_room_0`; // California
    }

    if (currentChatroomId.startsWith('state')) {
      // Move to city level
      return `city_sf_room_0`; // San Francisco
    }

    if (currentChatroomId.startsWith('city')) {
      // Move to neighborhood level (smallest)
      return `neighborhood_soma_room_0`; // SoMa neighborhood
    }

    // Already at smallest level (neighborhood), or region-based chatroom
    // For region-based rooms, create sub-rooms with incrementing numbers
    const match = currentChatroomId.match(/^(.+)_room_(\d+)$/);
    if (match) {
      const baseId = match[1];
      const roomNum = parseInt(match[2], 10);
      // Create a new room in the same region
      return `${baseId}_room_${roomNum + 1}`;
    }

    return null; // No smaller chatroom available
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

    // Leave old chatroom
    await this.leaveChatroom(fromChatroomId, userId);

    // Join new chatroom
    // Note: We need to be careful not to trigger another capacity check here
    // So we'll directly add the user without calling joinChatroom
    const gun = this.gunService.getGun();
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
