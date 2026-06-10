import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { GunService } from './services/gun-service';
import { ChatroomManager } from './services/chatroom-manager';
import { TalkService } from './services/talk-service';
import { UserService } from './services/user-service';
import { ReputationService } from './services/reputation-service';
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
import { BroadcastTagPopularityStore } from './services/broadcast-tag-popularity-store';
import { SymmetricTalkEdgeRateLimiter } from './services/symmetric-talk-edge-rate-limit';
import { DailyWeeklyTalkEdgeQuotaRateLimiter } from './services/daily-weekly-talk-edge-quota-rate-limit';
import { registerSystemRoutes } from './routes/system-routes';
import { registerTalkRoutes } from './routes/talk-routes';
import { registerUserRoutes } from './routes/user-routes';
import { registerSocketHandlers } from './socket/register-socket-handlers';
import { MailboxStore } from './services/mailbox-store';
import { registerMailboxRoutes } from './routes/mailbox-routes';
import {
  inspectSchemaVersions,
  type SchemaKind,
} from '../shared/p2p-schema-migrations';

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

  private mailboxStore = new MailboxStore();
  private mailboxSweepTimer: ReturnType<typeof setInterval> | undefined;

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
    this.logStartupSchemaDiagnostics();
  }

  /**
   * P2P-X: Log schema-version diagnostics for in-memory record stores at
   * startup so operators can see whether pending migrations exist.
   * Runs synchronously; actual record migration happens on-read via migrateRecord.
   */
  private logStartupSchemaDiagnostics(): void {
    const kinds: SchemaKind[] = [
      'presence', 'peerOffer', 'catalogRecord', 'pairResponse', 'pairConversation',
      'knownPerson', 'neighborCache', 'ledgerEvent', 'localInIndex', 'localOutIndex',
      'peerTrustRecord', 'handshakeRecord',
    ];
    for (const kind of kinds) {
      // Server starts with empty in-memory maps; log zero pending as confirmation.
      const diag = inspectSchemaVersions(kind, []);
      if (diag.pendingMigrations > 0) {
        logger.info({ kind, pendingMigrations: diag.pendingMigrations, currentVersion: diag.currentVersion },
          'P2P-X: schema migration needed for stored records');
      }
    }
    logger.info({ kinds }, 'P2P-X: startup schema diagnostics complete');
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
    this.mailboxStore.resetForTesting();
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

    registerMailboxRoutes(this.app, {
      mailboxStore: this.mailboxStore,
      nodeEnv: process.env.NODE_ENV,
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
    // Periodic mailbox sweep: evict expired envelopes every 5 minutes.
    this.mailboxSweepTimer = setInterval(() => {
      this.mailboxStore.pruneExpired();
    }, 5 * 60 * 1000);
    if (this.mailboxSweepTimer.unref) this.mailboxSweepTimer.unref();
  }
}

// Start server
if (require.main === module) {
  const server = new IinPublicServer();
  const port = process.env.PORT ? parseInt(process.env.PORT) : 8080;
  server.start(port);
}

export default IinPublicServer;
