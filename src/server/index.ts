import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import Gun from 'gun';
import SEA from 'gun/sea';
import { GunService } from './services/gun-service';
import { ChatroomManager } from './services/chatroom-manager';
import { TalkService } from './services/talk-service';
import { UserService } from './services/user-service';
import { ReputationService } from './services/reputation-service';
import { checkIfMatch } from '../shared/talk-engine';
import { pickLatestTalkIdFromIncomingCluster, TALK_CONTENT_HASH_ID } from '../shared/incoming-talk-ids';
import {
  normalizeIdentityText,
  buildTalkIdentityKey,
  canonicalIdentityKeyFromStoredCluster,
} from '../shared/talk-content-id';
import type { RelationshipLabel } from '../shared/types';
import {
  aggregateByAnswer,
  aggregateByRegion,
  aggregateByTime,
  bucketKey,
  summarize,
  type TalkResponse,
  type TalkType,
  type TimeBucket,
} from '../shared/talk-stats';
import { logger } from './logger';
import { requestLogger } from './middleware/request-logger';

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
  /** Server-side store for incomingTalksByUser — bypasses Gun.js to avoid event-loop stall on bulk writes. */
  private incomingTalksMap: Map<string, Map<string, any>> = new Map();
  /** STAT-01 — normalized per-talk response log for the generic stats/inquiry layer. */
  private talkResponsesMap: Map<string, TalkResponse[]> = new Map();
  /** STAT-01 — secondary indices (in-memory mirror of idx/... graph paths). */
  private statsIdx = {
    byDay: new Map<string, Set<string>>(),
    byRegion: new Map<string, Set<string>>(),
    byTalkAnswer: new Map<string, Set<string>>(),
  };

  constructor() {
    this.app = express();
    this.server = createServer(this.app);

    this.io = new Server(this.server, {
      cors: {
        // In dev/e2e we may run multiple webpack dev servers on adjacent ports (parallel
        // Playwright workers), so match any localhost origin rather than a fixed list.
        origin:
          process.env.NODE_ENV === 'production'
            ? ['https://iinpublic.com']
            : /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
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
    // E2E (Playwright): in-memory graph only so POST /api/test/clear-database + deleted radata/
    // cannot be repopulated from radisk after a clear — otherwise stale chatrooms/users/talks
    // accumulate and receivers time out waiting for IN rows.
    const e2eMemoryOnly = process.env.E2E_GUN_MEMORY_ONLY === '1' || process.env.E2E_GUN_MEMORY_ONLY === 'true';
    this.gun = Gun({
      web: this.server,
      localStorage: false, // Server doesn't need localStorage
      radisk: !e2eMemoryOnly,
      // Parallel e2e runs multiple Gun HTTP servers (8080, 8081, …). Without this, Gun's
      // UDP multicast (lib/multicast.js, port 8765) meshes separate processes and splits the
      // in-memory graph so two browsers on one hub still see different chatroom membership.
      // Browser AXE is disabled in e2e bundles (web-gun-service); server-side AXE/multicast
      // must also be off for isolated graphs per hub.
      ...(e2eMemoryOnly ? { peers: [], axe: false, multicast: false } : {}),
    });
    logger.info({ radisk: !e2eMemoryOnly }, '🔫 Gun.js attached to HTTP server');
  }

  private setupMiddleware(): void {
    this.app.use(
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            // Gun.js needs eval; worker scripts are served locally at /node_modules/gun/
            scriptSrc: ["'self'", "'unsafe-eval'"],
            imgSrc: ["'self'", 'data:', 'https:'],
            connectSrc: ["'self'", 'ws:', 'wss:'],
            workerSrc: ["'self'", 'blob:'],
          },
        },
      }),
    );

    this.app.use(
      cors({
        // See note on socket.io CORS above — parallel e2e workers use 3002+ too.
        origin:
          process.env.NODE_ENV === 'production'
            ? ['https://iinpublic.com']
            : /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
        credentials: true,
      }),
    );

    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // Structured request logging (INF-05) — must come after body parsers.
    this.app.use(requestLogger);

    // Serve static files — public/ first so worker.js is reachable at /worker.js
    this.app.use(express.static('public'));
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
      type: 'flow',
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

      // Gun stores nested objects as soul references { '#': soul } at the parent level.
      // Resolve them to actual cluster data before processing.
      let resolvedCluster: any = rawCluster;
      if (
        rawCluster &&
        typeof rawCluster === 'object' &&
        !Array.isArray(rawCluster) &&
        Object.keys(rawCluster as object).length === 1 &&
        '#' in (rawCluster as object)
      ) {
        resolvedCluster =
          (await this.gunService.getPath(['incomingTalksByUser', userId, rawKey])) || rawCluster;
      }

      const cluster = this.clusterNodeForIdentityLookup(resolvedCluster) as any;
      const canonical = canonicalIdentityKeyFromStoredCluster(cluster);
      const idFromNode = typeof cluster?.identityKey === 'string' ? String(cluster.identityKey).trim() : '';
      if (canonical !== identityKey && rawKey !== identityKey && idFromNode !== identityKey) continue;

      merged.identityAliases[rawKey] = true;
      if (cluster?.identityKey) {
        merged.identityAliases[cluster.identityKey] = true;
      }

      const clusterSenders = cluster?.senders && typeof cluster.senders === 'object' && !('#' in (cluster.senders as object)) ? cluster.senders : {};
      const clusterTalkIds = cluster?.talkIds && typeof cluster.talkIds === 'object' && !('#' in (cluster.talkIds as object)) ? cluster.talkIds : {};
      merged.senders = { ...merged.senders, ...clusterSenders };
      merged.talkIds = { ...merged.talkIds, ...clusterTalkIds };
      merged.questionCount = Math.max(Number(merged.questionCount || 0), Number(cluster?.questionCount || 0));

      const clusterUpdatedAt = new Date(cluster?.updatedAt || 0).getTime();
      const mergedUpdatedAt = new Date(merged.updatedAt || 0).getTime();
      if (clusterUpdatedAt >= mergedUpdatedAt) {
        merged.updatedAt = cluster?.updatedAt || merged.updatedAt;
        merged.type = cluster?.type || merged.type;
        if (cluster?.latestTalkId) merged.latestTalkId = String(cluster.latestTalkId);
        // Copy title from cluster (stored inline as a primitive) so callers don't rely solely
        // on loadTalkDataFromGraphOrBody to resolve it (which may fail if the talk was stored
        // at a different Gun path than the server expects).
        if (cluster?.title) merged.title = String(cluster.title);
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
    const parseBody = (): any | null => {
      if (bodyTalkData == null) return null;
      return typeof bodyTalkData === 'string' ? JSON.parse(bodyTalkData as string) : bodyTalkData;
    };

    const looksAuthoritative = (t: any): boolean => {
      if (!t || typeof t !== 'object') return false;
      const aid = t.authorId;
      if (aid == null || String(aid).trim() === '' || String(aid) === 'undefined') return false;
      // Tag talks have no questions — treat as authoritative if they have a title
      if (t.type === 'tag') return !!(t.title);
      const qs = t.questions;
      if (!Array.isArray(qs) || qs.length === 0) return false;
      return true;
    };

    const fromBody = parseBody();

    // Prefer authoritative POST body first: the sender includes full talk JSON for broadcast batches.
    // Skip the Gun.js graph lookup entirely when body is already authoritative (avoids event-loop stall).
    if (looksAuthoritative(fromBody)) return fromBody;

    let fromGraph: any | null = null;
    const rawTalk = await this.gunService.getPath(['talks', talkId]);
    if (rawTalk) {
      try {
        if (typeof rawTalk.data === 'string') {
          fromGraph = JSON.parse(rawTalk.data);
        } else {
          fromGraph = rawTalk.data || rawTalk;
        }
      } catch {
        fromGraph = null;
      }
    }

    if (looksAuthoritative(fromGraph)) return fromGraph;
    if (fromGraph) return fromGraph;
    return fromBody;
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

  private async getUserRegion(userId: string): Promise<string> {
    const userNode = await this.gunService.getPath(['users', userId]);
    const r =
      userNode?.location?.region ??
      userNode?.data?.location?.region ??
      userNode?.region ??
      'unknown';
    return String(r || 'unknown');
  }

  /**
   * STAT-01 — record a normalized {@link TalkResponse} and update secondary
   * indices for the generic stats/inquiry layer.  Writes both to the in-memory
   * server cache (authoritative for /api/stats/*) and to Gun paths
   * `talks/<talkId>/stats/<responseId>` + `idx/...` so other peers can mirror.
   */
  private async recordTalkStatsResponse(params: {
    talkId: string;
    talkType: TalkType;
    responderId: string;
    region: string;
    answers: Array<{ questionId: string; answerId: string; answerText: string }>;
  }): Promise<void> {
    const { talkId, talkType, responderId, region, answers } = params;
    const responseId = `sr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const createdAt = Date.now();
    const record: TalkResponse = {
      responseId,
      talkId,
      talkType,
      responderId,
      region,
      answers: answers.map((a) => ({
        questionId: a.questionId,
        answerId: a.answerId,
        answerText: a.answerText || '',
      })),
      createdAt,
    };
    const list = this.talkResponsesMap.get(talkId) ?? [];
    list.push(record);
    this.talkResponsesMap.set(talkId, list);

    const dayKey = `${bucketKey(createdAt, 'day')}|${talkId}`;
    (this.statsIdx.byDay.get(dayKey) ?? this.statsIdx.byDay.set(dayKey, new Set()).get(dayKey)!).add(
      responseId,
    );
    const regionKey = `${region}|${talkId}`;
    (
      this.statsIdx.byRegion.get(regionKey) ??
      this.statsIdx.byRegion.set(regionKey, new Set()).get(regionKey)!
    ).add(responseId);
    for (const a of record.answers) {
      const aKey = `${talkId}|${a.questionId}|${a.answerId}`;
      (
        this.statsIdx.byTalkAnswer.get(aKey) ??
        this.statsIdx.byTalkAnswer.set(aKey, new Set()).get(aKey)!
      ).add(responseId);
    }

    try {
      await this.gunService.putPath(['talks', talkId, 'stats', responseId], {
        ...record,
        answersJson: JSON.stringify(record.answers),
      });
      await this.gunService.putPath(
        ['idx', 'responses_by_day', bucketKey(createdAt, 'day'), talkId, responseId],
        { at: createdAt },
      );
      await this.gunService.putPath(
        ['idx', 'responses_by_region', region, talkId, responseId],
        { at: createdAt },
      );
      for (const a of record.answers) {
        await this.gunService.putPath(
          ['idx', 'responses_by_talk_answer', talkId, a.questionId, a.answerId, responseId],
          { at: createdAt },
        );
      }
    } catch (err) {
      logger.warn({ err }, 'stats: Gun mirror write failed (memory cache still authoritative)');
    }
  }

  private getTalkResponses(talkId: string, opts?: { from?: number; to?: number }): TalkResponse[] {
    const list = this.talkResponsesMap.get(talkId) ?? [];
    if (!opts?.from && !opts?.to) return list;
    return list.filter(
      (r) =>
        (opts.from == null || r.createdAt >= opts.from) &&
        (opts.to == null || r.createdAt <= opts.to),
    );
  }

  /** Gun cannot store `questions: [...]` on incoming cluster nodes; we keep `questionsJson` instead. */
  private clusterNodeForIdentityLookup(v: unknown): any {
    let base = v;
    if (base && typeof base === 'object' && (base as any).data && typeof (base as any).data === 'object') {
      base = (base as any).data;
    }
    if (!base || typeof base !== 'object') return base;
    const o = base as Record<string, unknown>;
    if (Array.isArray(o.questions)) return o;
    if (typeof o.questionsJson === 'string' && o.questionsJson.length > 0) {
      try {
        const q = JSON.parse(o.questionsJson);
        if (Array.isArray(q)) return { ...o, questions: q };
      } catch {
        /* ignore */
      }
    }
    return o;
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
    const tid = typeof talkId === 'string' ? talkId.trim() : '';
    const useTalkIdAsStorageLeaf = tid.length > 0 && TALK_CONTENT_HASH_ID.test(tid);

    const nowIso = new Date().toISOString();

    // Read from server-side Map (avoids Gun.js event-loop stall on bulk writes).
    const userMap = this.incomingTalksMap.get(receiverId);
    const storageLeafForRead = useTalkIdAsStorageLeaf ? tid : identityKey;
    const prev = userMap?.get(storageLeafForRead);
    const existing: any = prev
      ? {
          title: prev.title || '',
          type: prev.type || 'flow',
          senders: prev.senders && typeof prev.senders === 'object' ? prev.senders : {},
          talkIds: prev.talkIds && typeof prev.talkIds === 'object' ? prev.talkIds : {},
          questionCount: prev.questionCount || 0,
          questionsJson: prev.questionsJson,
          identityAliases:
            prev.identityAliases && typeof prev.identityAliases === 'object' ? prev.identityAliases : {},
        }
      : {
          title: '',
          type: 'flow',
          senders: {},
          talkIds: {},
          questionCount: 0,
          questionsJson: undefined,
          identityAliases: {},
        };

    const senderMap = existing.senders && typeof existing.senders === 'object' ? existing.senders : {};
    const talkIds = existing.talkIds && typeof existing.talkIds === 'object' ? existing.talkIds : {};

    senderMap[senderId] = {
      senderId,
      senderName: senderName || senderMap[senderId]?.senderName || 'Someone',
      lastTalkId: talkId,
      lastReceivedAt: nowIso,
    };
    talkIds[talkId] = nowIso;

    const questionsJsonForNode =
      Array.isArray(talkData?.questions) && talkData.questions.length > 0
        ? JSON.stringify(talkData.questions)
        : typeof existing?.questionsJson === 'string'
          ? existing.questionsJson
          : '';

    const cluster = {
      identityKey,
      title: talkData?.title || existing.title || '',
      type: talkData?.type || existing.type || 'flow',
      /** JSON string only — Gun.put rejects nested arrays on this path. */
      questionsJson: questionsJsonForNode || undefined,
      questionCount: Array.isArray(talkData?.questions) ? talkData.questions.length : existing.questionCount || 0,
      senders: senderMap,
      talkIds,
      /** Stable id for clients when Gun reshapes `talkIds` keys. */
      latestTalkId: talkId,
      updatedAt: nowIso,
      identityAliases:
        existing.identityAliases && typeof existing.identityAliases === 'object'
          ? { ...existing.identityAliases, [identityKey]: true }
          : { [identityKey]: true },
    };

    const storageLeaf = useTalkIdAsStorageLeaf ? tid : identityKey;

    // Write to server-side Map (synchronous, no Gun.js event-loop stall).
    if (!this.incomingTalksMap.has(receiverId)) this.incomingTalksMap.set(receiverId, new Map());
    this.incomingTalksMap.get(receiverId)!.set(storageLeaf, cluster);
    if (!useTalkIdAsStorageLeaf && existing.identityAliases && typeof existing.identityAliases === 'object') {
      for (const alias of Object.keys(existing.identityAliases)) {
        if (alias && alias !== identityKey) {
          this.incomingTalksMap.get(receiverId)!.set(alias, cluster);
        }
      }
    }

    // No Gun.js writes here — server-side Map is the source of truth for incoming talks.
    // Browser clients read from GET /incoming-talks (HTTP) when opening the Talks tab.
    // Gun.js writes for incomingTalksByUser are skipped to avoid event-loop stall on bulk broadcasts.

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

    this.app.post('/api/users/:id/known-people', async (req, res) => {
      try {
        const { targetId, label } = req.body as { targetId?: string; label?: string };
        if (!targetId || !label) {
          res.status(400).json({ error: 'targetId and label required' });
          return;
        }
        await this.userService.addKnownPerson(req.params.id, targetId, label as RelationshipLabel);
        res.json({ ok: true });
      } catch (error) {
        res.status(400).json({ error: (error as Error).message });
      }
    });

    this.app.delete('/api/users/:id/known-people/:targetId', async (req, res) => {
      try {
        await this.userService.removeKnownPerson(req.params.id, req.params.targetId);
        res.json({ ok: true });
      } catch (error) {
        res.status(400).json({ error: (error as Error).message });
      }
    });

    this.app.get('/api/users/:id/known-people', async (req, res) => {
      try {
        const list = await this.userService.listKnownPeople(req.params.id);
        res.json(list);
      } catch (error) {
        res.status(400).json({ error: (error as Error).message });
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
          // 202 (not 404) avoids browser "Failed to load resource" spam while clients poll until replication.
          res.status(202).json({ pending: true, id: req.params.id });
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
        logger.error({ err: error }, 'Talk received registration error');
        res.status(500).json({ error: (error as Error).message });
      }
    });

    /**
     * Sender-driven: after Gun announces a talk to a chatroom, register every listed receiver on the server
     * graph so GET /incoming-talks and IN UI work even when a peer never receives the Gun node in time.
     */
    this.app.post('/api/talks/:id/register-receivers-for-broadcast', async (req, res) => {
      // Hard 20-second timeout: Gun.js in-memory can stall put/get callbacks; ensure we always respond.
      const hardTimeout = setTimeout(() => {
        if (!res.headersSent) {
          logger.warn({ talkId: req.params.id }, '[register-receivers] hard timeout');
          res.status(504).json({ error: 'timeout', registered: 0 });
        }
      }, 20000);
      try {
        const talkId = req.params.id;
        const { senderId, senderName, receiverIds, talkData: bodyTalkData } = req.body as {
          senderId: string;
          senderName?: string;
          receiverIds: string[];
          talkData?: unknown;
        };
        logger.info({ talkId, senderId, receiverCount: receiverIds.length }, '[register-receivers] registering receivers');
        if (!senderId || !Array.isArray(receiverIds)) {
          clearTimeout(hardTimeout);
          res.status(400).json({ error: 'senderId and receiverIds[] required' });
          return;
        }
        const talkData = await this.loadTalkDataFromGraphOrBody(talkId, bodyTalkData);
        logger.info({ talkId, title: (talkData as any)?.title ?? null, authorId: (talkData as any)?.authorId }, '[register-receivers] talkData loaded');
        if (!talkData) {
          clearTimeout(hardTimeout);
          res.status(404).json({ error: 'Talk not found' });
          return;
        }
        if (String((talkData as { authorId?: string }).authorId) !== String(senderId)) {
          logger.warn({ authorId: (talkData as any).authorId, senderId }, '[register-receivers] 403: authorId mismatch');
          clearTimeout(hardTimeout);
          res.status(403).json({ error: 'senderId must match talk author' });
          return;
        }
        const resolvedSenderName = senderName || (await this.getUserStageName(senderId, 'Someone'));
        let registered = 0;
        for (const receiverId of receiverIds) {
          if (!receiverId || receiverId === senderId) continue;
          await this.upsertIncomingTalkForUser({
            receiverId,
            talkId,
            talkData,
            senderId,
            senderName: resolvedSenderName,
          });
          registered += 1;
        }
        clearTimeout(hardTimeout);
        if (!res.headersSent) res.json({ ok: true, registered });
      } catch (error) {
        clearTimeout(hardTimeout);
        logger.error({ err: error }, 'register-receivers-for-broadcast error');
        if (!res.headersSent) res.status(500).json({ error: (error as Error).message });
      }
    });

    this.app.get('/api/users/:id/incoming-talks', async (req, res) => {
      try {
        const userId = req.params.id;
        const userMap = this.incomingTalksMap.get(userId);
        if (!userMap || userMap.size === 0) {
          res.json([]);
          return;
        }

        // Read from server-side Map (no Gun.js calls — avoids event-loop stall).
        const values = await Promise.all(
          Array.from(userMap.entries()).map(async ([rawKey, cluster]) => {
            const logical =
              typeof cluster?.identityKey === 'string' && cluster.identityKey
                ? cluster.identityKey
                : TALK_CONTENT_HASH_ID.test(rawKey)
                  ? rawKey
                  : canonicalIdentityKeyFromStoredCluster(cluster);
            const template = await this.gunService.getPath([
              'talkAnswerTemplateByUser',
              userId,
              logical,
            ]);
            const isAnswered = !!(template && template.answers);
            return {
              ...cluster,
              /** UI IN list filters on identityKey; always echo canonical key from rawKey/cluster. */
              identityKey: logical,
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

        // STAT-01 — normalize every response into the generic stats log, regardless of talk type.
        try {
          const region = await this.getUserRegion(responderId);
          await this.recordTalkStatsResponse({
            talkId,
            talkType: (talkData?.type || 'flow') as TalkType,
            responderId,
            region,
            answers: normalizedAnswers.map((a: any) => ({
              questionId: String(a.questionId),
              answerId: String(a.answerId),
              answerText: String(a.answerText ?? ''),
            })),
          });
        } catch (err) {
          logger.warn({ err }, 'stats: failed to record response');
        }

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
        logger.error({ err: error }, 'Talk response error');
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

    // STAT-01 — record a response in the generic stats log.
    // Called from the client's talkCompleted handler (which writes responses directly to
    // Gun, bypassing POST /api/talks/:id/response). Keeps stats in sync regardless of path.
    this.app.post('/api/stats/talks/:id/record', async (req, res) => {
      try {
        const talkId = req.params.id;
        const { responderId, talkType, answers } = req.body as {
          responderId?: string;
          talkType?: TalkType;
          answers?: Array<{ questionId: string; answerId: string; answerText?: string }>;
        };
        if (!responderId || !talkType || !Array.isArray(answers)) {
          res.status(400).json({ error: 'responderId, talkType, answers required' });
          return;
        }
        const region = await this.getUserRegion(responderId);
        await this.recordTalkStatsResponse({
          talkId,
          talkType,
          responderId,
          region,
          answers: answers.map((a) => ({
            questionId: String(a.questionId),
            answerId: String(a.answerId),
            answerText: String(a.answerText ?? ''),
          })),
        });
        res.json({ ok: true });
      } catch (error) {
        logger.error({ err: error }, 'stats record error');
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // STAT-01 — generic stats/inquiry endpoints (uniform across tag/flow/survey/route)
    this.app.get('/api/stats/talks/:id/summary', (req, res) => {
      const talkId = req.params.id;
      const responses = this.getTalkResponses(talkId);
      const talkType = (responses[0]?.talkType ?? 'flow') as TalkType;
      res.json(summarize(talkId, talkType, responses));
    });

    this.app.get('/api/stats/talks/:id/by-day', (req, res) => {
      const talkId = req.params.id;
      const opts: { from?: number; to?: number } = {};
      if (req.query.from) opts.from = Number(req.query.from);
      if (req.query.to) opts.to = Number(req.query.to);
      const rawBucket = String(req.query.bucket || 'day').toLowerCase();
      const bucket: TimeBucket = rawBucket === 'week' || rawBucket === 'month' ? rawBucket : 'day';
      const responses = this.getTalkResponses(talkId, opts);
      res.json(aggregateByTime(talkId, responses, bucket));
    });

    this.app.get('/api/stats/talks/:id/by-region', (req, res) => {
      const talkId = req.params.id;
      res.json(aggregateByRegion(talkId, this.getTalkResponses(talkId)));
    });

    this.app.get('/api/stats/talks/:id/by-answer', (req, res) => {
      const talkId = req.params.id;
      const questionId = String(req.query.questionId || '');
      if (!questionId) {
        res.status(400).json({ error: 'questionId query param required' });
        return;
      }
      res.json(aggregateByAnswer(talkId, this.getTalkResponses(talkId), questionId));
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
            logger.info('🧹 Clearing Gun.js in-memory database...');
            // Create a new empty graph
            this.gun._.graph = {};
            // Also clear server-side incoming talks Map
            this.incomingTalksMap.clear();
            logger.info('✅ Gun.js in-memory database cleared');
            res.json({ success: true, message: 'Gun.js in-memory database cleared' });
          } else {
            res.status(500).json({ error: 'Gun.js graph not accessible' });
          }
        } catch (error) {
          logger.error({ err: error }, 'Error clearing Gun.js database');
          res.status(500).json({ error: (error as Error).message });
        }
      });
    }
  }

  private setupSocketHandlers(): void {
    this.io.on('connection', (socket) => {
      logger.info({ socketId: socket.id }, 'User connected');

      // User authentication and setup
      socket.on('authenticate', async (data: { userId?: string; pub?: string; signature?: string }) => {
        try {
          if (!data?.userId) {
            socket.emit('auth_error', { error: 'userId required' });
            return;
          }
          if (!data.pub || !data.signature) {
            socket.emit('auth_error', { error: 'pub and signature required' });
            socket.disconnect();
            return;
          }
          const verified = await SEA.verify(data.signature, data.pub);
          if (verified !== data.userId) {
            socket.emit('auth_error', { error: 'Invalid signature' });
            socket.disconnect();
            return;
          }
          const user = await this.userService.getUser(data.userId);
          if (user.pub && user.pub !== data.pub) {
            socket.emit('auth_error', { error: 'Public key mismatch' });
            socket.disconnect();
            return;
          }
          socket.data.userId = user.id;
          socket.data.pub = data.pub;
          socket.emit('authenticated', { user });
        } catch (error) {
          socket.emit('auth_error', { error: (error as Error).message });
          socket.disconnect();
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
        logger.info({ socketId: socket.id }, 'User disconnected');
        if (socket.data.userId) {
          this.userService.setUserOffline(socket.data.userId);
        }
      });
    });
  }

  public start(port: number = 8080): void {
    this.server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        logger.fatal({ port }, `Port ${port} is already in use. Stop the other process or use a different PORT env var.`);
        process.exit(1);
      }
      throw err;
    });
    this.server.listen(port, () => {
      logger.info({ port, env: process.env.NODE_ENV || 'development' }, '🚀 IinPublic server started');
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
