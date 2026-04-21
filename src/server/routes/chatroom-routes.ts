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
}
