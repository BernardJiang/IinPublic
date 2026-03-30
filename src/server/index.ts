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
import { pickLatestTalkIdFromIncomingCluster } from '../shared/incoming-talk-ids';
import {
  normalizeIdentityText,
  buildTalkIdentityKey,
  canonicalIdentityKeyFromStoredCluster,
} from '../shared/talk-content-id';

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

  private async getMergedIncomingClusterForUser(userId: string, identityKey: string): Promise<any> {
    const incoming = await this.gunService.getPath(['incomingTalksByUser', userId]);
    const merged: any = {
      identityKey,
      title: '',
      type: 'matching',
      questionCount: 0,
      senders: {},
      talkIds: {},
      latestTalkId: '',
      updatedAt: new Date(0).toISOString(),
      identityAliases: { [identityKey]: true },
    };

    if (!incoming || typeof incoming !== 'object') {
      return merged;
    }

    for (const [rawKey, rawCluster] of Object.entries(incoming)) {
      if (rawKey.startsWith('_') || !rawCluster) continue;
      const cluster = rawCluster as any;
      const canonical = canonicalIdentityKeyFromStoredCluster(cluster);
      if (canonical !== identityKey) continue;

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
        if (cluster?.latestTalkId) merged.latestTalkId = String(cluster.latestTalkId);
      }
    }

    const resolvedLatestId = pickLatestTalkIdFromIncomingCluster({
      latestTalkId: merged.latestTalkId,
      talkIds: merged.talkIds,
      senders: merged.senders,
    });
    if (resolvedLatestId) merged.latestTalkId = resolvedLatestId;

    const latestTalkId = merged.latestTalkId || '';

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

  private async loadTalkDataFromGraphOrBody(talkId: string, bodyTalkData?: unknown): Promise<any | null> {
    const rawTalk = await this.gunService.getPath(['talks', talkId]);
    if (rawTalk) {
      if (typeof rawTalk.data === 'string') {
        return JSON.parse(rawTalk.data);
      }
      return rawTalk.data || rawTalk;
    }
    if (bodyTalkData != null) {
      return typeof bodyTalkData === 'string' ? JSON.parse(bodyTalkData as string) : bodyTalkData;
    }
    return null;
  }

  private normalizeSubmittedAnswersForTalk(
    talkData: any,
    answers: Array<{ questionId: string; answerId: string; answerText?: string; isChecked?: boolean; mode?: string }>,
  ): Array<{ questionId: string; answerId: string; answerText?: string; isChecked?: boolean; mode?: string }> {
    if (talkData?.type !== 'tag') return answers;
    return answers.map((answer) => {
      const question = talkData.questions?.find((q: any) => q.id === answer.questionId);
      const selected = question?.answers?.find((a: any) => a.id === answer.answerId);
      const isChecked = selected?.isMatch === true;
      const answerText = answer.answerText ?? selected?.text;
      return { ...answer, answerText, isChecked };
    });
  }

  private buildAnswerTemplateEntries(
    talkData: any,
    answers: Array<{ questionId: string; answerId: string; answerText?: string; isChecked?: boolean; mode?: string }>,
  ): Array<{ questionText: string; answerText: string; mode: string; isChecked: boolean }> {
    const questions = Array.isArray(talkData?.questions) ? talkData.questions : [];
    return answers.map((answer) => {
      const question = questions.find((q: any) => q.id === answer.questionId);
      const selected = question?.answers?.find((a: any) => a.id === answer.answerId);
      return {
        questionText: String(question?.text || '').trim(),
        answerText: String(answer.answerText ?? selected?.text ?? '').trim(),
        mode: String(answer.mode || 'manual'),
        isChecked: answer.isChecked === true || selected?.isMatch === true,
      };
    });
  }

  private mapTemplateEntriesToTalk(
    templateEntries: Array<{ questionText: string; answerText: string; mode?: string; isChecked?: boolean }>,
    talkData: any,
  ): Array<{ questionId: string; answerId: string; answerText?: string; isChecked?: boolean; mode?: string }> {
    const questions = Array.isArray(talkData?.questions) ? talkData.questions : [];
    const mapped: Array<{ questionId: string; answerId: string; answerText?: string; isChecked?: boolean; mode?: string }> = [];

    for (const entry of templateEntries || []) {
      const qText = normalizeIdentityText(entry.questionText);
      const aText = normalizeIdentityText(entry.answerText);
      const question = questions.find((q: any) => normalizeIdentityText(q?.text) === qText);
      if (!question) continue;

      const answer = (Array.isArray(question.answers) ? question.answers : []).find(
        (a: any) => normalizeIdentityText(a?.text) === aText,
      );

      if (!answer) continue;
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

  private deriveIsAutoAnswerSet(
    answers: Array<{ mode?: string }>,
    explicitIsAuto?: boolean,
    isChatbotResponse?: boolean,
  ): boolean {
    if (explicitIsAuto != null) return !!explicitIsAuto;
    if (isChatbotResponse) return true;
    if (!Array.isArray(answers) || answers.length === 0) return false;
    return answers.every((a) => String(a?.mode || '').toLowerCase() === 'auto');
  }

  private async getUserStageName(userId: string, fallback: string): Promise<string> {
    const userNode = await this.gunService.getPath(['users', userId]);
    return (userNode?.stageName ?? userNode?.data?.stageName ?? fallback ?? 'Someone') as string;
  }

  private async upsertIncomingTalkForUser(params: {
    receiverId: string;
    talkId: string;
    talkData: any;
    senderId: string;
    senderName?: string;
  }): Promise<{ identityKey: string; cluster: any }> {
    const { receiverId, talkId, talkData, senderId, senderName } = params;
    const identityKey = buildTalkIdentityKey(talkData);
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
      /** Stable id for clients when Gun reshapes `talkIds` keys. */
      latestTalkId: talkId,
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

  private async getClusterSenders(params: {
    responderId: string;
    identityKey: string;
    fallbackTalkId: string;
    fallbackSenderId?: string;
  }): Promise<Array<{ senderId: string; senderName: string; talkId: string }>> {
    const { responderId, identityKey, fallbackTalkId, fallbackSenderId } = params;
    const cluster = await this.getMergedIncomingClusterForUser(responderId, identityKey);
    const list: Array<{ senderId: string; senderName: string; talkId: string }> = [];
    const seen = new Set<string>();

    if (cluster?.senders && typeof cluster.senders === 'object') {
      for (const sender of Object.values(cluster.senders as Record<string, any>)) {
        const senderId = sender?.senderId;
        if (!senderId || senderId === responderId || seen.has(senderId)) continue;
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

  private async saveUserAnswerTemplateByContent(params: {
    responderId: string;
    responderName: string;
    identityKey: string;
    answers: Array<{ questionId: string; answerId: string; answerText?: string; isChecked?: boolean; mode?: string }>;
    templateEntries: Array<{ questionText: string; answerText: string; mode: string; isChecked: boolean }>;
    isAuto: boolean;
  }): Promise<void> {
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

  private async createOrGetConversation(params: {
    responderId: string;
    responderName: string;
    senderId: string;
    senderName: string;
    talkId: string;
  }): Promise<{ conversationId: string; otherUserId: string; otherUserName: string }> {
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

  private async fanoutResponseToSenders(params: {
    talkData: any;
    sourceTalkId: string;
    responderId: string;
    responderName: string;
    answers: Array<{ questionId: string; answerId: string; answerText?: string; isChecked?: boolean; mode?: string }>;
    senders: Array<{ senderId: string; senderName: string; talkId: string }>;
    isChatbotResponse: boolean;
    storeOnSourceTalk: boolean;
  }): Promise<Array<{ senderId: string; senderName: string; conversationId: string; talkId: string }>> {
    const {
      talkData,
      sourceTalkId,
      responderId,
      responderName,
      answers,
      senders,
      isChatbotResponse,
      storeOnSourceTalk,
    } = params;

    const responseTargets = senders.length > 0 ? senders : [];
    const isMatch = checkIfMatch(talkData, answers);
    const matches: Array<{ senderId: string; senderName: string; conversationId: string; talkId: string }> = [];

    for (const sender of responseTargets) {
      if (!sender?.senderId || sender.senderId === responderId) continue;
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

    /** Full talk JSON from server Gun graph (peers may lag replicating to the browser). */
    this.app.get('/api/talks/:id', async (req, res) => {
      try {
        const talk = await this.loadTalkDataFromGraphOrBody(req.params.id);
        if (!talk) {
          res.status(404).json({ error: 'Talk not found' });
          return;
        }
        res.json(talk);
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
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

    this.app.post('/api/talks/:id/received', async (req, res) => {
      try {
        const talkId = req.params.id;
        const { receiverId, receiverName, senderId, senderName, talkData: bodyTalkData } = req.body as {
          receiverId: string;
          receiverName?: string;
          senderId: string;
          senderName?: string;
          talkData?: unknown;
        };
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

        const templateEntriesRaw =
          typeof savedTemplate.templateEntries === 'string'
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
      } catch (error) {
        console.error('Talk received registration error:', error);
        res.status(500).json({ error: (error as Error).message });
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

        const canonicalKeys = new Set<string>();
        for (const [k, v] of Object.entries(incoming)) {
          if (k.startsWith('_') || !v) continue;
          canonicalKeys.add(canonicalIdentityKeyFromStoredCluster(v));
        }

        const values = await Promise.all(
          Array.from(canonicalKeys).map(async (identityKey) => {
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
          }),
        );

        values.sort(
          (a: any, b: any) =>
            new Date(b?.updatedAt || 0).getTime() - new Date(a?.updatedAt || 0).getTime(),
        );
        res.json(values);
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Talk response: backend runs match logic and creates conversation if match (frontend only sends payload and updates UI)
    this.app.post('/api/talks/:id/response', async (req, res) => {
      try {
        const talkId = req.params.id;
        const { responderId, responderName, answers, talkData: bodyTalkData, isAuto, isChatbotResponse } = req.body as {
          responderId: string;
          responderName?: string;
          answers: Array<{ questionId: string; answerId: string; answerText?: string; isChecked?: boolean; mode?: string }>;
          talkData?: unknown;
          isAuto?: boolean;
          isChatbotResponse?: boolean;
        };
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
        const identityKey = buildTalkIdentityKey(talkData);
        const resolvedResponderName = responderName || (await this.getUserStageName(responderId, 'Someone'));

        const fallbackSenderId = talkData.authorId as string | undefined;
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
        } as { responderId: string; identityKey: string; fallbackTalkId: string; fallbackSenderId?: string };
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

        const isMatch = checkIfMatch(talkData, normalizedAnswers);
        res.json({
          isMatch,
          identityKey,
          matchedCount: matches.length,
          matches,
          conversationId: matches[0]?.conversationId ?? null,
          otherUserId: matches[0]?.senderId ?? null,
          otherUserName: matches[0]?.senderName ?? null,
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
