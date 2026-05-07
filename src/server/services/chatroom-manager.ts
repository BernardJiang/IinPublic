import { GPSCoordinate } from '../../shared/types';
import { GunService } from './gun-service';

export class ChatroomManager {
  constructor(
    private gunService: GunService
  ) {}

  async getAllChatrooms(): Promise<any[]> {
    const raw = await this.gunService.getPath(['chatrooms']);
    if (!raw || typeof raw !== 'object') return [];
    const list: any[] = [];
    for (const [id, node] of Object.entries(raw as Record<string, any>)) {
      if (!id || id.startsWith('_') || !node || typeof node !== 'object') continue;
      const meta = (node as any).meta && typeof (node as any).meta === 'object'
        ? (node as any).meta
        : node;
      if (meta?.isActive === false) continue;
      list.push({
        id,
        name: meta?.name || id,
        type: meta?.type || 'location',
        description: meta?.description || '',
        capacity: Number(meta?.capacity || 0) || 0,
        createdBy: meta?.createdBy,
        createdAt: meta?.createdAt,
        isActive: meta?.isActive !== false,
        businessInfo: meta?.businessInfo,
      });
    }
    return list;
  }

  async getChatroom(chatroomId: string): Promise<any | null> {
    const node = await this.gunService.getPath(['chatrooms', chatroomId]);
    if (!node || typeof node !== 'object') return null;
    const meta = (node as any).meta && typeof (node as any).meta === 'object'
      ? (node as any).meta
      : node;
    return {
      id: chatroomId,
      ...meta,
    };
  }

  async createChatroom(params: {
    id?: string;
    name: string;
    type: 'business' | 'custom';
    createdBy: string;
    description?: string;
    capacity?: number;
    businessInfo?: any;
  }): Promise<any> {
    const id = String(params.id || '').trim() || `room_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const room = {
      id,
      name: String(params.name || '').trim(),
      type: params.type,
      description: String(params.description || '').trim(),
      capacity: Math.max(1, Math.floor(Number(params.capacity || 50))),
      createdBy: params.createdBy,
      businessInfo: params.businessInfo,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isActive: true,
    };
    if (!room.name) {
      throw new Error('chatroom name is required');
    }
    await this.gunService.putPath(['chatrooms', id, 'meta'], room);
    return room;
  }

  async updateChatroom(
    chatroomId: string,
    actorUserId: string,
    updates: { name?: string; description?: string; isActive?: boolean; capacity?: number },
  ): Promise<any> {
    const existing = await this.getChatroom(chatroomId);
    if (!existing) throw new Error('chatroom not found');
    if (existing.createdBy && existing.createdBy !== actorUserId) {
      throw new Error('only creator can update chatroom');
    }
    const next = {
      ...existing,
      ...(updates.name != null ? { name: String(updates.name).trim() } : {}),
      ...(updates.description != null ? { description: String(updates.description).trim() } : {}),
      ...(updates.isActive != null ? { isActive: !!updates.isActive } : {}),
      ...(updates.capacity != null ? { capacity: Math.max(1, Math.floor(Number(updates.capacity))) } : {}),
      updatedAt: new Date().toISOString(),
    };
    if (!next.name) throw new Error('chatroom name is required');
    await this.gunService.putPath(['chatrooms', chatroomId, 'meta'], next);
    return next;
  }

  async deleteChatroom(chatroomId: string, actorUserId: string): Promise<void> {
    await this.updateChatroom(chatroomId, actorUserId, { isActive: false });
  }

  async getActiveMembersWithStageName(chatroomId: string): Promise<Array<{ userId: string; stageName: string }>> {
    const users = await this.gunService.getPath(['chatrooms', chatroomId, 'users']);
    if (!users || typeof users !== 'object') return [];
    const members: Array<{ userId: string; stageName: string }> = [];
    for (const [userId, data] of Object.entries(users as Record<string, any>)) {
      if (!userId || userId.startsWith('_')) continue;
      if (!data || typeof data !== 'object' || (data as any).isActive !== true) continue;
      members.push({
        userId,
        stageName: String((data as any).stageName || userId),
      });
    }
    return members;
  }

  async joinChatroom(chatroomId: string, userId: string, stageName?: string): Promise<void> {
    await this.gunService.put(`chatrooms/${chatroomId}/users/${userId}`, {
      joinedAt: new Date(),
      isActive: true,
      ...(stageName ? { stageName } : {}),
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