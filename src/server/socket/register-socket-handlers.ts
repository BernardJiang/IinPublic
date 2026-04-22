import type { Server, Socket } from 'socket.io';
import SEA from 'gun/sea';
import { logger } from '../logger';
import { ChatroomManager } from '../services/chatroom-manager';
import { TalkService } from '../services/talk-service';
import { UserService } from '../services/user-service';

type SocketDeps = {
  chatroomManager: ChatroomManager;
  talkService: TalkService;
  userService: UserService;
};

type AuthPayload = {
  userId?: string;
  pub?: string;
  signature?: string;
};

type AuthedSocket = Socket & {
  data: {
    userId?: string;
    pub?: string;
  };
};

export function registerSocketHandlers(io: Server, deps: SocketDeps): void {
  const { chatroomManager, talkService, userService } = deps;

  io.on('connection', (socket) => {
    const authedSocket = socket as AuthedSocket;
    logger.info({ socketId: authedSocket.id }, 'User connected');

    authedSocket.on('authenticate', async (data: AuthPayload) => {
      try {
        if (!data?.userId) {
          authedSocket.emit('auth_error', { error: 'userId required' });
          return;
        }
        if (!data.pub || !data.signature) {
          authedSocket.emit('auth_error', { error: 'pub and signature required' });
          authedSocket.disconnect();
          return;
        }
        const verified = await SEA.verify(data.signature, data.pub);
        if (verified !== data.userId) {
          authedSocket.emit('auth_error', { error: 'Invalid signature' });
          authedSocket.disconnect();
          return;
        }
        const user = await userService.getUser(data.userId);
        if (user.pub && user.pub !== data.pub) {
          authedSocket.emit('auth_error', { error: 'Public key mismatch' });
          authedSocket.disconnect();
          return;
        }
        authedSocket.data.userId = user.id;
        authedSocket.data.pub = data.pub;
        authedSocket.emit('authenticated', { user });
      } catch (error) {
        authedSocket.emit('auth_error', { error: (error as Error).message });
        authedSocket.disconnect();
      }
    });

    authedSocket.on('join_chatroom', async (data) => {
      try {
        await chatroomManager.joinChatroom(data.chatroomId, authedSocket.data.userId as string);
        authedSocket.join(data.chatroomId);
        authedSocket.emit('joined_chatroom', { chatroomId: data.chatroomId });
      } catch (error) {
        authedSocket.emit('error', { error: (error as Error).message });
      }
    });

    authedSocket.on('leave_chatroom', async (data) => {
      try {
        await chatroomManager.leaveChatroom(data.chatroomId, authedSocket.data.userId as string);
        authedSocket.leave(data.chatroomId);
        authedSocket.emit('left_chatroom', { chatroomId: data.chatroomId });
      } catch (error) {
        authedSocket.emit('error', { error: (error as Error).message });
      }
    });

    authedSocket.on('move_chatroom', async (data) => {
      try {
        await chatroomManager.moveChatroom(
          authedSocket.data.userId as string,
          data.oldChatroomId,
          data.newChatroomId,
        );
        authedSocket.leave(data.oldChatroomId);
        authedSocket.join(data.newChatroomId);
        authedSocket.emit('moved_chatroom', {
          oldChatroomId: data.oldChatroomId,
          newChatroomId: data.newChatroomId,
        });
      } catch (error) {
        authedSocket.emit('error', { error: (error as Error).message });
      }
    });

    authedSocket.on('send_message', async (data) => {
      try {
        const message = await talkService.processMessage(
          data.conversationId,
          authedSocket.data.userId as string,
          data.message,
        );

        authedSocket.to(data.conversationId).emit('new_message', message);
      } catch (error) {
        authedSocket.emit('error', { error: (error as Error).message });
      }
    });

    authedSocket.on('answer_question', async (data) => {
      try {
        const result = await talkService.processAnswer(
          data.conversationId,
          data.questionId,
          data.answerId,
          authedSocket.data.userId as string,
        );

        authedSocket.emit('question_answered', result);

        if (result.isComplete) {
          authedSocket.emit('talk_completed', {
            conversationId: data.conversationId,
            result: result.outcome,
            talkId: result.talkId,
            matchId: result.matchId,
          });

          if (result.outcome === 'match') {
            authedSocket.emit('talk_matched', {
              conversationId: data.conversationId,
              talkId: result.talkId,
              matchId: result.matchId,
            });
          }
        }
      } catch (error) {
        authedSocket.emit('error', { error: (error as Error).message });
      }
    });

    authedSocket.on('update_location', async (data) => {
      try {
        await userService.updateUserLocation(authedSocket.data.userId as string, data.location);

        const newChatroom = await chatroomManager.findOptimalChatroom(data.location);
        if (newChatroom) {
          authedSocket.emit('chatroom_suggestion', { chatroomId: newChatroom });
        }
      } catch (error) {
        authedSocket.emit('error', { error: (error as Error).message });
      }
    });

    authedSocket.on('disconnect', () => {
      logger.info({ socketId: authedSocket.id }, 'User disconnected');
      if (authedSocket.data.userId) {
        userService.setUserOffline(authedSocket.data.userId);
      }
    });
  });
}
