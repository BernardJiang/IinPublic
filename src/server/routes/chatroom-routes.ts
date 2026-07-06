import type express from 'express';
import { ChatroomManager } from '../services/chatroom-manager';
import type { CommunityRole } from '../../shared/types';
import {
  runChallengeGate,
  type ChallengeGateConfig,
  type ChallengeContext,
  type GatedAction,
} from '../../shared/challenge-plugins';

const VALID_ROLES: CommunityRole[] = ['owner', 'moderator', 'member', 'guest'];

type RegisterChatroomRoutesDeps = {
  chatroomManager: ChatroomManager;
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
  { chatroomManager, resolveChallengeGate }: RegisterChatroomRoutesDeps,
): void {
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
      const { id, name, type, createdBy, description, capacity, businessInfo } = req.body as {
        id?: string;
        name: string;
        type: 'business' | 'custom';
        createdBy: string;
        description?: string;
        capacity?: number;
        businessInfo?: unknown;
      };
      if (!name || !type || !createdBy) {
        res.status(400).json({ error: 'name, type, and createdBy are required' });
        return;
      }
      if (type !== 'business' && type !== 'custom') {
        res.status(400).json({ error: 'type must be business or custom' });
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
      } = { name, type, createdBy };
      if (id != null) createPayload.id = id;
      if (description != null) createPayload.description = description;
      if (capacity != null) createPayload.capacity = capacity;
      if (businessInfo != null) createPayload.businessInfo = businessInfo;
      const created = await chatroomManager.createChatroom(createPayload);
      res.status(201).json(created);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.patch('/api/chatrooms/:id', async (req, res) => {
    try {
      const { userId, name, description, isActive, capacity } = req.body as {
        userId: string;
        name?: string;
        description?: string;
        isActive?: boolean;
        capacity?: number;
      };
      if (!userId) {
        res.status(400).json({ error: 'userId is required' });
        return;
      }
      const updates: { name?: string; description?: string; isActive?: boolean; capacity?: number } = {};
      if (name != null) updates.name = name;
      if (description != null) updates.description = description;
      if (isActive != null) updates.isActive = isActive;
      if (capacity != null) updates.capacity = capacity;
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
      const members = await chatroomManager.getActiveMembersWithStageName(req.params.id);
      res.json(members);
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
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.delete('/api/chatrooms/:id/members/:userId', async (req, res) => {
    try {
      await chatroomManager.leaveChatroom(req.params.id, req.params.userId);
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
