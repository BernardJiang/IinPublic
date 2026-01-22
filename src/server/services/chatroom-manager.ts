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
  }

  async leaveChatroom(chatroomId: string, userId: string): Promise<void> {
    await this.gunService.put(`chatrooms/${chatroomId}/users/${userId}`, {
      leftAt: new Date(),
      isActive: false
    });
  }

  async findOptimalChatroom(_location: GPSCoordinate): Promise<string> {
    // Server-side optimal chatroom logic
    return 'global';
  }
}