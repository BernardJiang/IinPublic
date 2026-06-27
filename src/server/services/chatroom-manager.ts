import type { GPSCoordinate, CommunityRole, CommunityRoleRecord } from '../../shared/types';
import { GunService } from './gun-service';
import { canAssignRole, chatroomRolePath, deriveCommunityId } from '../../shared/chatroom-hierarchy';
import { isMemberRecordLive } from '../../shared/chatroom-presence';

export class ChatroomManager {
  constructor(
    private gunService: GunService
  ) {}

  private async getPathWithRetry(path: string[], maxAttempts: number = 6, delayMs: number = 150): Promise<any> {
    for (let i = 0; i < maxAttempts; i++) {
      const value = await this.gunService.getPath(path);
      if (value != null) return value;
      if (i < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    return undefined;
  }

  async getAllChatrooms(): Promise<any[]> {
    const raw = await this.getPathWithRetry(['chatroomMeta'], 6, 150);
    if (!raw || typeof raw !== 'object') return [];
    const list: any[] = [];
    for (const [id, meta] of Object.entries(raw as Record<string, any>)) {
      if (!id || id.startsWith('_')) continue;
      if (!meta || typeof meta !== 'object') continue;
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
    const meta = await this.getPathWithRetry(['chatroomMeta', chatroomId], 6, 150);
    if (!meta || typeof meta !== 'object') return null;
    const visitCount = Number(await this.gunService.getPath(['chatrooms', chatroomId, 'visitCount']).catch(() => 0)) || 0;
    const uniqueVisitorCount = Number(await this.gunService.getPath(['chatrooms', chatroomId, 'uniqueVisitorCount']).catch(() => 0)) || 0;
    return {
      id: chatroomId,
      ...meta,
      visitCount,
      uniqueVisitorCount,
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
    // FR-CR-11: derive a content-addressed ID when the caller doesn't provide one.
    // For business/custom rooms created by a known user we use deriveCommunityId
    // so the address is self-certifying. Fallback to a random ID for anonymous creation.
    const id = String(params.id || '').trim() ||
      (params.createdBy
        ? deriveCommunityId(params.createdBy, params.name)
        : `room_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
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
    await this.gunService.putPath(['chatroomMeta', id], room);

    // FR-CR-12: creator becomes owner automatically.
    if (params.createdBy) {
      await this.setRole(id, params.createdBy, 'owner', params.createdBy);
    }

    return room;
  }

  // ─── Community ownership methods (FR-CR-12) ────────────────────────────────

  /** Read the stored role for a user in a chatroom. Returns null if no record exists. */
  async getRole(chatroomId: string, userId: string): Promise<CommunityRole | null> {
    const path = chatroomRolePath(chatroomId, userId).split('/');
    const record = await this.gunService.getPath(path);
    if (!record || typeof record.role !== 'string') return null;
    return record.role as CommunityRole;
  }

  /**
   * Assign a role to a user.
   * @param actorUserId  The user performing the assignment (must have canAssignRole permission).
   *                     Pass the same value as userId when called internally (e.g. on room creation).
   */
  async setRole(
    chatroomId: string,
    userId: string,
    role: CommunityRole,
    actorUserId: string,
  ): Promise<CommunityRoleRecord> {
    // Internal bootstrap: owner sets their own role — always allowed.
    if (actorUserId !== userId) {
      const actorRole = await this.getRole(chatroomId, actorUserId);
      if (!actorRole || !canAssignRole(actorRole, role)) {
        throw new Error(
          `actor ${actorUserId} with role '${actorRole ?? 'none'}' cannot assign role '${role}'`,
        );
      }
    }
    const record: CommunityRoleRecord = {
      chatroomId,
      userId,
      role,
      assignedAt: Date.now(),
      assignedBy: actorUserId,
    };
    const path = chatroomRolePath(chatroomId, userId).split('/');
    await this.gunService.putPath(path, record);
    return record;
  }

  /**
   * Return true if the user may broadcast a talk in this chatroom.
   * Unknown users (no role record) are treated as guests (cannot broadcast).
   */
  async canUserBroadcast(chatroomId: string, userId: string): Promise<boolean> {
    const role = await this.getRole(chatroomId, userId);
    // No role record → treat as guest (most restrictive)
    if (!role) return false;
    const { getRoleCapabilities } = await import('../../shared/chatroom-hierarchy');
    return getRoleCapabilities(role).canBroadcast;
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
    await this.gunService.putPath(['chatroomMeta', chatroomId], next);
    return next;
  }

  async deleteChatroom(chatroomId: string, actorUserId: string): Promise<void> {
    await this.updateChatroom(chatroomId, actorUserId, { isActive: false });
  }

  async getActiveMembersWithStageName(chatroomId: string): Promise<Array<{ userId: string; stageName: string }>> {
    const fromRoomUsers = await this.collectActiveMembersFromUsersNode(chatroomId);
    if (fromRoomUsers.length > 0) return fromRoomUsers;
    const users = await this.getPathWithRetry(['chatroomMembers', chatroomId], 4, 100);
    if (!users || typeof users !== 'object') return [];
    const members: Array<{ userId: string; stageName: string }> = [];
    const now = Date.now();
    for (const [userId, data] of Object.entries(users as Record<string, any>)) {
      if (!userId || userId.startsWith('_')) continue;
      if (!data || typeof data !== 'object' || !isMemberRecordLive(data, now)) continue;
      members.push({
        userId,
        stageName: String((data as any).stageName || userId),
      });
    }
    return members;
  }

  /** Browser clients write `chatrooms/<id>/users`; API joins use `chatroomMembers`. Read both. */
  private async collectActiveMembersFromUsersNode(
    chatroomId: string,
  ): Promise<Array<{ userId: string; stageName: string }>> {
    const fromMap = await this.collectActiveMembersFromGunMap(['chatrooms', chatroomId, 'users'], 500);
    if (fromMap.length > 0) return fromMap;
    const users = await this.getPathWithRetry(['chatrooms', chatroomId, 'users'], 2, 80);
    if (!users || typeof users !== 'object') return [];
    const members: Array<{ userId: string; stageName: string }> = [];
    const now = Date.now();
    for (const [userId, data] of Object.entries(users as Record<string, any>)) {
      if (!userId || userId.startsWith('_')) continue;
      if (!data || typeof data !== 'object' || !isMemberRecordLive(data, now)) continue;
      members.push({
        userId,
        stageName: String((data as any).stageName || userId),
      });
    }
    return members;
  }

  /** Gun child nodes (room members) require `.map()` — parent `.once()` often returns empty. */
  private collectActiveMembersFromGunMap(
    path: string[],
    observeMs: number,
  ): Promise<Array<{ userId: string; stageName: string }>> {
    return new Promise((resolve) => {
      const gun = this.gunService.getGun();
      let ref: any = gun;
      for (const seg of path) {
        ref = ref.get(seg);
      }
      const members: Array<{ userId: string; stageName: string }> = [];
      const seen = new Set<string>();
      const mapRef = ref.map();
      const finish = () => {
        try {
          mapRef.off();
        } catch {
          /* ignore */
        }
        resolve(members);
      };
      const timer = setTimeout(finish, observeMs);
      mapRef.on((data: unknown, key: string) => {
        if (!key || key.startsWith('_')) return;
        if (!data || typeof data !== 'object' || !isMemberRecordLive(data as Record<string, unknown>)) return;
        if (seen.has(key)) return;
        seen.add(key);
        members.push({
          userId: key,
          stageName: String((data as { stageName?: string }).stageName || key),
        });
      });
      timer.unref?.();
    });
  }

  async joinChatroom(chatroomId: string, userId: string, stageName?: string): Promise<void> {
    const existingMember = await this.gunService.getPath(['chatroomMembers', chatroomId, userId]).catch(() => null);
    if (existingMember?.isActive === true) return;
    const memberData = {
      joinedAt: new Date(),
      isActive: true,
      ...(stageName ? { stageName } : {}),
    };
    await this.gunService.putPath(['chatrooms', chatroomId, 'users', userId], {
      ...memberData,
    });
    await this.gunService.putPath(['chatroomMembers', chatroomId, userId], {
      ...memberData,
    });
    const current = await this.gunService.getPath(['chatrooms', chatroomId, 'headcount']);
    const headcount = Number(current) || 0;
    await this.gunService.putPath(['chatrooms', chatroomId, 'headcount'], headcount + 1);
    await this.recordVisit(chatroomId, userId);
    await this.publishRoomMemberCount(chatroomId);
  }

  async addMemberFast(chatroomId: string, userId: string, stageName?: string): Promise<void> {
    const memberData = {
      joinedAt: new Date(),
      isActive: true,
      ...(stageName ? { stageName } : {}),
    };
    await Promise.all([
      this.gunService.putPath(['chatrooms', chatroomId, 'users', userId], memberData),
      this.gunService.putPath(['chatroomMembers', chatroomId, userId], memberData),
    ]);
    // Publishing the public member count re-reads the whole room. On a cold isolated Gun the
    // read can race the writes we just issued and stall on the per-read timeout budget
    // (several seconds), which made the members API hang past its request deadline. The count
    // is an eventually-consistent badge, so fan it out without blocking the caller's response.
    void this.publishRoomMemberCount(chatroomId).catch(() => {
      /* best-effort public badge; never blocks membership writes */
    });
  }

  private async recordVisit(chatroomId: string, userId: string): Promise<void> {
    const now = new Date().toISOString();
    const visitCount = Number(await this.gunService.getPath(['chatrooms', chatroomId, 'visitCount']).catch(() => 0)) || 0;
    await this.gunService.putPath(['chatrooms', chatroomId, 'visitCount'], visitCount + 1);
    const existingVisitor = await this.gunService.getPath(['chatrooms', chatroomId, 'uniqueVisitors', userId]).catch(() => null);
    await this.gunService.putPath(['chatrooms', chatroomId, 'uniqueVisitors', userId], {
      userId,
      firstVisitedAt: existingVisitor?.firstVisitedAt || now,
      lastVisitedAt: now,
    });
    if (!existingVisitor) {
      const uniqueCount = Number(await this.gunService.getPath(['chatrooms', chatroomId, 'uniqueVisitorCount']).catch(() => 0)) || 0;
      await this.gunService.putPath(['chatrooms', chatroomId, 'uniqueVisitorCount'], uniqueCount + 1);
    }
  }

  async leaveChatroom(chatroomId: string, userId: string): Promise<void> {
    const leftData = {
      leftAt: new Date(),
      isActive: false
    };
    await this.gunService.putPath(['chatrooms', chatroomId, 'users', userId], {
      ...leftData,
    });
    await this.gunService.putPath(['chatroomMembers', chatroomId, userId], {
      ...leftData,
    });
    const current = await this.gunService.getPath(['chatrooms', chatroomId, 'headcount']);
    const headcount = Number(current) || 0;
    await this.gunService.putPath(['chatrooms', chatroomId, 'headcount'], Math.max(0, headcount - 1));
    // Eventually-consistent public badge; never block the leave response on its racy re-read.
    void this.publishRoomMemberCount(chatroomId).catch(() => {
      /* best-effort public badge */
    });
  }

  /**
   * Publish the server-observed active-member total for lightweight room-list badges.
   * This is deliberately public aggregate data: no member identities are exposed here.
   */
  private async publishRoomMemberCount(chatroomId: string): Promise<void> {
    const count = (await this.getActiveMembersWithStageName(chatroomId)).length;
    await this.gunService.putPath(['public', 'room-member-counts', chatroomId], {
      count,
      updatedAt: new Date().toISOString(),
    });
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
