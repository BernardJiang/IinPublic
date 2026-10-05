import type express from 'express';
import { ChatroomManager } from '../services/chatroom-manager';
import type {
  EmbeddedHubRelayClientLike,
  RelayRoomMember,
} from '../../node-app/embedded-hub-relay-client';
import { isValidChatroomMapLocation } from '../../shared/chatroom-map-geojson';
import type { ChatroomMapLocation } from '../../shared/chatroom-map-locations';

type RegisterChatroomRoutesDeps = {
  chatroomManager: ChatroomManager;
  /**
   * S3 native explicit relay mode: embedded local nodes keep app graph local,
   * but mirror room-membership metadata to the configured upstream hub.
   */
  hubRelayClient?: EmbeddedHubRelayClientLike;
};

export function registerChatroomRoutes(
  app: express.Application,
  { chatroomManager, hubRelayClient }: RegisterChatroomRoutesDeps,
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
      const { name, type, createdBy, description, businessInfo, location } = req.body as {
        name: string;
        type: 'business' | 'custom';
        createdBy: string;
        description?: string;
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
        name: string;
        type: 'business' | 'custom';
        createdBy: string;
        description?: string;
        businessInfo?: unknown;
        location?: ChatroomMapLocation;
      } = { name, type, createdBy };
      if (description != null) createPayload.description = description;
      if (businessInfo != null) createPayload.businessInfo = businessInfo;
      if (location != null) createPayload.location = location;
      const created = await chatroomManager.createChatroom(createPayload);
      res.status(201).json(created);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.patch('/api/chatrooms/:id', async (_req, res) => {
    res.status(410).json({ error: 'room descriptors are immutable; publish a new room descriptor' });
  });

  app.delete('/api/chatrooms/:id', async (_req, res) => {
    res.status(410).json({ error: 'rooms have no owner and cannot be deleted by a participant' });
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

  app.get('/api/chatrooms/:id/roles/:userId', async (_req, res) => {
    res.status(410).json({ error: 'room roles were retired; all participants are ordinary peers' });
  });

  /** Retired compatibility endpoint; room participants have no assignable roles. */
  app.put('/api/chatrooms/:id/roles/:userId', async (_req, res) => {
    res.status(410).json({ error: 'room roles were retired; all participants are ordinary peers' });
  });
}
