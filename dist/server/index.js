"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const gun_service_1 = require("./services/gun-service");
const chatroom_manager_1 = require("./services/chatroom-manager");
const talk_service_1 = require("./services/talk-service");
const user_service_1 = require("./services/user-service");
const reputation_service_1 = require("./services/reputation-service");
class IinPublicServer {
    app;
    server;
    io;
    gunService;
    chatroomManager;
    talkService;
    userService;
    reputationService;
    constructor() {
        this.app = (0, express_1.default)();
        this.server = (0, http_1.createServer)(this.app);
        this.io = new socket_io_1.Server(this.server, {
            cors: {
                origin: process.env.NODE_ENV === 'production'
                    ? ['https://iinpublic.com']
                    : ['http://localhost:3000'],
                methods: ['GET', 'POST']
            }
        });
        this.setupMiddleware();
        this.initializeServices();
        this.setupRoutes();
        this.setupSocketHandlers();
    }
    setupMiddleware() {
        this.app.use((0, helmet_1.default)({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    scriptSrc: ["'self'", "'unsafe-eval'"], // Gun.js needs eval
                    imgSrc: ["'self'", "data:", "https:"],
                    connectSrc: ["'self'", "ws:", "wss:"]
                }
            }
        }));
        this.app.use((0, cors_1.default)({
            origin: process.env.NODE_ENV === 'production'
                ? ['https://iinpublic.com']
                : ['http://localhost:3000'],
            credentials: true
        }));
        this.app.use(express_1.default.json({ limit: '10mb' }));
        this.app.use(express_1.default.urlencoded({ extended: true }));
        // Gun.js middleware - simplified for now
        // this.app.use(Gun.serve);
    }
    initializeServices() {
        this.gunService = new gun_service_1.GunService();
        this.userService = new user_service_1.UserService(this.gunService);
        this.reputationService = new reputation_service_1.ReputationService(this.gunService);
        this.chatroomManager = new chatroom_manager_1.ChatroomManager(this.gunService);
        this.talkService = new talk_service_1.TalkService(this.gunService, this.reputationService);
    }
    setupRoutes() {
        // Health check
        this.app.get('/health', (_req, res) => {
            res.json({ status: 'ok', timestamp: new Date().toISOString() });
        });
        // User routes
        this.app.post('/api/users', async (_req, res) => {
            try {
                const user = await this.userService.createUser(_req.body);
                res.json(user);
            }
            catch (error) {
                res.status(400).json({ error: error.message });
            }
        });
        this.app.get('/api/users/:id', async (_req, res) => {
            try {
                const user = await this.userService.getUser(_req.params.id);
                res.json(user);
            }
            catch (error) {
                res.status(404).json({ error: error.message });
            }
        });
        // Talk routes
        this.app.post('/api/talks', async (req, res) => {
            try {
                const talk = await this.talkService.createTalk(req.body);
                res.json(talk);
            }
            catch (error) {
                res.status(400).json({ error: error.message });
            }
        });
        this.app.post('/api/talks/:id/send', async (req, res) => {
            try {
                const job = await this.talkService.sendBulkTalk(req.params.id, req.body.senderId, req.body.targetScope, req.body.maxRecipients);
                res.json(job);
            }
            catch (error) {
                res.status(400).json({ error: error.message });
            }
        });
        // Chatroom routes
        this.app.get('/api/chatrooms', async (_req, res) => {
            try {
                const chatrooms = await this.chatroomManager.getAllChatrooms();
                res.json(chatrooms);
            }
            catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        this.app.post('/api/chatrooms/:id/join', async (req, res) => {
            try {
                await this.chatroomManager.joinChatroom(req.params.id, req.body.userId);
                res.json({ success: true });
            }
            catch (error) {
                res.status(400).json({ error: error.message });
            }
        });
        // Survey routes
        this.app.get('/api/surveys/:id/results', async (_req, res) => {
            try {
                const results = await this.talkService.getSurveyResults(_req.params.id);
                res.json(results);
            }
            catch (error) {
                res.status(404).json({ error: error.message });
            }
        });
        // Location privacy validation endpoint
        this.app.post('/api/validate-privacy', (_req, res) => {
            try {
                // This would validate that no high-precision location data is being sent
                res.json({ valid: true });
            }
            catch (error) {
                res.status(400).json({ error: error.message });
            }
        });
    }
    setupSocketHandlers() {
        this.io.on('connection', (socket) => {
            console.log(`User connected: ${socket.id}`);
            // User authentication and setup
            socket.on('authenticate', async (data) => {
                try {
                    const user = await this.userService.getUser(data.userId);
                    socket.data.userId = user.id;
                    socket.emit('authenticated', { user });
                }
                catch (error) {
                    socket.emit('auth_error', { error: error.message });
                }
            });
            // Chatroom management
            socket.on('join_chatroom', async (data) => {
                try {
                    await this.chatroomManager.joinChatroom(data.chatroomId, socket.data.userId);
                    socket.join(data.chatroomId);
                    socket.emit('joined_chatroom', { chatroomId: data.chatroomId });
                }
                catch (error) {
                    socket.emit('error', { error: error.message });
                }
            });
            socket.on('leave_chatroom', async (data) => {
                try {
                    await this.chatroomManager.leaveChatroom(data.chatroomId, socket.data.userId);
                    socket.leave(data.chatroomId);
                    socket.emit('left_chatroom', { chatroomId: data.chatroomId });
                }
                catch (error) {
                    socket.emit('error', { error: error.message });
                }
            });
            // Real-time messaging
            socket.on('send_message', async (data) => {
                try {
                    // Process message through filters and validation
                    const message = await this.talkService.processMessage(data.conversationId, socket.data.userId, data.message);
                    // Emit to conversation participants
                    socket.to(data.conversationId).emit('new_message', message);
                }
                catch (error) {
                    socket.emit('error', { error: error.message });
                }
            });
            // Talk execution
            socket.on('answer_question', async (data) => {
                try {
                    const result = await this.talkService.processAnswer(data.conversationId, data.questionId, data.answerId, socket.data.userId);
                    socket.emit('question_answered', result);
                    if (result.isComplete) {
                        socket.emit('talk_completed', {
                            conversationId: data.conversationId,
                            result: result.outcome
                        });
                    }
                }
                catch (error) {
                    socket.emit('error', { error: error.message });
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
                }
                catch (error) {
                    socket.emit('error', { error: error.message });
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
    start(port = 8080) {
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
exports.default = IinPublicServer;
//# sourceMappingURL=index.js.map