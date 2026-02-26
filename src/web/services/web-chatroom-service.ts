import { GPSCoordinate } from '../../shared/types';
import { LocationPrivacy } from '../../shared/location';
import { WebGunService } from './web-gun-service';
import { CONFIG } from '../../shared/config';
import { findAppropriateChildChatroom } from '../../shared/location-to-chatroom';

export class WebChatroomService {
  private currentChatroomId?: string;
  private activeMembersUnsubscribe?: () => void;
  private evictionWatcherUnsubscribe?: () => void; // Unsubscribe from eviction watcher
  private memberCountSubscriptions: Map<string, () => void> = new Map(); // Track subscriptions for cleanup
  private userLocations: Map<string, GPSCoordinate> = new Map(); // Track user locations for FIFO eviction
  private currentSubscribedChatroomId?: string; // Track which chatroom is currently subscribed to prevent stale callbacks

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
   * Find the optimal chatroom for a user based on location and last chatroom
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

    // Re-entering user: always rejoin last room (even if empty)
    // This preserves the user's room assignment, especially important for evicted users
    const lastRoomCount = await this.getMemberCount(lastChatroomId);
    console.log(`  Last room (${lastChatroomId}) member count: ${lastRoomCount}`);
    console.log(`  → Re-entering last room: ${lastChatroomId}`);

