import type express from 'express';
import { ChatroomManager } from '../services/chatroom-manager';

type RegisterChatroomRoutesDeps = {
  chatroomManager: ChatroomManager;
};

export function registerChatroomRoutes(
  app: express.Application,
  { chatroomManager }: RegisterChatroomRoutesDeps,
): void {
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
      await chatroomManager.joinChatroom(req.params.id, req.body.userId);
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
      await chatroomManager.joinChatroom(req.params.id, userId, stageName);
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
}
