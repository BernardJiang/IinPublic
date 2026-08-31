import type express from 'express';
import { ChatroomManager } from '../services/chatroom-manager';
import type { CommunityRole } from '../../shared/types';
import type {
  EmbeddedHubRelayClientLike,
  RelayRoomMember,
} from '../../node-app/embedded-hub-relay-client';
import {
  runChallengeGate,
  type ChallengeGateConfig,
  type ChallengeContext,
  type GatedAction,
} from '../../shared/challenge-plugins';
import { isValidChatroomMapLocation } from '../../shared/chatroom-map-geojson';
import type { ChatroomMapLocation } from '../../shared/chatroom-map-locations';

const VALID_ROLES: CommunityRole[] = ['owner', 'moderator', 'member', 'guest'];

type RegisterChatroomRoutesDeps = {
  chatroomManager: ChatroomManager;
  /**
   * S3 native explicit relay mode: embedded local nodes keep app graph local,
   * but mirror room-membership metadata to the configured upstream hub.
   */
  hubRelayClient?: EmbeddedHubRelayClientLike;
  /**
   * FR-CPF-01: Optional gate resolver.  When provided, called for each
   * gated action before the action is executed.  If it returns a config the
   * gate is run; returning null/undefined skips the gate (no-op default).
   */
  resolveChallengeGate?: (
    action: GatedAction,
    chatroomId: string,
  ) => ChallengeGateConfig | null | undefined | Promise<ChallengeGateConfig | null | undefined>;
};

