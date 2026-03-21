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
const gun_1 = __importDefault(require("gun"));
const gun_service_1 = require("./services/gun-service");
const chatroom_manager_1 = require("./services/chatroom-manager");
const talk_service_1 = require("./services/talk-service");
const user_service_1 = require("./services/user-service");
const reputation_service_1 = require("./services/reputation-service");
const talk_engine_1 = require("../shared/talk-engine");
class IinPublicServer {
    app;
    server;
    io;
    gun;
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
    setupGun() {
        // Initialize Gun and attach to HTTP server
        this.gun = (0, gun_1.default)({
            web: this.server,
            localStorage: false, // Server doesn't need localStorage
            radisk: true, // Enable disk persistence on server
        });
        console.log('🔫 Gun.js attached to HTTP server');
    }
    setupMiddleware() {
        this.app.use((0, helmet_1.default)({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    scriptSrc: ["'self'", "'unsafe-eval'"], // Gun.js needs eval
                    imgSrc: ["'self'", 'data:', 'https:'],
                    connectSrc: ["'self'", 'ws:', 'wss:'],
                },
            },
        }));
        this.app.use((0, cors_1.default)({
            origin: process.env.NODE_ENV === 'production'
                ? ['https://iinpublic.com']
                : ['http://localhost:3000', 'http://localhost:3001'],
            credentials: true,
        }));
        this.app.use(express_1.default.json({ limit: '10mb' }));
        this.app.use(express_1.default.urlencoded({ extended: true }));
        // Serve static files from project root (for gun-test.html)
        this.app.use(express_1.default.static('.'));
        // Gun.js HTTP endpoint - served by Gun({ web: this.server })
        this.app.use(gun_1.default.serve);
    }
    initializeServices() {
        this.gunService = new gun_service_1.GunService(this.gun); // Pass the Gun instance
        this.userService = new user_service_1.UserService(this.gunService);
        this.reputationService = new reputation_service_1.ReputationService(this.gunService);
        this.chatroomManager = new chatroom_manager_1.ChatroomManager(this.gunService);
        this.talkService = new talk_service_1.TalkService(this.gunService, this.reputationService);
    }
    normalizeIdentityText(input) {
        return String(input ?? '')
            .trim()
            .replace(/\s+/g, ' ')
            .toLowerCase();
    }
    hashIdentityPayload(payload) {
        let hash = 0x811c9dc5;
        for (let i = 0; i < payload.length; i += 1) {
            hash ^= payload.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
    }
    buildIdentityPayloadFromTalk(talkData) {
        const type = this.normalizeIdentityText(talkData?.type || 'matching');
        const questions = (Array.isArray(talkData?.questions)
            ? talkData.questions.map((q) => ({
                text: this.normalizeIdentityText(q?.text),
                answers: (Array.isArray(q?.answers) ? q.answers : [])
                    .map((a) => this.normalizeIdentityText(a?.text))
                    .sort(),
            }))
            : [])
            .sort((a, b) => String(a.text).localeCompare(String(b.text)));
        return { type, questions };
    }
    buildTalkIdentityKey(talkData) {
        const payload = this.buildIdentityPayloadFromTalk(talkData);
        const payloadJson = JSON.stringify(payload);
        return `qa_${this.hashIdentityPayload(payloadJson)}`;
    }
    canonicalIdentityKeyFromStoredCluster(cluster) {
        if (!cluster)
            return this.buildTalkIdentityKey({ type: 'matching', questions: [] });
        const key = typeof cluster.identityKey === 'string' ? cluster.identityKey : '';
        if (key.startsWith('qa_')) {
            return key;
        }
        if (key) {
            try {
                const parsed = JSON.parse(key);
                const payload = {
                    type: this.normalizeIdentityText(parsed?.type ?? cluster?.type ?? 'matching'),
                    questions: (Array.isArray(parsed?.questions)
                        ? parsed.questions.map((q) => ({
                            text: this.normalizeIdentityText(q?.text),
                            answers: (Array.isArray(q?.answers) ? q.answers : [])
                                .map((a) => this.normalizeIdentityText(a))
                                .sort(),
                        }))
                        : [])
                        .sort((a, b) => String(a.text).localeCompare(String(b.text))),
                };
                return `qa_${this.hashIdentityPayload(JSON.stringify(payload))}`;
            }
            catch {
                // fall through
            }
        }
        return this.buildTalkIdentityKey(cluster);
    }
    async getMergedIncomingClusterForUser(userId, identityKey) {
        const incoming = await this.gunService.getPath(['incomingTalksByUser', userId]);
        const merged = {
            identityKey,
            title: '',
            type: 'matching',
            questionCount: 0,
            senders: {},
            talkIds: {},
            updatedAt: new Date(0).toISOString(),
            identityAliases: { [identityKey]: true },
        };
        if (!incoming || typeof incoming !== 'object') {
            return merged;
        }
        for (const [rawKey, rawCluster] of Object.entries(incoming)) {
            if (rawKey.startsWith('_') || !rawCluster)
                continue;
            const cluster = rawCluster;
            const canonical = this.canonicalIdentityKeyFromStoredCluster(cluster);
            if (canonical !== identityKey)
                continue;
            merged.identityAliases[rawKey] = true;
            if (cluster?.identityKey) {
                merged.identityAliases[cluster.identityKey] = true;
            }
            const clusterSenders = cluster?.senders && typeof cluster.senders === 'object' ? cluster.senders : {};
            const clusterTalkIds = cluster?.talkIds && typeof cluster.talkIds === 'object' ? cluster.talkIds : {};
            merged.senders = { ...merged.senders, ...clusterSenders };
            merged.talkIds = { ...merged.talkIds, ...clusterTalkIds };
            merged.questionCount = Math.max(Number(merged.questionCount || 0), Number(cluster?.questionCount || 0));
            const clusterUpdatedAt = new Date(cluster?.updatedAt || 0).getTime();
            const mergedUpdatedAt = new Date(merged.updatedAt || 0).getTime();
            if (clusterUpdatedAt >= mergedUpdatedAt) {
                merged.updatedAt = cluster?.updatedAt || merged.updatedAt;
                merged.type = cluster?.type || merged.type;
            }
        }
        const latestTalkId = Object.entries(merged.talkIds || {})
            .sort(([, a], [, b]) => new Date(String(b || 0)).getTime() - new Date(String(a || 0)).getTime())
            .map(([id]) => id)[0];
        if (latestTalkId) {
            const latestTalk = await this.loadTalkDataFromGraphOrBody(latestTalkId);
            merged.title = latestTalk?.title || merged.title || '';
            merged.type = latestTalk?.type || merged.type;
            merged.questionCount = Array.isArray(latestTalk?.questions)
                ? latestTalk.questions.length
                : merged.questionCount;
        }
        return merged;
    }
    async loadTalkDataFromGraphOrBody(talkId, bodyTalkData) {
        const rawTalk = await this.gunService.getPath(['talks', talkId]);
        if (rawTalk) {
            if (typeof rawTalk.data === 'string') {
                return JSON.parse(rawTalk.data);
            }
            return rawTalk.data || rawTalk;
        }
        if (bodyTalkData != null) {
            return typeof bodyTalkData === 'string' ? JSON.parse(bodyTalkData) : bodyTalkData;
        }
        return null;
    }
    normalizeSubmittedAnswersForTalk(talkData, answers) {
        if (talkData?.type !== 'tag')
            return answers;
        return answers.map((answer) => {
            const question = talkData.questions?.find((q) => q.id === answer.questionId);
            const selected = question?.answers?.find((a) => a.id === answer.answerId);
            const isChecked = selected?.isMatch === true;
            const answerText = answer.answerText ?? selected?.text;
            return { ...answer, answerText, isChecked };
        });
    }
    buildAnswerTemplateEntries(talkData, answers) {
        const questions = Array.isArray(talkData?.questions) ? talkData.questions : [];
        return answers.map((answer) => {
            const question = questions.find((q) => q.id === answer.questionId);
            const selected = question?.answers?.find((a) => a.id === answer.answerId);
            return {
                questionText: String(question?.text || '').trim(),
                answerText: String(answer.answerText ?? selected?.text ?? '').trim(),
                mode: String(answer.mode || 'manual'),
                isChecked: answer.isChecked === true || selected?.isMatch === true,
            };
        });
    }
    mapTemplateEntriesToTalk(templateEntries, talkData) {
        const questions = Array.isArray(talkData?.questions) ? talkData.questions : [];
        const mapped = [];
        for (const entry of templateEntries || []) {
            const qText = this.normalizeIdentityText(entry.questionText);
            const aText = this.normalizeIdentityText(entry.answerText);
            const question = questions.find((q) => this.normalizeIdentityText(q?.text) === qText);
            if (!question)
                continue;
            const answer = (Array.isArray(question.answers) ? question.answers : []).find((a) => this.normalizeIdentityText(a?.text) === aText);
            if (!answer)
                continue;
            mapped.push({
                questionId: question.id,
                answerId: answer.id,
                answerText: answer.text,
                isChecked: entry.isChecked === true || answer.isMatch === true,
                mode: entry.mode || 'manual',
            });
        }
        return this.normalizeSubmittedAnswersForTalk(talkData, mapped);
    }
    deriveIsAutoAnswerSet(answers, explicitIsAuto, isChatbotResponse) {
        if (explicitIsAuto != null)
            return !!explicitIsAuto;
        if (isChatbotResponse)
            return true;
        if (!Array.isArray(answers) || answers.length === 0)
            return false;
        return answers.every((a) => String(a?.mode || '').toLowerCase() === 'auto');
    }
    async getUserStageName(userId, fallback) {
        const userNode = await this.gunService.getPath(['users', userId]);
        return (userNode?.stageName ?? userNode?.data?.stageName ?? fallback ?? 'Someone');
    }
    async upsertIncomingTalkForUser(params) {
        const { receiverId, talkId, talkData, senderId, senderName } = params;
        const identityKey = this.buildTalkIdentityKey(talkData);
        const existing = await this.getMergedIncomingClusterForUser(receiverId, identityKey);
        const nowIso = new Date().toISOString();
        const senderMap = existing.senders && typeof existing.senders === 'object' ? existing.senders : {};
        const talkIds = existing.talkIds && typeof existing.talkIds === 'object' ? existing.talkIds : {};
        senderMap[senderId] = {
            senderId,
            senderName: senderName || senderMap[senderId]?.senderName || 'Someone',
            lastTalkId: talkId,
            lastReceivedAt: nowIso,
        };
        talkIds[talkId] = nowIso;
        const cluster = {
            identityKey,
            title: talkData?.title || existing.title || '',
            type: talkData?.type || existing.type || 'matching',
            questionCount: Array.isArray(talkData?.questions) ? talkData.questions.length : existing.questionCount || 0,
            senders: senderMap,
            talkIds,
            updatedAt: nowIso,
            identityAliases: existing.identityAliases && typeof existing.identityAliases === 'object' ? existing.identityAliases : { [identityKey]: true },
        };
        await this.gunService.putPath(['incomingTalksByUser', receiverId, identityKey], cluster);
        if (existing.identityAliases && typeof existing.identityAliases === 'object') {
            for (const alias of Object.keys(existing.identityAliases)) {
                if (alias && alias !== identityKey) {
                    await this.gunService.putPath(['incomingTalksByUser', receiverId, alias], cluster);
                }
            }
        }
        await this.gunService.putPath(['talkIdentityById', talkId], { identityKey, updatedAt: nowIso });
        await this.gunService.putPath(['incomingTalkIdentityByUserAndTalkId', receiverId, talkId], {
            identityKey,
            updatedAt: nowIso,
        });
        return { identityKey, cluster };
    }
    async getClusterSenders(params) {
        const { responderId, identityKey, fallbackTalkId, fallbackSenderId } = params;
        const cluster = await this.getMergedIncomingClusterForUser(responderId, identityKey);
        const list = [];
        const seen = new Set();
        if (cluster?.senders && typeof cluster.senders === 'object') {
            for (const sender of Object.values(cluster.senders)) {
                const senderId = sender?.senderId;
                if (!senderId || senderId === responderId || seen.has(senderId))
                    continue;
                seen.add(senderId);
                list.push({
                    senderId,
                    senderName: sender?.senderName || 'Someone',
                    talkId: sender?.lastTalkId || fallbackTalkId,
                });
            }
        }
        if (fallbackSenderId && fallbackSenderId !== responderId && !seen.has(fallbackSenderId)) {
            seen.add(fallbackSenderId);
            const fallbackName = await this.getUserStageName(fallbackSenderId, 'Someone');
            list.push({ senderId: fallbackSenderId, senderName: fallbackName, talkId: fallbackTalkId });
        }
        return list;
    }
    async saveUserAnswerTemplateByContent(params) {
        const { responderId, responderName, identityKey, answers, templateEntries, isAuto } = params;
        await this.gunService.putPath(['talkAnswerTemplateByUser', responderId, identityKey], {
            responderId,
            responderName,
            answers: JSON.stringify(answers),
            templateEntries: JSON.stringify(templateEntries),
            isAuto,
            updatedAt: new Date().toISOString(),
        });
    }
    async createOrGetConversation(params) {
        const { responderId, responderName, senderId, senderName, talkId } = params;
        const sortedIds = [responderId, senderId].sort();
        const conversationId = `conv_${sortedIds[0]}_${sortedIds[1]}_${talkId}`;
        const conversationData = {
            id: conversationId,
            participants: [responderId, senderId],
            talkId,
            createdAt: new Date().toISOString(),
            status: 'active',
        };
        await this.gunService.putPath(['conversations', conversationId], {
            data: JSON.stringify(conversationData),
        });
        await this.gunService.putPath(['users', responderId, 'conversations', conversationId], {
            conversationId,
            otherUserId: senderId,
            otherUserName: senderName,
            talkId,
            createdAt: new Date().toISOString(),
        });
        await this.gunService.putPath(['users', senderId, 'conversations', conversationId], {
            conversationId,
            otherUserId: responderId,
            otherUserName: responderName,
            talkId,
            createdAt: new Date().toISOString(),
        });
        return { conversationId, otherUserId: senderId, otherUserName: senderName };
    }
    async fanoutResponseToSenders(params) {
        const { talkData, sourceTalkId, responderId, responderName, answers, senders, isChatbotResponse, storeOnSourceTalk, } = params;
        const responseTargets = senders.length > 0 ? senders : [];
        const isMatch = (0, talk_engine_1.checkIfMatch)(talkData, answers);
        const matches = [];
        for (const sender of responseTargets) {
            if (!sender?.senderId || sender.senderId === responderId)
                continue;
            const targetTalkId = sender.talkId || sourceTalkId;
            const shouldStoreOnTarget = storeOnSourceTalk || targetTalkId !== sourceTalkId || talkData?.type === 'tag';
            if (shouldStoreOnTarget) {
                const responseId = `resp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
                await this.gunService.putPath(['talks', targetTalkId, 'responses', responseId], {
                    responderId,
                    responderName,
                    answers: JSON.stringify(answers),
                    submittedAt: new Date().toISOString(),
                    isChatbotResponse,
                    backendRecorded: true,
                    authorId: sender.senderId,
                    authorName: sender.senderName,
                });
            }
            if (isMatch) {
                const conv = await this.createOrGetConversation({
                    responderId,
                    responderName,
                    senderId: sender.senderId,
                    senderName: sender.senderName,
                    talkId: targetTalkId,
                });
                matches.push({
                    senderId: sender.senderId,
                    senderName: sender.senderName,
                    conversationId: conv.conversationId,
                    talkId: targetTalkId,
                });
            }
        }
        return matches;
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
        this.app.post('/api/talks/:id/received', async (req, res) => {
            try {
                const talkId = req.params.id;
                const { receiverId, receiverName, senderId, senderName, talkData: bodyTalkData } = req.body;
                if (!receiverId || !senderId) {
                    res.status(400).json({ error: 'receiverId and senderId required' });
                    return;
                }
                const talkData = await this.loadTalkDataFromGraphOrBody(talkId, bodyTalkData);
                if (!talkData) {
                    res.status(404).json({ error: 'Talk not found' });
                    return;
                }
                const resolvedSenderName = senderName || (await this.getUserStageName(senderId, 'Someone'));
                const resolvedReceiverName = receiverName || (await this.getUserStageName(receiverId, 'Someone'));
                const { identityKey } = await this.upsertIncomingTalkForUser({
                    receiverId,
                    talkId,
                    talkData,
                    senderId,
                    senderName: resolvedSenderName,
                });
                const savedTemplate = await this.gunService.getPath([
                    'talkAnswerTemplateByUser',
                    receiverId,
                    identityKey,
                ]);
                if (!savedTemplate?.isAuto) {
                    res.json({ registered: true, identityKey, autoResponded: false });
                    return;
                }
                const templateEntriesRaw = typeof savedTemplate.templateEntries === 'string'
                    ? JSON.parse(savedTemplate.templateEntries)
                    : savedTemplate.templateEntries;
                const autoAnswers = this.mapTemplateEntriesToTalk(templateEntriesRaw || [], talkData);
                if (!Array.isArray(autoAnswers) || autoAnswers.length === 0) {
                    res.json({ registered: true, identityKey, autoResponded: false, reason: 'No mappable auto answers' });
                    return;
                }
                const matches = await this.fanoutResponseToSenders({
                    talkData,
                    sourceTalkId: talkId,
                    responderId: receiverId,
                    responderName: resolvedReceiverName,
                    answers: autoAnswers,
                    senders: [{ senderId, senderName: resolvedSenderName, talkId }],
                    isChatbotResponse: true,
                    storeOnSourceTalk: true,
                });
                res.json({
                    registered: true,
                    identityKey,
                    autoResponded: true,
                    isMatch: matches.length > 0,
                    matches,
                    conversationId: matches[0]?.conversationId ?? null,
                    otherUserId: matches[0]?.senderId ?? senderId,
                    otherUserName: matches[0]?.senderName ?? resolvedSenderName,
                });
            }
            catch (error) {
                console.error('Talk received registration error:', error);
                res.status(500).json({ error: error.message });
            }
        });
        this.app.get('/api/users/:id/incoming-talks', async (req, res) => {
            try {
                const userId = req.params.id;
                const incoming = await this.gunService.getPath(['incomingTalksByUser', userId]);
                if (!incoming || typeof incoming !== 'object') {
                    res.json([]);
                    return;
                }
                const canonicalKeys = new Set();
                for (const [k, v] of Object.entries(incoming)) {
                    if (k.startsWith('_') || !v)
                        continue;
                    canonicalKeys.add(this.canonicalIdentityKeyFromStoredCluster(v));
                }
                const values = await Promise.all(Array.from(canonicalKeys).map(async (identityKey) => {
                    const cluster = await this.getMergedIncomingClusterForUser(userId, identityKey);
                    const template = await this.gunService.getPath([
                        'talkAnswerTemplateByUser',
                        userId,
                        identityKey,
                    ]);
                    const isAnswered = !!(template && template.answers);
                    return {
                        ...cluster,
                        isAnswered,
                        isAutoAnswered: !!template?.isAuto,
                    };
                }));
                values.sort((a, b) => new Date(b?.updatedAt || 0).getTime() - new Date(a?.updatedAt || 0).getTime());
                res.json(values);
            }
            catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        // Talk response: backend runs match logic and creates conversation if match (frontend only sends payload and updates UI)
        this.app.post('/api/talks/:id/response', async (req, res) => {
            try {
                const talkId = req.params.id;
                const { responderId, responderName, answers, talkData: bodyTalkData, isAuto, isChatbotResponse } = req.body;
                if (!responderId || !Array.isArray(answers)) {
                    res.status(400).json({ error: 'responderId and answers required' });
                    return;
                }
                const talkData = await this.loadTalkDataFromGraphOrBody(talkId, bodyTalkData);
                if (!talkData) {
                    res.status(404).json({ error: 'Talk not found' });
                    return;
                }
                const normalizedAnswers = this.normalizeSubmittedAnswersForTalk(talkData, answers);
                const identityKey = this.buildTalkIdentityKey(talkData);
                const resolvedResponderName = responderName || (await this.getUserStageName(responderId, 'Someone'));
                const fallbackSenderId = talkData.authorId;
                if (fallbackSenderId && fallbackSenderId !== responderId) {
                    const fallbackSenderName = await this.getUserStageName(fallbackSenderId, 'Someone');
                    await this.upsertIncomingTalkForUser({
                        receiverId: responderId,
                        talkId,
                        talkData,
                        senderId: fallbackSenderId,
                        senderName: fallbackSenderName,
                    });
                }
                const sendersParams = {
                    responderId,
                    identityKey,
                    fallbackTalkId: talkId,
                };
                if (fallbackSenderId) {
                    sendersParams.fallbackSenderId = fallbackSenderId;
                }
                const senders = await this.getClusterSenders(sendersParams);
                const effectiveIsAuto = this.deriveIsAutoAnswerSet(normalizedAnswers, isAuto, isChatbotResponse);
                const templateEntries = this.buildAnswerTemplateEntries(talkData, normalizedAnswers);
                await this.saveUserAnswerTemplateByContent({
                    responderId,
                    responderName: resolvedResponderName,
                    identityKey,
                    answers: normalizedAnswers,
                    templateEntries,
                    isAuto: effectiveIsAuto,
                });
                const matches = await this.fanoutResponseToSenders({
                    talkData,
                    sourceTalkId: talkId,
                    responderId,
                    responderName: resolvedResponderName,
                    answers: normalizedAnswers,
                    senders,
                    isChatbotResponse: !!isChatbotResponse,
                    storeOnSourceTalk: false,
                });
                const isMatch = (0, talk_engine_1.checkIfMatch)(talkData, normalizedAnswers);
                res.json({
                    isMatch,
                    identityKey,
                    matchedCount: matches.length,
                    matches,
                    conversationId: matches[0]?.conversationId ?? null,
                    otherUserId: matches[0]?.senderId ?? null,
                    otherUserName: matches[0]?.senderName ?? null,
                });
            }
            catch (error) {
                console.error('Talk response error:', error);
                res.status(500).json({ error: error.message });
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
                    }
                    else {
                        res.status(500).json({ error: 'Gun.js graph not accessible' });
                    }
                }
                catch (error) {
                    console.error('Error clearing Gun.js database:', error);
                    res.status(500).json({ error: error.message });
                }
            });
        }
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
            socket.on('move_chatroom', async (data) => {
                try {
                    await this.chatroomManager.moveChatroom(socket.data.userId, data.oldChatroomId, data.newChatroomId);
                    socket.leave(data.oldChatroomId);
                    socket.join(data.newChatroomId);
                    socket.emit('moved_chatroom', { oldChatroomId: data.oldChatroomId, newChatroomId: data.newChatroomId });
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
        this.server.on('error', (err) => {
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
exports.default = IinPublicServer;
//# sourceMappingURL=index.js.map