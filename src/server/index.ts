import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import Gun from 'gun';
import { GunService } from './services/gun-service';
import { ChatroomManager } from './services/chatroom-manager';
import { TalkService } from './services/talk-service';
import { UserService } from './services/user-service';
import { ReputationService } from './services/reputation-service';
import { checkIfMatch } from '../shared/talk-engine';

class IinPublicServer {
  private app: express.Application;
  private server: any;
  private io: Server;
  private gun: any;
  private gunService!: GunService;
  private chatroomManager!: ChatroomManager;
  private talkService!: TalkService;
  private userService!: UserService;
  private reputationService!: ReputationService;

  constructor() {
    this.app = express();
    this.server = createServer(this.app);

    this.io = new Server(this.server, {
      cors: {
        origin:
          process.env.NODE_ENV === 'production'
            ? ['https://iinpublic.com']
            : ['http://localhost:3000', 'http://localhost:3001'],
        methods: ['GET', 'POST'],
      },
    });

    this.setupMiddleware();
    this.setupGun();
    this.initializeServices();
    this.setupRoutes();
    this.setupSocketHandlers();
  }

  private setupGun(): void {
    // Initialize Gun and attach to HTTP server
    this.gun = Gun({
      web: this.server,
      localStorage: false, // Server doesn't need localStorage
      radisk: true, // Enable disk persistence on server
    });
    console.log('🔫 Gun.js attached to HTTP server');
  }