export function registerChatroomRoutes(
  app: express.Application,
  { chatroomManager, hubRelayClient, resolveChallengeGate }: RegisterChatroomRoutesDeps,
): void {
  const relayPollTimers = new Map<string, ReturnType<typeof setInterval>>();

  const mergeMembers = (
    localMembers: RelayRoomMember[],
    remoteMembers: RelayRoomMember[],
  ): RelayRoomMember[] => {
    const byUser = new Map<string, RelayRoomMember>();
    for (const member of [...localMembers, ...remoteMembers]) {
      if (!member.userId) continue;
      byUser.set(member.userId, {
        userId: member.userId,
        stageName: member.stageName || member.userId,
      });
    }
    return Array.from(byUser.values());
  };

  const syncMembersFromRelay = async (chatroomId: string): Promise<RelayRoomMember[]> => {
    if (!hubRelayClient) return [];
    const remoteMembers = await hubRelayClient.listMembers(chatroomId);
    await Promise.all(
      remoteMembers.map((member) =>
        chatroomManager.touchMemberFast(chatroomId, member.userId, {
          stageName: member.stageName,
          lastSeen: new Date().toISOString(),
        }),
      ),
    );
    return remoteMembers;
  };

  const syncMembersFromRelayBestEffort = async (chatroomId: string): Promise<RelayRoomMember[]> => {
    try {
      return await syncMembersFromRelay(chatroomId);
    } catch {
      return [];
    }
  };

  const observeRelayRoom = (chatroomId: string): void => {
    if (!hubRelayClient || relayPollTimers.has(chatroomId)) return;
    const timer = setInterval(() => {
      void syncMembersFromRelayBestEffort(chatroomId);
    }, 5_000);
    timer.unref?.();
    relayPollTimers.set(chatroomId, timer);
  };

  const mirrorRelayJoin = async (
    chatroomId: string,
    userId: string,
    stageName?: string,
  ): Promise<void> => {
    if (!hubRelayClient) return;
    try {
      await hubRelayClient.addMember(chatroomId, userId, stageName);
      observeRelayRoom(chatroomId);
      await syncMembersFromRelayBestEffort(chatroomId);
    } catch {
      // The local embedded node remains usable offline; relay sync is best-effort metadata.
    }
  };

  const mirrorRelayTouch = async (
    chatroomId: string,
    userId: string,
    options: { stageName?: string; lastSeen?: string },
  ): Promise<void> => {
    if (!hubRelayClient) return;
    try {
      await hubRelayClient.touchMember(chatroomId, userId, options);
      observeRelayRoom(chatroomId);
      await syncMembersFromRelayBestEffort(chatroomId);
    } catch {
      // Best-effort metadata relay.
    }
  };

  const mirrorRelayLeave = async (chatroomId: string, userId: string): Promise<void> => {
    if (!hubRelayClient) return;
    try {
      await hubRelayClient.removeMember(chatroomId, userId);
    } catch {
      // Best-effort metadata relay.
    }
  };

  /** Runs the challenge gate for `action` in `chatroomId` for `userId`.
   *  Returns a 403-ready error string, or null if the action is allowed. */
  async function checkGate(
    action: GatedAction,
    chatroomId: string,
    context: ChallengeContext,
  ): Promise<string | null> {
    if (!resolveChallengeGate) return null;
    const config = await resolveChallengeGate(action, chatroomId);
    if (!config) return null;
    const result = await runChallengeGate(action, context, config);
    if (result.allowed) return null;
    return result.reason ?? 'The challenge gate denied this action.';
  }
  app.get('/api/chatrooms', async (_req, res) => {
    try {
      const chatrooms = await chatroomManager.getAllChatrooms();
      res.json(chatrooms);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post('/api/chatrooms/:id/join', async (req, res) => {
    try {
      const { userId } = req.body as { userId?: string };
      if (!userId) {
        res.status(400).json({ error: 'userId is required' });
        return;
      }
      // FR-CPF-01: run challenge gate for join-community when configured.
      const deny = await checkGate('join-community', req.params.id, { userId, chatroomId: req.params.id });
      if (deny) {
        res.status(403).json({ error: deny });
        return;
      }
      await chatroomManager.joinChatroom(req.params.id, userId);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.get('/api/chatrooms/:id', async (req, res) => {
    try {
      const chatroom = await chatroomManager.getChatroom(req.params.id);
      if (!chatroom) {
        res.status(404).json({ error: 'chatroom not found' });
        return;
      }
      res.json(chatroom);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post('/api/chatrooms', async (req, res) => {
    try {
      const { id, name, type, createdBy, description, capacity, businessInfo, location } = req.body as {
        id?: string;
        name: string;
        type: 'business' | 'custom';
        createdBy: string;
        description?: string;
        capacity?: number;
        businessInfo?: unknown;
        location?: unknown;
      };
      if (!name || !type || !createdBy) {
        res.status(400).json({ error: 'name, type, and createdBy are required' });
        return;
      }
      if (type !== 'business' && type !== 'custom') {
        res.status(400).json({ error: 'type must be business or custom' });
        return;
      }
      if (location != null && !isValidChatroomMapLocation(location)) {
        res.status(400).json({ error: 'location must contain valid latitude and longitude' });
        return;
      }
      const createPayload: {
        id?: string;
        name: string;
        type: 'business' | 'custom';
        createdBy: string;
        description?: string;
        capacity?: number;
        businessInfo?: unknown;
        location?: ChatroomMapLocation;
      } = { name, type, createdBy };
      if (id != null) createPayload.id = id;
      if (description != null) createPayload.description = description;
      if (capacity != null) createPayload.capacity = capacity;
      if (businessInfo != null) createPayload.businessInfo = businessInfo;
      if (location != null) createPayload.location = location;
      const created = await chatroomManager.createChatroom(createPayload);
      res.status(201).json(created);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.patch('/api/chatrooms/:id', async (req, res) => {
    try {
      const { userId, name, description, isActive, capacity, location } = req.body as {
        userId: string;
        name?: string;
        description?: string;
        isActive?: boolean;
        capacity?: number;
        location?: unknown;
      };
      if (!userId) {
        res.status(400).json({ error: 'userId is required' });
        return;
      }
      if (location !== undefined && location !== null && !isValidChatroomMapLocation(location)) {
        res.status(400).json({ error: 'location must contain valid latitude and longitude' });
        return;
      }
      const updates: {
        name?: string;
        description?: string;
        isActive?: boolean;
        capacity?: number;
        location?: ChatroomMapLocation | null;
      } = {};
      if (name != null) updates.name = name;
      if (description != null) updates.description = description;
      if (isActive != null) updates.isActive = isActive;
      if (capacity != null) updates.capacity = capacity;
      if (location !== undefined) updates.location = location as ChatroomMapLocation | null;
      const updated = await chatroomManager.updateChatroom(req.params.id, userId, updates);
      res.json(updated);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.delete('/api/chatrooms/:id', async (req, res) => {
    try {
      const userId = String(req.query.userId || '');
      if (!userId) {
        res.status(400).json({ error: 'userId query param is required' });
        return;
      }
      await chatroomManager.deleteChatroom(req.params.id, userId);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.get('/api/chatrooms/:id/members', async (req, res) => {
    try {
      observeRelayRoom(req.params.id);
      const remoteMembers = await syncMembersFromRelayBestEffort(req.params.id);
      const members = await chatroomManager.getActiveMembersWithStageName(req.params.id);
      res.json(mergeMembers(members, remoteMembers));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post('/api/chatrooms/:id/members', async (req, res) => {
    try {
      const { userId, stageName } = req.body as { userId: string; stageName?: string };
      if (!userId) {
        res.status(400).json({ error: 'userId is required' });
        return;
      }
      await chatroomManager.addMemberFast(req.params.id, userId, stageName);
      await mirrorRelayJoin(req.params.id, userId, stageName);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.patch('/api/chatrooms/:id/members/:userId', async (req, res) => {
    try {
      const { stageName, lastSeen } = req.body as { stageName?: string; lastSeen?: string };
      const options: { stageName?: string; lastSeen?: string } = {};
      if (stageName !== undefined) options.stageName = stageName;
      if (lastSeen !== undefined) options.lastSeen = lastSeen;
      await chatroomManager.touchMemberFast(req.params.id, req.params.userId, options);
      await mirrorRelayTouch(req.params.id, req.params.userId, options);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.delete('/api/chatrooms/:id/members/:userId', async (req, res) => {
    try {
      await chatroomManager.leaveChatroom(req.params.id, req.params.userId);
      await mirrorRelayLeave(req.params.id, req.params.userId);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  // ─── Community ownership routes (FR-CR-12) ──────────────────────────────────

  /**
   * GET /api/chatrooms/:id/roles/:userId
   * Returns the role record for the given user, or 404 if none exists.
   */
  app.get('/api/chatrooms/:id/roles/:userId', async (req, res) => {
    try {
      const role = await chatroomManager.getRole(req.params.id, req.params.userId);
      if (!role) {
        res.status(404).json({ error: 'no role record found' });
        return;
      }
      res.json({ chatroomId: req.params.id, userId: req.params.userId, role });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * PUT /api/chatrooms/:id/roles/:userId
   * Body: { actorUserId: string, role: CommunityRole }
   *
   * Assigns `role` to `userId` in chatroom `:id`.
   * The request must include `actorUserId` — the user performing the assignment.
   * Permission rules are enforced by ChatroomManager.setRole (FR-CR-12).
   */
  app.put('/api/chatrooms/:id/roles/:userId', async (req, res) => {
    try {
      const { actorUserId, role } = req.body as { actorUserId?: string; role?: string };
      if (!actorUserId) {
        res.status(400).json({ error: 'actorUserId is required' });
        return;
      }
      if (!role || !VALID_ROLES.includes(role as CommunityRole)) {
        res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
        return;
      }
      const record = await chatroomManager.setRole(
        req.params.id,
        req.params.userId,
        role as CommunityRole,
        actorUserId,
      );
      res.json(record);
    } catch (error) {
      res.status(403).json({ error: (error as Error).message });
    }
  });
}
