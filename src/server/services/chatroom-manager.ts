import type { GPSCoordinate, CommunityRole, CommunityRoleRecord } from '../../shared/types';
import { GunService } from './gun-service';
import { canAssignRole, chatroomRolePath, deriveCommunityId } from '../../shared/chatroom-hierarchy';
import { ROOM_MEMBERSHIP_TTL_SECONDS } from '../../shared/p2p-runtime';
import { isTechSupportId } from '../../shared/techsupport';

export class ChatroomManager {
  private fastActiveMembers = new Map<string, Map<string, { userId: string; stageName: string; lastSeen: string }>>();
  /**
   * Authoritative in-process room metadata (same pattern as fastActiveMembers /
   * the server's incomingTalksMap): Gun paths are a mirror. `.once` reads of
   * `chatroomMeta/<id>` can time out on an ephemeral in-memory hub even for data
   * this process just wrote, which made create→rename fail with "chatroom not
   * found" and degraded listed room names to ids.
   */
  private roomMetaCache = new Map<string, any>();
  /** E2E reset fence — see resetForTesting()/predatesReset(). 0 in production (no filtering). */
  private membersResetAt = 0;

  constructor(
    private gunService: GunService
  ) {}

  /**
   * E2E only (`POST /api/test/clear-database`): purge every membership trace of the previous
   * spec. Two ghost sources survive a plain `gun._.graph = {}` wipe: (1) this in-memory map,
   * which keeps members "active" for ROOM_MEMBERSHIP_TTL_SECONDS (~3min) after their last
   * heartbeat; (2) Gun chain caches — the server's long-lived `chatrooms/<id>/users`
   * subscriptions hold each member node's last data, and `.once` reads re-materialize it
   * after the graph object is replaced. Explicitly nulling the member nodes we know about
   * overrides those caches. Without both steps, a finished spec's user inflates every
   * subsequent spec's headcount by one ("expected 2, got 3" ghost-membership failures).
   */
  resetForTesting(): void {
    // Gun chain caches can resurrect member nodes even after explicit null puts, so the
    // authoritative guard is a time fence: any member record whose lastSeen predates this
    // reset is a ghost from a previous spec and is ignored by every collector below. Live
    // users re-stamp lastSeen on join and every ~30s heartbeat, so they pass immediately.
    this.membersResetAt = Date.now();
    for (const [chatroomId, room] of this.fastActiveMembers.entries()) {
      for (const userId of room.keys()) {
        void this.gunService.putPath(['chatrooms', chatroomId, 'users', userId], null);
        void this.gunService.putPath(['chatroomMembers', chatroomId, userId], null);
      }
    }
    this.fastActiveMembers.clear();
    for (const id of this.roomMetaCache.keys()) {
      void this.gunService.putPath(['chatroomMeta', id], null);
    }
    this.roomMetaCache.clear();
  }

  /** True when the record's lastSeen (or joinedAt) predates the last E2E reset — a ghost. */
  private predatesReset(data: unknown): boolean {
    if (!this.membersResetAt) return false;
    const raw = (data as { lastSeen?: unknown; joinedAt?: unknown } | null | undefined);
    const stamp = Date.parse(String(raw?.lastSeen ?? raw?.joinedAt ?? ''));
    return !Number.isFinite(stamp) || stamp < this.membersResetAt;
  }

  private upsertFastMember(
    chatroomId: string,
    userId: string,
    stageName?: string,
    lastSeen?: string,
    opts: { bypassResetFence?: boolean } = {},
  ): void {
    // E2E reset fence: replayed member records from before a clear-database must never
    // re-enter the map. Exception: an explicit PATCH that deliberately backdates lastSeen
    // (the stale-membership prune specs inject staleness that way) bypasses the fence.
    if (!opts.bypassResetFence && lastSeen && this.predatesReset({ lastSeen })) return;
    const room = this.fastActiveMembers.get(chatroomId) ?? new Map<string, { userId: string; stageName: string; lastSeen: string }>();
    room.set(userId, {
      userId,
      stageName: stageName || userId,
      lastSeen: lastSeen || new Date().toISOString(),
    });
    this.fastActiveMembers.set(chatroomId, room);
  }

  private removeFastMember(chatroomId: string, userId: string): void {
    const room = this.fastActiveMembers.get(chatroomId);
    if (!room) return;
    room.delete(userId);
    if (room.size === 0) this.fastActiveMembers.delete(chatroomId);
  }