  private setupMiddleware(): void {
    this.app.use(
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "'unsafe-eval'"], // Gun.js needs eval
            imgSrc: ["'self'", 'data:', 'https:'],
            connectSrc: ["'self'", 'ws:', 'wss:'],
          },
        },
      }),
    );

    this.app.use(
      cors({
        origin:
          process.env.NODE_ENV === 'production'
            ? ['https://iinpublic.com']
            : ['http://localhost:3000', 'http://localhost:3001'],
        credentials: true,
      }),
    );

    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // Serve static files from project root (for gun-test.html)
    this.app.use(express.static('.'));

    // Gun.js HTTP endpoint - served by Gun({ web: this.server })
    this.app.use((Gun as any).serve);
  }

  private initializeServices(): void {
    this.gunService = new GunService(this.gun); // Pass the Gun instance
    this.userService = new UserService(this.gunService);
    this.reputationService = new ReputationService(this.gunService);
    this.chatroomManager = new ChatroomManager(this.gunService);
    this.talkService = new TalkService(this.gunService, this.reputationService);
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (_req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // User routes
    this.app.post('/api/users', async (_req, res) => {
      try {
        const user = await this.userService.createUser(_req.body);
        res.json(user);
      } catch (error) {
        res.status(400).json({ error: (error as Error).message });
      }
    });

    this.app.get('/api/users/:id', async (_req, res) => {
      try {
        const user = await this.userService.getUser(_req.params.id);
        res.json(user);
      } catch (error) {
        res.status(404).json({ error: (error as Error).message });
      }
    });

    // Talk routes
    this.app.post('/api/talks', async (req, res) => {
      try {
        const talk = await this.talkService.createTalk(req.body);
        res.json(talk);
      } catch (error) {
        res.status(400).json({ error: (error as Error).message });
      }
    });

    this.app.post('/api/talks/:id/send', async (req, res) => {
      try {
        const job = await this.talkService.sendBulkTalk(
          req.params.id,
          req.body.senderId,
          req.body.targetScope,
          req.body.maxRecipients,
        );
        res.json(job);
      } catch (error) {
        res.status(400).json({ error: (error as Error).message });
      }
    });

    // Talk response: backend runs match logic and creates conversation if match (frontend only sends payload and updates UI)
    this.app.post('/api/talks/:id/response', async (req, res) => {
      try {
        const talkId = req.params.id;
        const { responderId, responderName, answers, talkData: bodyTalkData } = req.body as {
          responderId: string;
          responderName?: string;
          answers: Array<{ questionId: string; answerId: string; answerText?: string; isChecked?: boolean }>;
          talkData?: unknown;
        };
        if (!responderId || !Array.isArray(answers)) {
          res.status(400).json({ error: 'responderId and answers required' });
          return;
        }
        let talkData: any = null;
        const rawTalk = await this.gunService.getPath(['talks', talkId]);
        if (rawTalk) {
          talkData =
            typeof rawTalk.data === 'string'
              ? JSON.parse(rawTalk.data)
              : rawTalk.data || rawTalk;
        } else if (bodyTalkData != null) {
          // Fallback: client may send talkData when Gun sync hasn't delivered the talk yet (e.g. e2e)
          talkData =
            typeof bodyTalkData === 'string'
              ? JSON.parse(bodyTalkData as string)
              : bodyTalkData;
        }
        if (!talkData) {
          res.status(404).json({ error: 'Talk not found' });
          return;
        }
        const normalizedAnswers =
          talkData.type === 'tag'
            ? answers.map((answer) => {
                const question = talkData.questions?.find((q: any) => q.id === answer.questionId);
                const selected = question?.answers?.find((a: any) => a.id === answer.answerId);
                const isChecked = selected?.isMatch === true;
                const answerText = answer.answerText ?? selected?.text;
                return { ...answer, answerText, isChecked };
              })
            : answers;

        if (talkData.type === 'tag') {
          const responseId = `resp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
          await this.gunService.putPath(['talks', talkId, 'responses', responseId], {
            responderId,
            responderName: responderName || 'Someone',
            answers: JSON.stringify(normalizedAnswers),
            submittedAt: new Date().toISOString(),
            isChatbotResponse: false,
            backendRecorded: true,
          });
        }

        const isMatch = checkIfMatch(talkData, normalizedAnswers);
        if (!isMatch) {
          res.json({ isMatch: false });
          return;
        }
        const authorId = talkData.authorId;
        if (!authorId) {
          res.json({ isMatch: true, conversationId: null, otherUserId: null, otherUserName: 'Someone' });
          return;
        }
        const authorNode = await this.gunService.getPath(['users', authorId]);
        const authorName =
          (authorNode?.stageName ?? authorNode?.data?.stageName) || 'Someone';
        const sortedIds = [responderId, authorId].sort();
        const conversationId = `conv_${sortedIds[0]}_${sortedIds[1]}_${talkId}`;
        const conversationData = {
          id: conversationId,
          participants: [responderId, authorId],
          talkId,
          createdAt: new Date().toISOString(),
          status: 'active',
        };
        await this.gunService.putPath(['conversations', conversationId], {
          data: JSON.stringify(conversationData),
        });
        await this.gunService.putPath(['users', responderId, 'conversations', conversationId], {
          conversationId,
          otherUserId: authorId,
          otherUserName: authorName,
          talkId,
          createdAt: new Date().toISOString(),
        });
        await this.gunService.putPath(['users', authorId, 'conversations', conversationId], {
          conversationId,
          otherUserId: responderId,
          otherUserName: responderName || 'Someone',
          talkId,
          createdAt: new Date().toISOString(),
        });
        res.json({
          isMatch: true,
          conversationId,
          otherUserId: authorId,
          otherUserName: authorName,
        });
      } catch (error) {
        console.error('Talk response error:', error);
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Chatroom routes
    this.app.get('/api/chatrooms', async (_req, res) => {
      try {
        const chatrooms = await this.chatroomManager.getAllChatrooms();
        res.json(chatrooms);
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    this.app.post('/api/chatrooms/:id/join', async (req, res) => {
      try {
        await this.chatroomManager.joinChatroom(req.params.id, req.body.userId);
        res.json({ success: true });
      } catch (error) {
        res.status(400).json({ error: (error as Error).message });
      }
    });

    // Survey routes
    this.app.get('/api/surveys/:id/results', async (_req, res) => {
      try {
        const results = await this.talkService.getSurveyResults(_req.params.id);
        res.json(results);
      } catch (error) {
        res.status(404).json({ error: (error as Error).message });
      }
    });

    // Location privacy validation endpoint
    this.app.post('/api/validate-privacy', (_req, res) => {
      try {
        // This would validate that no high-precision location data is being sent
        res.json({ valid: true });
      } catch (error) {
        res.status(400).json({ error: (error as Error).message });
      }
    });

    // Test-only endpoint to clear Gun.js in-memory database
    if (process.env.NODE_ENV !== 'production') {
      this.app.post('/api/test/clear-database', (_req, res) => {
        try {
          // Clear Gun.js in-memory graph
          // Gun stores data in gun._.graph which is the in-memory cache
          if (this.gun && this.gun._ && this.gun._.graph) {
            console.log('🧹 Clearing Gun.js in-memory database...');
            // Create a new empty graph
            this.gun._.graph = {};
            console.log('✅ Gun.js in-memory database cleared');
            res.json({ success: true, message: 'Gun.js in-memory database cleared' });
          } else {
            res.status(500).json({ error: 'Gun.js graph not accessible' });
          }
        } catch (error) {
          console.error('Error clearing Gun.js database:', error);
          res.status(500).json({ error: (error as Error).message });
        }
      });
    }
  }

  private setupSocketHandlers(): void {
    this.io.on('connection', (socket) => {
      console.log(`User connected: ${socket.id}`);

      // User authentication and setup
      socket.on('authenticate', async (data) => {
        try {
          const user = await this.userService.getUser(data.userId);
          socket.data.userId = user.id;
          socket.emit('authenticated', { user });
        } catch (error) {
          socket.emit('auth_error', { error: (error as Error).message });
        }
      });

      // Chatroom management
      socket.on('join_chatroom', async (data) => {
        try {
          await this.chatroomManager.joinChatroom(data.chatroomId, socket.data.userId);
          socket.join(data.chatroomId);
          socket.emit('joined_chatroom', { chatroomId: data.chatroomId });
        } catch (error) {
          socket.emit('error', { error: (error as Error).message });
        }
      });

      socket.on('leave_chatroom', async (data) => {
        try {
          await this.chatroomManager.leaveChatroom(data.chatroomId, socket.data.userId);
          socket.leave(data.chatroomId);
          socket.emit('left_chatroom', { chatroomId: data.chatroomId });
        } catch (error) {
          socket.emit('error', { error: (error as Error).message });
        }
      });

      socket.on('move_chatroom', async (data) => {
        try {
          await this.chatroomManager.moveChatroom(socket.data.userId, data.oldChatroomId, data.newChatroomId);
          socket.leave(data.oldChatroomId);
          socket.join(data.newChatroomId);
          socket.emit('moved_chatroom', { oldChatroomId: data.oldChatroomId, newChatroomId: data.newChatroomId });
        } catch (error) {
          socket.emit('error', { error: (error as Error).message });
        }
      });

      // Real-time messaging
      socket.on('send_message', async (data) => {
        try {
          // Process message through filters and validation
          const message = await this.talkService.processMessage(
            data.conversationId,
            socket.data.userId,
            data.message,
          );

          // Emit to conversation participants
          socket.to(data.conversationId).emit('new_message', message);
        } catch (error) {
          socket.emit('error', { error: (error as Error).message });
        }
      });

      // Talk execution
      socket.on('answer_question', async (data) => {
        try {
          const result = await this.talkService.processAnswer(
            data.conversationId,
            data.questionId,
            data.answerId,
            socket.data.userId,
          );

          socket.emit('question_answered', result);

          if (result.isComplete) {
            socket.emit('talk_completed', {
              conversationId: data.conversationId,
              result: result.outcome,
              talkId: result.talkId,
              matchId: result.matchId,
            });

            // For match outcomes, emit a dedicated event so clients can react explicitly
            if (result.outcome === 'match') {
              socket.emit('talk_matched', {
                conversationId: data.conversationId,
                talkId: result.talkId,
                matchId: result.matchId,
              });
            }
          }
        } catch (error) {
          socket.emit('error', { error: (error as Error).message });
        }
      });

      // Location updates
      socket.on('update_location', async (data) => {
        try {
          await this.userService.updateUserLocation(socket.data.userId, data.location);

          // Check if user needs to be moved to different chatroom
          const newChatroom = await this.chatroomManager.findOptimalChatroom(data.location);
          if (newChatroom) {
            socket.emit('chatroom_suggestion', { chatroomId: newChatroom });
          }
        } catch (error) {
          socket.emit('error', { error: (error as Error).message });
        }
      });

      socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        if (socket.data.userId) {
          this.userService.setUserOffline(socket.data.userId);
        }
      });
    });
  }

  public start(port: number = 8080): void {
    this.server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\n❌ Port ${port} is already in use.`);
        console.error('   Stop the other process using the port, or use a different PORT.');
        console.error('   Example: PORT=8081 npm run dev:server\n');
        process.exit(1);
      }
      throw err;
    });
    this.server.listen(port, () => {
      console.log(`🚀 IinPublic server running on port ${port}`);
      console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🔄 Gun.js peer network active`);
    });
  }
}

// Start server
if (require.main === module) {
  const server = new IinPublicServer();
  const port = process.env.PORT ? parseInt(process.env.PORT) : 8080;
  server.start(port);
}

export default IinPublicServer;
