import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { GunService } from './services/gun-service';
import { ChatroomManager } from './services/chatroom-manager';
import { TalkService } from './services/talk-service';
import { UserService } from './services/user-service';
import { ReputationService } from './services/reputation-service';
import { checkIfMatch } from '../shared/talk-engine';
import {
  createConversationTransportDiagnostics,
  resolveP2PRuntimeFlags,
} from '../shared/p2p-runtime';
import { pickLatestTalkIdFromIncomingCluster, TALK_CONTENT_HASH_ID } from '../shared/incoming-talk-ids';
import {
  normalizeIdentityText,
  buildTalkIdentityKey,
  canonicalIdentityKeyFromStoredCluster,
} from '../shared/cid';
import {
  bucketKey,
  type TalkResponse,
  type TalkType,
} from '../shared/talk-stats';
import { CONFIG } from '../shared/config';
import { logger } from './logger';
import { attachGun, configureHttpMiddleware, createSocketServer } from './bootstrap/http-bootstrap';
import { registerChatroomRoutes } from './routes/chatroom-routes';
import { registerPeerRoutes } from './routes/peer-routes';
import { registerStatsRoutes } from './routes/stats-routes';
import { registerTalkDeliveryRoutes } from './routes/talk-delivery-routes';
import { BroadcastTagPopularityStore } from './services/broadcast-tag-popularity-store';
import { SymmetricTalkEdgeRateLimiter } from './services/symmetric-talk-edge-rate-limit';
import { DailyWeeklyTalkEdgeQuotaRateLimiter } from './services/daily-weekly-talk-edge-quota-rate-limit';
import { getServerBlockedTerms } from './server-blocked-terms';
import { registerSystemRoutes } from './routes/system-routes';
import { registerTalkRoutes } from './routes/talk-routes';
import { registerUserRoutes } from './routes/user-routes';
import { registerSocketHandlers } from './socket/register-socket-handlers';
import {
  savePermanentAnswer,
  saveSuppressedQuestion,
  saveTemporaryAnswer,
} from '../shared/exact-chatbot-memory';
import {
  readOrCreateExactChatbotMemoryForUser,
  writeExactChatbotMemoryForUser,
} from './exact-chatbot-memory-store';