    // If it's at capacity, FIFO will be enforced in joinChatroom()
    return lastChatroomId;
  }

  async joinChatroom(
    chatroomId: string,
    userId: string,
    stageName?: string,
    onMoved?: (newChatroomId: string) => void,
  ): Promise<void> {
    // Unsubscribe from previous room if switching
    if (this.currentChatroomId && this.currentChatroomId !== chatroomId) {
      const unsubscribe = this.memberCountSubscriptions.get(this.currentChatroomId);
      if (unsubscribe) {
        unsubscribe();
        this.memberCountSubscriptions.delete(this.currentChatroomId);
      }
    }

    this.currentChatroomId = chatroomId;

    // Get user's location from the local map
    const userLocation = this.userLocations.get(userId);
    console.log(`🗺️  User location from Map:`, userLocation);

    const userData: any = {
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

    // Write user to database and wait for completion (with retry logic)
    const writeUserWithRetry = async (maxRetries: number = 3): Promise<void> => {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          await new Promise<void>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
              reject(new Error('User data write timeout'));
            }, 3000); // 3 second timeout per attempt

            gun
              .get('chatrooms')
              .get(chatroomId)
              .get('users')
              .get(userId)
              .put(userData, (ack: any) => {
                clearTimeout(timeoutId);
                if (ack.err) {
                  console.error(
                    `❌ [Attempt ${attempt}/${maxRetries}] Failed to write user data:`,
                    ack.err,
                  );
                  reject(new Error(ack.err));
                } else {
                  console.log(
                    `✅ Successfully wrote user data to Gun.js for chatroom: ${chatroomId}`,
                  );
                  resolve();
                }
              });
          });

          // Success! Return
          return;
        } catch (error) {
          if (attempt === maxRetries) {
            // Final attempt failed - throw error (this is critical data)
            throw new Error(`Failed to write user data after ${maxRetries} attempts: ${error}`);
          } else {
            // Wait before retry (exponential backoff)
            const delayMs = attempt * 500;
            console.log(`   Retrying user data write in ${delayMs}ms...`);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
        }
      }
    };

    await writeUserWithRetry();

    // Store location in a dedicated path for reliable retrieval
    // This is non-blocking - if it fails, we still allow the user to join
    if (userLocation) {
      console.log(`📍 Storing location in dedicated path for user ${userId}`);

      // Helper function to attempt location write with retry
      const writeLocationWithRetry = async (maxRetries: number = 3): Promise<void> => {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            await new Promise<void>((resolve, reject) => {
              const timeoutId = setTimeout(() => {
                reject(new Error('Location write timeout'));
              }, 2000); // 2 second timeout per attempt

              gun
                .get('chatrooms')
                .get(chatroomId)
                .get('locations')
                .get(userId)
                .put(
                  {
                    latitude: userLocation.latitude,
                    longitude: userLocation.longitude,
                    accuracy: userLocation.accuracy,
                    timestamp: userLocation.timestamp.toISOString(),
                  },
                  (ack: any) => {
                    clearTimeout(timeoutId);
                    if (ack.err) {
                      console.error(
                        `❌ [Attempt ${attempt}/${maxRetries}] Failed to write location:`,
                        ack.err,
                      );
                      reject(new Error(ack.err));
                    } else {
                      console.log(`✅ Successfully wrote location for user ${userId}`);
                      resolve();
                    }
                  },
                );
            });

            // Success! Break out of retry loop
            return;
          } catch (error) {
            if (attempt === maxRetries) {
              // Final attempt failed - log warning but don't throw
              console.warn(
                `⚠️  Location write failed after ${maxRetries} attempts. Continuing without location storage.`,
              );
              console.warn(`   This may affect FIFO eviction routing for user ${userId}`);
            } else {
              // Wait before retry (exponential backoff)
              const delayMs = attempt * 500;
              console.log(`   Retrying in ${delayMs}ms...`);
              await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
          }
        }
      };

      // Fire and don't wait - make it non-blocking
      writeLocationWithRetry().catch((err) => {
        console.warn(`⚠️  Background location write encountered error:`, err);
      });

      // Give it a brief moment to complete (but don't block on it)
      await new Promise((resolve) => setTimeout(resolve, 100));
    } else {
      console.log(`⚠️  No location in Map for user ${userId}`);
    }

    // Wait for Gun.js to propagate the write to all peers
    // This is critical for FIFO eviction to see the correct user count
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Check capacity and handle FIFO eviction AFTER adding the user
    if (CONFIG.CHATROOM_ENABLE_FIFO) {
      await this.enforceCapacityLimitAfterJoin(chatroomId, userId);
    }

    // Watch for FIFO eviction - if this user gets moved by another user joining
    this.watchForEviction(userId, chatroomId, onMoved);

    console.log(`✅ Successfully joined chatroom: ${chatroomId}`);
  }

  /**
   * Watch if this user gets evicted from current chatroom by FIFO logic
   */
  private watchForEviction(
    userId: string,
    currentChatroomId: string,
    onMoved?: (newChatroomId: string) => void,
  ): void {
    // Unsubscribe from previous eviction watcher if it exists
    if (this.evictionWatcherUnsubscribe) {
      this.evictionWatcherUnsubscribe();
      delete this.evictionWatcherUnsubscribe;
    }

    const gun = this.gunService.getGun();

    // Watch for when this user gets marked as inactive in the current chatroom
    // or when they appear in a different chatroom
    const off = gun
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

          // Unsubscribe from this watcher now that eviction happened
          if (this.evictionWatcherUnsubscribe) {
            this.evictionWatcherUnsubscribe();
            delete this.evictionWatcherUnsubscribe;
          }

          if (onMoved) {
            onMoved(userData.movedTo);
          }
        }
      });

    // Store unsubscribe function
    this.evictionWatcherUnsubscribe = () => off.off();
  }

  /**
   * Set up eviction watcher for a chatroom (public method for use after manual room switches)
   */
  setupEvictionWatcher(
    userId: string,
    chatroomId: string,
    onMoved?: (newChatroomId: string) => void,
  ): void {
    // Clean up any existing eviction watcher before setting up a new one
    if (this.evictionWatcherUnsubscribe) {
      console.log('🧹 Cleaning up previous eviction watcher before setting up new one');
      this.evictionWatcherUnsubscribe();
      delete this.evictionWatcherUnsubscribe;
    }

    this.watchForEviction(userId, chatroomId, onMoved);
  }

  async leaveChatroom(chatroomId: string, userId: string): Promise<void> {
    console.log(`🚪 Leaving chatroom: ${chatroomId} as user: ${userId}`);

    // Unsubscribe from member count for this room
    const unsubscribe = this.memberCountSubscriptions.get(chatroomId);
    if (unsubscribe) {
      unsubscribe();
      this.memberCountSubscriptions.delete(chatroomId);
    }

    const gun = this.gunService.getGun();
    gun.get('chatrooms').get(chatroomId).get('users').get(userId).put({
      leftAt: new Date().toISOString(),
      isActive: false,
    });
    console.log(`✅ Initiated leave for chatroom: ${chatroomId}`);
  }

  async switchChatroom(userId: string, newChatroomId: string, stageName?: string): Promise<void> {
    if (this.currentChatroomId) {
      await this.leaveChatroom(this.currentChatroomId, userId);
    }
    await this.joinChatroom(newChatroomId, userId, stageName);
    this.subscribeToMemberCount(newChatroomId, () => {});
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
    this.currentSubscribedChatroomId = chatroomId;

    const gun = this.gunService.getGun();
    const activeMembers = new Map<string, { userId: string; stageName: string }>();
    let updateTimeout: NodeJS.Timeout | null = null;

    const off = gun
      .get('chatrooms')
      .get(chatroomId)
      .get('users')
      .map()
      .on((memberData: any, userId: string) => {
        if (userId.startsWith('_')) return;

        if (memberData && memberData.isActive === true) {
          activeMembers.set(userId, { userId, stageName: memberData.stageName || userId });
        } else {
          activeMembers.delete(userId);
        }

        if (updateTimeout) clearTimeout(updateTimeout);
        updateTimeout = setTimeout(() => {
          if (chatroomId === this.currentSubscribedChatroomId) {
            const membersArray = Array.from(activeMembers.values());
            callback(membersArray);
          }
        }, 150); // 150ms debounce
      });

    this.activeMembersUnsubscribe = () => off.off();
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

    // Track active members for this chatroom
    const activeMembers = new Map<string, any>();
    let updateTimeout: NodeJS.Timeout | null = null;

    // Subscribe to each individual user's data using map().on()
    const off = gun
      .get('chatrooms')
      .get(chatroomId)
      .get('users')
      .map()
      .on((memberData: any, userId: string) => {
        // Skip Gun.js metadata
        if (userId.startsWith('_')) return;

        // Update our tracking map
        activeMembers.set(userId, memberData);

        // Debounce the count update to avoid excessive recalculations
        if (updateTimeout) clearTimeout(updateTimeout);
        updateTimeout = setTimeout(() => {
          let count = 0;
          for (const [, data] of activeMembers) {
            if (data && data.isActive === true) {
              count++;
            }
          }

          console.log(`📊 Member count update for ${chatroomId}: ${count} members`);
          callback(count);
        }, 100); // 100ms debounce
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
   * Enforce capacity limit AFTER a user has joined
   * When capacity is exceeded, evict the oldest user DOWN the hierarchy based on their GPS location
   * Note: This is called AFTER the new user has been added to the database
   */
  private async enforceCapacityLimitAfterJoin(
    chatroomId: string,
    newUserId: string,
  ): Promise<void> {
    try {
      const gun = this.gunService.getGun();
      const capacity = CONFIG.CHATROOM_CAPACITY;

      return new Promise((resolve) => {
        const self = this; // Capture 'this' for use in callbacks

        const activeUsers: Array<{
          userId: string;
          joinedAt: string;
          stageName: string;
        }> = [];

        gun
          .get('chatrooms')
          .get(chatroomId)
          .get('users')
          .map()
          .once((memberData: any, userId: string) => {
            if (memberData && memberData.isActive === true) {
              activeUsers.push({
                userId: userId,
                joinedAt: memberData.joinedAt,
                stageName: memberData.stageName || userId,
              });
            }
          });

        setTimeout(() => {
          checkCapacityAndEvict();
        }, 1500); // Increased timeout to allow Gun.js to sync

        let capacityChecked = false;
        function checkCapacityAndEvict() {
          if (capacityChecked) {
            console.log(`⏭️  Capacity already checked, skipping duplicate check`);
            return;
          }
          capacityChecked = true;

          console.log(
            `📊 Chatroom ${chatroomId} capacity check: ${activeUsers.length}/${capacity} users (including new user ${newUserId})`,
          );

          if (activeUsers.length > capacity) {
            activeUsers.sort((a, b) => {
              const dateA = new Date(a.joinedAt).getTime();
              const dateB = new Date(b.joinedAt).getTime();
              return dateA - dateB;
            });

            const oldestUser = activeUsers.find((user) => user.userId !== newUserId);

            if (!oldestUser) {
              console.log(`⚠️  All users are the new user, cannot evict`);
              resolve();
              return;
            }

            console.log(
              `🚪 FIFO Eviction: Chatroom exceeds capacity (${activeUsers.length}/${capacity})`,
            );
            console.log(
              `👤 Evicting oldest user: ${oldestUser.stageName} (joined: ${oldestUser.joinedAt})`,
            );
            
            let locationFetched = false;

            gun
              .get('chatrooms')
              .get(chatroomId)
              .get('locations')
              .get(oldestUser.userId)
              .once((locationData: any) => {
                if (locationFetched) return;
                locationFetched = true;

                if (locationData && locationData.latitude && locationData.longitude) {
                  const gpsLocation: GPSCoordinate = {
                    latitude: locationData.latitude,
                    longitude: locationData.longitude,
                    accuracy: locationData.accuracy || 0,
                    timestamp: new Date(locationData.timestamp || new Date()),
                  };

                  const childChatroomId = findAppropriateChildChatroom(chatroomId, gpsLocation);

                  if (childChatroomId) {
                    console.log(
                      `📍 Moving ${oldestUser.stageName} to child chatroom: ${childChatroomId}`,
                    );
                    self.moveUserToChatroom(
                      oldestUser.userId,
                      chatroomId,
                      childChatroomId,
                      oldestUser.stageName,
                    );
                  } else {
                    console.log(`⚠️  No appropriate child chatroom found`);
                  }
                  resolve();
                } else {
                  console.log(`❌ Location data incomplete or missing:`, locationData);
                  resolve();
                }
              });
            
            setTimeout(() => {
              if (!locationFetched) {
                locationFetched = true;
                console.log(
                  `❌ Timeout waiting for location from dedicated path for ${oldestUser.userId}`,
                );
                resolve();
              }
            }, 1000);

            return;
          }

          resolve();
        }
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

    // First, get the user's location from the old chatroom
    const locationData: any = await new Promise((resolve) => {
      gun
        .get('chatrooms')
        .get(fromChatroomId)
        .get('locations')
        .get(userId)
        .once((data: any) => {
          resolve(data);
        });

      // Timeout after 500ms
      setTimeout(() => resolve(null), 500);
    });

    // Mark user as inactive in old chatroom and add movedTo field
    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error('Update user inactive timeout')), 2000);

      gun.get('chatrooms').get(fromChatroomId).get('users').get(userId).put(
        {
          isActive: false,
          leftAt: new Date().toISOString(),
          movedTo: toChatroomId, // Signal to client they've been moved
        },
        (ack: any) => {
          clearTimeout(timeoutId);
          if (ack.err) {
            console.error('❌ Failed to mark user as inactive:', ack.err);
            // Still resolve, as we don't want to block the move operation
            resolve();
          } else {
            console.log(`✅ Marked user ${stageName} as inactive in ${fromChatroomId}`);
            resolve();
          }
        },
      );
    });

    // Remove location from old chatroom
    gun.get('chatrooms').get(fromChatroomId).get('locations').get(userId).put(null);

    // Add user to new chatroom
    const userData = {
      joinedAt: new Date().toISOString(),
      isActive: true,
      lastSeen: new Date().toISOString(),
      userId: userId,
      stageName: stageName,
      movedFrom: fromChatroomId, // Track where they came from
    };

    // Add user to new chatroom and wait for acknowledgment
    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error('Add user to new room timeout')), 2000);

      gun.get('chatrooms').get(toChatroomId).get('users').get(userId).put(userData, (ack: any) => {
        clearTimeout(timeoutId);
        if (ack.err) {
          console.error(`❌ Failed to add user to new room ${toChatroomId}:`, ack.err);
          // Don't block the overall move, but log the error
          resolve();
        } else {
          console.log(`✅ Successfully added user ${stageName} to ${toChatroomId}`);
          resolve();
        }
      });
    });

    // Transfer location to new chatroom
    if (locationData) {
      console.log(`📍 Transferring location to ${toChatroomId}`);
      gun.get('chatrooms').get(toChatroomId).get('locations').get(userId).put(locationData);
    }

    console.log(`✅ User ${stageName} successfully moved to ${toChatroomId}`);

    // Wait for Gun.js to propagate the write to all peers
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Check capacity in the new chatroom and cascade eviction if needed
    if (CONFIG.CHATROOM_ENABLE_FIFO) {
      await this.enforceCapacityLimitAfterJoin(toChatroomId, userId);
    }
  }
}