  private getFastActiveMembers(chatroomId: string, now = new Date()): Array<{ userId: string; stageName: string }> {
    const room = this.fastActiveMembers.get(chatroomId);
    if (!room) return [];
    const members: Array<{ userId: string; stageName: string }> = [];
    for (const [userId, member] of room) {
      if (this.roomMembershipIsStale({ isActive: true, lastSeen: member.lastSeen }, now)) {
        room.delete(userId);
        continue;
      }
      members.push({ userId, stageName: member.stageName });
    }
    if (room.size === 0) this.fastActiveMembers.delete(chatroomId);
    return members;
  }

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
    const metaById = new Map<string, any>();
    // Gun mirror first (survives restarts) …
    const raw = await this.getPathWithRetry(['chatroomMeta'], 2, 100);
    if (raw && typeof raw === 'object') {
      for (const [id, rawMeta] of Object.entries(raw as Record<string, any>)) {
        if (!id || id.startsWith('_')) continue;
        // A `.once` on the root node returns children as Gun link stubs
        // ({'#': soul}), not hydrated objects — without a per-id read every
        // room's name degrades to its id. Hydrate stubs unless the in-process
        // cache (checked below) already has the room.
        let meta = rawMeta;
        if (
          (!meta || typeof meta !== 'object' || meta['#'] != null || meta.name == null) &&
          !this.roomMetaCache.has(id)
        ) {
          meta = await this.getPathWithRetry(['chatroomMeta', id], 1, 50);
        }
        if (!meta || typeof meta !== 'object' || meta['#'] != null) continue;
        metaById.set(id, meta);
      }
    }
    // … then the authoritative in-process cache overrides the mirror.
    for (const [id, meta] of this.roomMetaCache.entries()) {
      metaById.set(id, meta);
    }
    const list: any[] = [];
    for (const [id, meta] of metaById.entries()) {
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
    // In-process cache is authoritative; the Gun mirror covers restarts.
    const meta = this.roomMetaCache.get(chatroomId)
      ?? await this.getPathWithRetry(['chatroomMeta', chatroomId], 6, 150);
    if (!meta || typeof meta !== 'object') return null;
    if (!this.roomMetaCache.has(chatroomId)) this.roomMetaCache.set(chatroomId, meta);
    const [visitCountRaw, uniqueVisitorCountRaw] = await Promise.all([
      this.gunService.getPath(['chatrooms', chatroomId, 'visitCount']).catch(() => 0),
      this.gunService.getPath(['chatrooms', chatroomId, 'uniqueVisitorCount']).catch(() => 0),
    ]);
    const visitCount = Number(visitCountRaw) || 0;
    const uniqueVisitorCount = Number(uniqueVisitorCountRaw) || 0;
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
    this.roomMetaCache.set(id, room);
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
    this.roomMetaCache.set(chatroomId, next);
    await this.gunService.putPath(['chatrooms', chatroomId, 'meta'], next);
    await this.gunService.putPath(['chatroomMeta', chatroomId], next);
    return next;
  }

  async deleteChatroom(chatroomId: string, actorUserId: string): Promise<void> {
    await this.updateChatroom(chatroomId, actorUserId, { isActive: false });
  }

  async getActiveMembersWithStageName(chatroomId: string): Promise<Array<{ userId: string; stageName: string }>> {
    const fastMembers = this.getFastActiveMembers(chatroomId);
    if (fastMembers.length > 0) return fastMembers;
    const pruned = await this.pruneStaleRoomMemberships(chatroomId);
    const fromRoomUsers = await this.collectActiveMembersFromUsersNode(chatroomId);
    if (fromRoomUsers.length > 0) {
      if (pruned) void this.publishRoomMemberCountValue(chatroomId, fromRoomUsers.length);
      return fromRoomUsers;
    }
    const users = await this.getPathWithRetry(['chatroomMembers', chatroomId], 4, 100);
    if (!users || typeof users !== 'object') {
      if (pruned) void this.publishRoomMemberCountValue(chatroomId, 0);
      return [];
    }
    const members: Array<{ userId: string; stageName: string }> = [];
    for (const [userId, data] of Object.entries(users as Record<string, any>)) {
      if (!userId || userId.startsWith('_')) continue;
      if (!data || typeof data !== 'object' || (data as any).isActive !== true) continue;
      if (this.predatesReset(data)) continue;
      members.push({
        userId,
        stageName: String((data as any).stageName || userId),
      });
    }
    if (pruned) void this.publishRoomMemberCountValue(chatroomId, members.length);
    return members;
  }

  private roomMembershipIsStale(data: unknown, now = new Date()): boolean {
    if (!data || typeof data !== 'object' || (data as { isActive?: boolean }).isActive !== true) {
      return false;
    }
    const raw = String(
      (data as { lastSeen?: unknown; joinedAt?: unknown }).lastSeen ||
        (data as { joinedAt?: unknown }).joinedAt ||
        '',
    );
    if (!raw) return false;
    const lastSeen = new Date(raw).getTime();
    if (!Number.isFinite(lastSeen)) return false;
    return now.getTime() - lastSeen > ROOM_MEMBERSHIP_TTL_SECONDS * 1000;
  }

