import { GPSCoordinate } from '../../shared/types';
import { GunService } from './gun-service';

export class ChatroomManager {
  constructor(
    private gunService: GunService
  ) {}

  async getAllChatrooms(): Promise<any[]> {
    return await this.gunService.getSet('chatrooms');
  }

  async joinChatroom(chatroomId: string, userId: string): Promise<void> {
    await this.gunService.put(`chatrooms/${chatroomId}/users/${userId}`, {
      joinedAt: new Date(),
      isActive: true
    });
    const headcount = await this.gunService.get(`chatrooms/${chatroomId}/headcount`) || 0;
    await this.gunService.put(`chatrooms/${chatroomId}/headcount`, headcount + 1);
  }

  async leaveChatroom(chatroomId: string, userId: string): Promise<void> {
    await this.gunService.put(`chatrooms/${chatroomId}/users/${userId}`, {
      leftAt: new Date(),
      isActive: false
    });
    const headcount = await this.gunService.get(`chatrooms/${chatroomId}/headcount`) || 0;
    await this.gunService.put(`chatrooms/${chatroomId}/headcount`, Math.max(0, headcount - 1));
  }

  async moveChatroom(userId: string, oldChatroomId: string, newChatroomId: string): Promise<void> {
    await this.leaveChatroom(oldChatroomId, userId);
    await this.joinChatroom(newChatroomId, userId);
  }

  async findOptimalChatroom(_location: GPSCoordinate): Promise<string> {
    // Server-side optimal chatroom logic
    return 'global';
  }
}