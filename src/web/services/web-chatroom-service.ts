import { GPSCoordinate } from '../../shared/types';
import { LocationPrivacy } from '../../shared/location';
import { WebGunService } from './web-gun-service';

export class WebChatroomService {
  private currentChatroomId?: string;
  private activeMembersUnsubscribe?: () => void;

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

      // After each update, collect all active members
      setTimeout(() => {
        this.collectActiveMembers(chatroomId, callback);
      }, 100);
    });

    this.activeMembersUnsubscribe = () => off.off();

    // Do initial collection
    setTimeout(() => {
      this.collectActiveMembers(chatroomId, callback);
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
}
