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
    this.app.use(Gun.serve);
  }

  private initializeServices(): void {
    this.gunService = new GunService(this.gun); // Pass the Gun instance
    this.userService = new UserService(this.gunService);
    this.reputationService = new ReputationService(this.gunService);
    this.chatroomManager = new ChatroomManager(this.gunService);
    this.talkService = new TalkService(this.gunService, this.chatroomManager);
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
            });
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