  private async collectRoomMemberRecordsFromGunMap(
    path: string[],
    observeMs: number,
  ): Promise<Array<{ userId: string; data: any }>> {
    return new Promise((resolve) => {
      const gun = this.gunService.getGun();
      let ref: any = gun;
      for (const seg of path) {
        ref = ref.get(seg);
      }
      const records: Array<{ userId: string; data: any }> = [];
      const seen = new Set<string>();
      const mapRef = ref.map();
      const finish = () => {
        try {
          mapRef.off();
        } catch {
          /* ignore */
        }
        resolve(records);
      };
      const timer = setTimeout(finish, observeMs);
      mapRef.on((data: unknown, key: string) => {
        if (!key || key.startsWith('_') || seen.has(key)) return;
        if (!data || typeof data !== 'object') return;
        seen.add(key);
        records.push({ userId: key, data });
      });
      timer.unref?.();
    });
  }

  private async collectRoomMemberRecords(
    path: string[],
  ): Promise<Array<{ userId: string; data: any }>> {
    const fromMap = await this.collectRoomMemberRecordsFromGunMap(path, 500);
    if (fromMap.length > 0) return fromMap;
    const users = await this.getPathWithRetry(path, 2, 80);
    if (!users || typeof users !== 'object') return [];
    return Object.entries(users as Record<string, any>)
      .filter(([userId, data]) => !!userId && !userId.startsWith('_') && !!data && typeof data === 'object')
      .map(([userId, data]) => ({ userId, data }));
  }

  private async pruneStaleRoomMemberships(chatroomId: string, now = new Date()): Promise<boolean> {
    const stale = new Set<string>();
    const recordGroups = await Promise.all([
      this.collectRoomMemberRecords(['chatrooms', chatroomId, 'users']),
      this.collectRoomMemberRecords(['chatroomMembers', chatroomId]),
    ]);
    for (const records of recordGroups) {
      for (const record of records) {
        // TechSupport is never evicted from a room (decision K1-3, docs/TODO.md). Checked here,
        // at the single point where staleness becomes an eviction, so every caller of the prune
        // is covered by one string comparison rather than a guard per call site.
        if (isTechSupportId(record.userId)) continue;
        if (this.roomMembershipIsStale(record.data, now)) stale.add(record.userId);
      }
    }
    if (stale.size === 0) return false;
    const leftData = {
      leftAt: now.toISOString(),
      isActive: false,
      stalePresenceExpired: true,
    };
    await Promise.all(
      [...stale].flatMap((userId) => [
        this.gunService.putPath(['chatrooms', chatroomId, 'users', userId], leftData),
        this.gunService.putPath(['chatroomMembers', chatroomId, userId], leftData),
      ]),
    );
    return true;
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
    for (const [userId, data] of Object.entries(users as Record<string, any>)) {
      if (!userId || userId.startsWith('_')) continue;
      if (!data || typeof data !== 'object' || (data as any).isActive !== true) continue;
      if (this.predatesReset(data)) continue;
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
        if (!data || typeof data !== 'object' || (data as { isActive?: boolean }).isActive !== true) return;
        if (this.predatesReset(data)) return;
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
    this.upsertFastMember(chatroomId, userId, stageName);
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
    this.upsertFastMember(chatroomId, userId, stageName);
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

  async touchMemberFast(
    chatroomId: string,
    userId: string,
    options: { stageName?: string; lastSeen?: string } = {},
  ): Promise<void> {
    const now = new Date().toISOString();
    const existing =
      (await this.gunService.getPath(['chatrooms', chatroomId, 'users', userId]).catch(() => null)) ||
      (await this.gunService.getPath(['chatroomMembers', chatroomId, userId]).catch(() => null)) ||
      {};
    const memberData = {
      joinedAt: existing?.joinedAt || now,
      isActive: true,
      lastSeen: options.lastSeen || now,
      ...(options.stageName || existing?.stageName
        ? { stageName: String(options.stageName || existing.stageName) }
        : {}),
      userId,
    };
    this.upsertFastMember(
      chatroomId,
      userId,
      typeof memberData.stageName === 'string' ? memberData.stageName : userId,
      memberData.lastSeen,
      // A caller-provided lastSeen is a deliberate update (prune specs backdate it to force
      // staleness); only auto-stamped heartbeats stay subject to the reset fence.
      { bypassResetFence: Boolean(options.lastSeen) },
    );
    await Promise.all([
      this.gunService.putPath(['chatrooms', chatroomId, 'users', userId], memberData),
      this.gunService.putPath(['chatroomMembers', chatroomId, userId], memberData),
    ]);
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
    this.removeFastMember(chatroomId, userId);
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
    await this.publishRoomMemberCountValue(chatroomId, count);
  }

  private async publishRoomMemberCountValue(chatroomId: string, count: number): Promise<void> {
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
