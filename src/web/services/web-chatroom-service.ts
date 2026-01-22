import { GPSCoordinate } from '../../shared/types';
import { LocationPrivacy } from '../../shared/location';
import { WebGunService } from './web-gun-service';

export class WebChatroomService {
  private currentChatroomId?: string;

  constructor(private gunService: WebGunService) {}

  async findOptimalChatroom(location: GPSCoordinate): Promise<string> {
    // Get available chatrooms (simplified for now)
    const hierarchy = LocationPrivacy.getNearbyRegions(LocationPrivacy.blurLocation(location).region);
    
    // For now, return the most specific chatroom
    return hierarchy[hierarchy.length - 1];
  }

  async joinChatroom(chatroomId: string, userId: string): Promise<void> {
    this.currentChatroomId = chatroomId;
    await this.gunService.put(`chatrooms/${chatroomId}/users/${userId}`, {
      joinedAt: new Date(),
      isActive: true
    });
  }

  async leaveChatroom(chatroomId: string, userId: string): Promise<void> {
    await this.gunService.put(`chatrooms/${chatroomId}/users/${userId}`, {
      leftAt: new Date(),
      isActive: false
    });
  }

  async switchChatroom(userId: string, newChatroomId: string): Promise<void> {
    if (this.currentChatroomId) {
      await this.leaveChatroom(this.currentChatroomId, userId);
    }
    await this.joinChatroom(newChatroomId, userId);
  }

  getCurrentChatroomId(): string | undefined {
    return this.currentChatroomId;
  }
}