const E2E_GUN_MEMORY_ONLY =
  process.env.E2E_GUN_MEMORY_ONLY === '1' || process.env.E2E_GUN_MEMORY_ONLY === 'true';

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
  /** Server-side store for conversations per user — Gun.js graph is unreliable in E2E mode (radisk:false). */
  private conversationsMap: Map<string, Map<string, any>> = new Map();
  /** STAT-01 — normalized per-talk response log for the generic stats/inquiry layer. */
  private talkResponsesMap: Map<string, TalkResponse[]> = new Map();
  /** STAT-01 — secondary indices (in-memory mirror of idx/... graph paths). */
  private statsIdx = {
    byDay: new Map<string, Set<string>>(),
    byRegion: new Map<string, Set<string>>(),
    byTalkAnswer: new Map<string, Set<string>>(),
  };

  private broadcastTagPopularityStore = new BroadcastTagPopularityStore();
  private symmetricTalkEdgeRateLimiter = new SymmetricTalkEdgeRateLimiter(
    E2E_GUN_MEMORY_ONLY ? 0 : CONFIG.SYMMETRIC_TALK_EDGE_COOLDOWN_MS,
  );
  private dailyWeeklyTalkEdgeQuotaRateLimiter = new DailyWeeklyTalkEdgeQuotaRateLimiter({
    // Keep production limits, but allow high-fanout e2e scenarios in in-memory mode.
    daily: E2E_GUN_MEMORY_ONLY ? Number.MAX_SAFE_INTEGER : CONFIG.RATE_LIMITS.TALK_SEND_DAILY,
    weekly: E2E_GUN_MEMORY_ONLY ? Number.MAX_SAFE_INTEGER : CONFIG.RATE_LIMITS.TALK_SEND_WEEKLY,
  });

  constructor() {
    this.app = express();
    this.server = createServer(this.app);
    this.io = createSocketServer(this.server);

    this.setupMiddleware();
    this.setupGun();
    this.initializeServices();
    this.setupRoutes();
    this.setupSocketHandlers();
  }

  private setupGun(): void {
    this.gun = attachGun(this.server);
  }

  private setupMiddleware(): void {
    configureHttpMiddleware(this.app);
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
  ): Array<{ questionText: string; answerText: string; mode: string; isChecked: boolean; isIgnore: boolean }> {
    const questions = Array.isArray(talkData?.questions) ? talkData.questions : [];
    return answers.map((answer) => {
      const question = questions.find((q: any) => q.id === answer.questionId);
      const selected = question?.answers?.find((a: any) => a.id === answer.answerId);
      return {
        questionText: String(question?.text || '').trim(),
        answerText: String(answer.answerText ?? selected?.text ?? '').trim(),
        mode: String(answer.mode || 'manual'),
        isChecked: answer.isChecked === true || selected?.isMatch === true,
        isIgnore: answer.answerId === 'ignore' || selected?.isIgnore === true,
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
    outcome?: 'match' | 'ignore' | 'other';
    isAuto?: boolean;
  }): Promise<void> {
    const { talkId, talkType, responderId, region, answers, outcome, isAuto } = params;
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
      outcome: outcome ?? 'other',
      answerMode: isAuto ? 'auto' : 'manual',
      chatroomId: region,
      isTraveller: false,
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

  private parseTalkStatsNode(talkId: string, node: any): TalkResponse | null {
    if (!node || typeof node !== 'object') return null;
    const responseId = String(node.responseId || '').trim();
    if (!responseId || responseId.startsWith('_')) return null;
    let answers: TalkResponse['answers'] = [];
    if (typeof node.answersJson === 'string') {
      try {
        const parsed = JSON.parse(node.answersJson);
        if (Array.isArray(parsed)) answers = parsed;
      } catch {
        answers = [];
      }
    } else if (Array.isArray(node.answers)) {
      answers = node.answers;
    }
    return {
      responseId,
      talkId: String(node.talkId || talkId),
      talkType: (node.talkType || 'flow') as TalkType,
      responderId: String(node.responderId || ''),
      region: String(node.region || 'unknown'),
      answers: answers.map((answer: any) => ({
        questionId: String(answer?.questionId || ''),
        answerId: String(answer?.answerId || ''),
        answerText: String(answer?.answerText || ''),
      })),
      createdAt: Number(node.createdAt || 0),
      outcome: node.outcome === 'match' || node.outcome === 'ignore' || node.outcome === 'other' ? node.outcome : 'other',
      answerMode: node.answerMode === 'auto' ? 'auto' : 'manual',
      chatroomId: typeof node.chatroomId === 'string' ? node.chatroomId : String(node.region || 'unknown'),
      isTraveller: node.isTraveller === true,
    };
  }

  private async hydrateTalkResponsesFromGun(talkId: string): Promise<TalkResponse[]> {
    try {
      const statsNode = await this.gunService.getPath(['talks', talkId, 'stats']);
      if (!statsNode || typeof statsNode !== 'object') return [];
      const responses: TalkResponse[] = [];
      for (const [key, value] of Object.entries(statsNode)) {
        if (key.startsWith('_')) continue;
        const record = this.parseTalkStatsNode(talkId, value);
        if (record) responses.push(record);
      }
      responses.sort((a, b) => a.createdAt - b.createdAt);
      if (responses.length > 0) this.talkResponsesMap.set(talkId, responses);
      return responses;
    } catch (error) {
      logger.warn({ err: error, talkId }, 'stats: failed to hydrate Gun mirrored responses');
      return [];
    }
  }

  private async getTalkResponses(talkId: string, opts?: { from?: number; to?: number }): Promise<TalkResponse[]> {
    const list = this.talkResponsesMap.get(talkId) ?? [];
    const source = list.length > 0 ? list : await this.hydrateTalkResponsesFromGun(talkId);
    if (!opts?.from && !opts?.to) return source;
    return source.filter(
      (r) =>
        (opts.from == null || r.createdAt >= opts.from) &&
        (opts.to == null || r.createdAt <= opts.to),
    );
  }

  private async getAllTalkResponses(): Promise<Map<string, TalkResponse[]>> {
    return new Map(this.talkResponsesMap);
  }

  private clearTalkResponseStats(): void {
    this.talkResponsesMap.clear();
    this.statsIdx.byDay.clear();
    this.statsIdx.byRegion.clear();
    this.statsIdx.byTalkAnswer.clear();
    this.broadcastTagPopularityStore.resetForTesting();
    this.symmetricTalkEdgeRateLimiter.resetForTesting();
    this.dailyWeeklyTalkEdgeQuotaRateLimiter.resetForTesting();
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
      language: talkData?.language || existing.language || 'en',
      authorLocation:
        talkData?.authorLocation && typeof talkData.authorLocation === 'object'
          ? {
              latitude: Number(talkData.authorLocation.latitude),
              longitude: Number(talkData.authorLocation.longitude),
            }
          : existing.authorLocation,
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
    // upsertIncomingTalkForUser writes only to incomingTalksMap (not Gun), so prefer the
    // in-memory map before calling getMergedIncomingClusterForUser (which reads from Gun).
    const userMap = this.incomingTalksMap.get(responderId);
    const inMemoryCluster = userMap?.get(identityKey) ?? userMap?.get(fallbackTalkId);
    const cluster = inMemoryCluster ?? await this.getMergedIncomingClusterForUser(responderId, identityKey);
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
    language: string;
    answers: Array<{ questionId: string; answerId: string; answerText?: string; isChecked?: boolean; mode?: string }>;
    templateEntries: Array<{ questionText: string; answerText: string; mode: string; isChecked: boolean; isIgnore?: boolean }>;
    isAuto: boolean;
  }): Promise<void> {
    const { responderId, identityKey, language, templateEntries, isAuto } = params;
    const exactMemory = await readOrCreateExactChatbotMemoryForUser(this.gunService, responderId);
    const languageContext = { language: String(language || 'en').toLowerCase() };

    for (const entry of templateEntries) {
      if (!entry.questionText) continue;
      if (entry.isIgnore || entry.mode === 'suppressed') {
        saveSuppressedQuestion(exactMemory, responderId, entry.questionText, undefined, languageContext);
      } else if (entry.mode === 'permanent') {
        savePermanentAnswer(exactMemory, responderId, entry.questionText, entry.answerText, undefined, languageContext);
      } else if (entry.mode === 'auto') {
        saveTemporaryAnswer(exactMemory, responderId, entry.questionText, entry.answerText, undefined, languageContext);
      }
    }
    await writeExactChatbotMemoryForUser(this.gunService, responderId, exactMemory);

    // Phase G: Legacy Gun write to talkAnswerTemplateByUser/<userId>/<identityKey> removed.
    // Replaced by per-question cache (talkAnswerTemplateByUser/<userId>/byQuestion/<cidKey>)
    // written in talk-delivery-routes.ts after fanoutResponseToSenders.
    // isAnswered / isAutoAnswered are now tracked directly on the in-memory incomingTalksMap cluster.
    const userMap = this.incomingTalksMap.get(responderId);
    if (userMap) {
      const cluster = userMap.get(identityKey);
      if (cluster) {
        cluster.isAnswered = true;
        cluster.isAutoAnswered = isAuto;
      }
    }
  }

  private async createOrGetConversation(params: {
    responderId: string;
    responderName: string;
    senderId: string;
    senderName: string;
    talkId: string;
    respondedByBotForResponder?: boolean;
    respondedByBotForSender?: boolean;
  }): Promise<{ conversationId: string; otherUserId: string; otherUserName: string }> {
    const {
      responderId,
      responderName,
      senderId,
      senderName,
      talkId,
      respondedByBotForResponder,
      respondedByBotForSender,
    } = params;
    const sortedIds = [responderId, senderId].sort();
    const conversationId = `conv_${sortedIds[0]}_${sortedIds[1]}_${talkId}`;
    const transportMode = createConversationTransportDiagnostics(
      resolveP2PRuntimeFlags(process.env),
    ).activeMode;

    const conversationData = {
      id: conversationId,
      participants: [responderId, senderId],
      talkId,
      createdAt: new Date().toISOString(),
      status: 'active',
      transportMode,
    };

    await this.gunService.putPath(['conversations', conversationId], {
      data: JSON.stringify(conversationData),
    });
    const responderEntry = {
      conversationId,
      otherUserId: senderId,
      otherUserName: senderName,
      talkId,
      createdAt: new Date().toISOString(),
      respondedByBot: !!respondedByBotForResponder,
      transportMode,
    };
    const senderEntry = {
      conversationId,
      otherUserId: responderId,
      otherUserName: responderName,
      talkId,
      createdAt: new Date().toISOString(),
      respondedByBot: !!respondedByBotForSender,
      transportMode,
    };

    if (!this.conversationsMap.has(responderId)) this.conversationsMap.set(responderId, new Map());
    this.conversationsMap.get(responderId)!.set(conversationId, responderEntry);
    if (!this.conversationsMap.has(senderId)) this.conversationsMap.set(senderId, new Map());
    this.conversationsMap.get(senderId)!.set(conversationId, senderEntry);

    await this.gunService.putPath(['users', responderId, 'conversations', conversationId], responderEntry);
    await this.gunService.putPath(['users', senderId, 'conversations', conversationId], senderEntry);

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
          respondedByBotForResponder: false,
          respondedByBotForSender: isChatbotResponse,
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
    registerSystemRoutes(this.app, {
      gun: this.gun,
      gunService: this.gunService,
      incomingTalksMap: this.incomingTalksMap,
      conversationsMap: this.conversationsMap,
      talkResponsesMap: this.talkResponsesMap,
      statsIdx: this.statsIdx,
      clearTalkResponseStats: this.clearTalkResponseStats.bind(this),
      onClearDatabase: () => {
        this.userService.resetBlockMutationsForTesting();
      },
      nodeEnv: process.env.NODE_ENV,
    });

    registerUserRoutes(this.app, { userService: this.userService });

    registerTalkRoutes(this.app, {
      talkService: this.talkService,
      loadTalkDataFromGraphOrBody: this.loadTalkDataFromGraphOrBody.bind(this),
    });

    registerTalkDeliveryRoutes(this.app, {
      gunService: this.gunService,
      incomingTalksMap: this.incomingTalksMap,
      loadTalkDataFromGraphOrBody: this.loadTalkDataFromGraphOrBody.bind(this),
      getUserStageName: this.getUserStageName.bind(this),
      upsertIncomingTalkForUser: this.upsertIncomingTalkForUser.bind(this),
      mapTemplateEntriesToTalk: this.mapTemplateEntriesToTalk.bind(this),
      fanoutResponseToSenders: this.fanoutResponseToSenders.bind(this),
      normalizeSubmittedAnswersForTalk: this.normalizeSubmittedAnswersForTalk.bind(this),
      getClusterSenders: this.getClusterSenders.bind(this),
      deriveIsAutoAnswerSet: this.deriveIsAutoAnswerSet.bind(this),
      buildAnswerTemplateEntries: this.buildAnswerTemplateEntries.bind(this),
      saveUserAnswerTemplateByContent: this.saveUserAnswerTemplateByContent.bind(this),
      getUserRegion: this.getUserRegion.bind(this),
      getUserDeliveryContext: this.userService.getUserDeliveryContext.bind(this.userService),
      getBlockStatus: this.userService.getBlockStatus.bind(this.userService),
      getSenderBulkSendCapacity: async (senderId: string) => {
        try {
          const sender = await this.userService.getUser(senderId);
          if (!sender) return CONFIG.DEFAULT_BULK_LIMIT;
          const cap = await this.reputationService.getBulkSendCapacity(sender);
          return Number.isFinite(cap) ? Math.max(0, Math.floor(cap)) : CONFIG.DEFAULT_BULK_LIMIT;
        } catch {
          return CONFIG.DEFAULT_BULK_LIMIT;
        }
      },
      recordTalkStatsResponse: this.recordTalkStatsResponse.bind(this),
      recordBroadcastTargetTagUses: (tags: string[]) =>
        this.broadcastTagPopularityStore.recordFromTargetTags(tags),
      getServerBlockedTerms: () => getServerBlockedTerms(),
      symmetricTalkEdgeLimiter: this.symmetricTalkEdgeRateLimiter,
      dailyWeeklyTalkEdgeQuotaRateLimiter: this.dailyWeeklyTalkEdgeQuotaRateLimiter,
    });

    registerChatroomRoutes(this.app, { chatroomManager: this.chatroomManager });

    registerPeerRoutes(this.app, {
      incomingTalksMap: this.incomingTalksMap,
      talkResponsesMap: this.talkResponsesMap,
      getUserStageName: async (userId: string, fallbackName?: string) =>
        this.getUserStageName(userId, fallbackName || 'Unknown'),
      getBlockStatus: this.userService.getBlockStatus.bind(this.userService),
    });

    registerStatsRoutes(this.app, {
      talkService: this.talkService,
      getUserRegion: this.getUserRegion.bind(this),
      recordTalkStatsResponse: this.recordTalkStatsResponse.bind(this),
      getTalkResponses: this.getTalkResponses.bind(this),
      getAllTalkResponses: this.getAllTalkResponses.bind(this),
      getBroadcastTagPopularity: () => this.broadcastTagPopularityStore.getSnapshot(),
      getBroadcastTagTrends: (days: number) => this.broadcastTagPopularityStore.getTrends(days),
    });

  }

  private setupSocketHandlers(): void {
    registerSocketHandlers(this.io, {
      chatroomManager: this.chatroomManager,
      talkService: this.talkService,
      userService: this.userService,
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
