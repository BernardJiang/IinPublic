/**
 * End-to-end integration tests for the server-side talk loop:
 *   incoming talk registration → inbox query → answer submission → match → stats
 *
 * Uses a minimal Express app built from the real route-registration functions with:
 *   - real in-memory state (incomingTalksMap, talkResponsesMap)
 *   - real business logic (match detection, stats, upsert, fanout)
 *   - stub GunService (null reads, no-op writes — Gun is not needed for the core path)
 */
import express from 'express';
import request from 'supertest';
import { registerTalkDeliveryRoutes } from '../../server/routes/talk-delivery-routes';
import { registerStatsRoutes } from '../../server/routes/stats-routes';
import { BroadcastTagPopularityStore } from '../../server/services/broadcast-tag-popularity-store';
import { SymmetricTalkEdgeRateLimiter } from '../../server/services/symmetric-talk-edge-rate-limit';
import { DailyWeeklyTalkEdgeQuotaRateLimiter } from '../../server/services/daily-weekly-talk-edge-quota-rate-limit';
import { checkIfMatch } from '../../shared/talk-engine';
import { buildTalkIdentityKey } from '../../shared/talk-content-id';
import { TALK_CONTENT_HASH_ID } from '../../shared/incoming-talk-ids';
import { getDefaultTalkIntakeFilters } from '../../shared/talk-intake-filters';
import { bucketKey, type TalkResponse, type TalkType } from '../../shared/talk-stats';
import {
  createEmptyExactChatbotMemoryState,
  savePermanentAnswer,
  saveSuppressedQuestion,
  saveTemporaryAnswer,
  type ExactChatbotMemoryState,
} from '../../shared/exact-chatbot-memory';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SENDER_ID = 'user_alice';
const SENDER_NAME = 'Alice';
const RESPONDER_ID = 'user_bob';
const RESPONDER_NAME = 'Bob';

const TALK_DATA = {
  id: 'talk_abc123',
  title: 'What is your favorite color?',
  authorId: SENDER_ID,
  type: 'flow' as TalkType,
  isAdult: false,
  language: 'en',
  tags: [],
  questions: [
    {
      id: 'q1',
      text: 'What is your favorite color?',
      answers: [
        { id: 'a_blue', text: 'Blue', isMatch: true, isTerminal: true },
        { id: 'a_red', text: 'Red', isIgnore: true, isTerminal: true },
      ],
    },
  ],
  createdAt: new Date().toISOString(),
  isTemplate: false,
  usageCount: 0,
};

const ADULT_TALK_DATA = {
  ...TALK_DATA,
  id: 'talk_adult_123',
  title: 'Adults only meetup',
  isAdult: true,
};

const EXPIRED_TALK_DATA = {
  ...TALK_DATA,
  id: 'talk_expired_123',
  title: 'Past meetup',
  expiresAt: Date.now() - 60_000,
};

const MATCHING_ANSWERS = [{ questionId: 'q1', answerId: 'a_blue', answerText: 'Blue' }];
const NON_MATCHING_ANSWERS = [{ questionId: 'q1', answerId: 'a_red', answerText: 'Red' }];

function getRouteTestTalkIntakeFilters() {
  return {
    ...getDefaultTalkIntakeFilters(['en']),
    requireGoodGrammar: false,
  };
}

// ---------------------------------------------------------------------------
// Test server factory
// ---------------------------------------------------------------------------

function buildTestServer(opts?: {
  symmetricCooldownMs?: number;
  talkSendDailyLimit?: number;
  talkSendWeeklyLimit?: number;
  getServerBlockedTerms?: () => string[];
  exactMemoryByUser?: Map<string, ExactChatbotMemoryState>;
}) {
  const app = express();
  app.use(express.json());

  const incomingTalksMap: Map<string, Map<string, any>> = new Map();
  const talkResponsesMap: Map<string, TalkResponse[]> = new Map();
  const statsIdx = {
    byDay: new Map<string, Set<string>>(),
    byRegion: new Map<string, Set<string>>(),
    byTalkAnswer: new Map<string, Set<string>>(),
  };
  const userDeliveryContext = new Map<string, {
    talkFilters: ReturnType<typeof getDefaultTalkIntakeFilters>;
    ageVerified: boolean;
    location?: { latitude: number; longitude: number; accuracy: number; timestamp: Date };
    interestTokens?: string[];
  }>();
  const blockedByUser = new Map<string, Set<string>>();
  const senderBulkCapacity = new Map<string, number>();
  const broadcastTagPopularityStore = new BroadcastTagPopularityStore();
  const symmetricTalkEdgeLimiter = new SymmetricTalkEdgeRateLimiter(opts?.symmetricCooldownMs ?? 0);
  const dailyWeeklyTalkEdgeQuotaRateLimiter = new DailyWeeklyTalkEdgeQuotaRateLimiter({
    daily: opts?.talkSendDailyLimit ?? 0,
    weekly: opts?.talkSendWeeklyLimit ?? 0,
  });

  const exactMemoryByUser = opts?.exactMemoryByUser ?? new Map<string, ExactChatbotMemoryState>();

  // Stub GunService — exact chatbot memory reads/writes are backed by an in-memory map.
  const gunService = {
    getPath: jest.fn().mockImplementation(async (path: string[]) => {
      if (path[0] === 'exactChatbotMemoryByUser' && path[1]) {
        const state = exactMemoryByUser.get(path[1]);
        return state ? { stateJson: JSON.stringify(state), updatedAt: new Date().toISOString() } : null;
      }
      return null;
    }),
    putPath: jest.fn().mockImplementation(async (path: string[], value: any) => {
      if (path[0] === 'exactChatbotMemoryByUser' && path[1] && value?.stateJson) {
        exactMemoryByUser.set(path[1], JSON.parse(value.stateJson));
      }
    }),
  } as any;

  // ---- Pure helpers (mirrors of IinPublicServer private methods) -----------

  function normalizeSubmittedAnswersForTalk(talkData: any, answers: any[]): any[] {
    if (talkData?.type !== 'tag') return answers;
    return answers.map((answer) => {
      const question = talkData.questions?.find((q: any) => q.id === answer.questionId);
      const selected = question?.answers?.find((a: any) => a.id === answer.answerId);
      return { ...answer, answerText: answer.answerText ?? selected?.text, isChecked: selected?.isMatch === true };
    });
  }

  function buildAnswerTemplateEntries(talkData: any, answers: any[]): any[] {
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

  function deriveIsAutoAnswerSet(answers: any[], explicitIsAuto?: boolean, isChatbotResponse?: boolean): boolean {
    if (explicitIsAuto != null) return !!explicitIsAuto;
    if (isChatbotResponse) return true;
    if (!Array.isArray(answers) || answers.length === 0) return false;
    return answers.every((a) => String(a?.mode || '').toLowerCase() === 'auto');
  }

  function mapTemplateEntriesToTalk(entries: any[], _talkData: any): any[] {
    return entries;
  }

  // ---- Stateful helpers -------------------------------------------------------

  async function loadTalkDataFromGraphOrBody(_talkId: string, bodyTalkData?: unknown): Promise<any | null> {
    if (bodyTalkData && typeof bodyTalkData === 'object') return bodyTalkData;
    return null;
  }

  async function getUserStageName(userId: string, fallback: string): Promise<string> {
    return userId || fallback;
  }

  async function getUserRegion(_userId: string): Promise<string> {
    return 'test-region';
  }

  async function getUserDeliveryContext(userId: string) {
    const defaults = {
      talkFilters: getRouteTestTalkIntakeFilters(),
      ageVerified: false,
      interestTokens: [] as string[],
    };
    const fromMap = userDeliveryContext.get(userId);
    return fromMap ? { ...defaults, ...fromMap } : defaults;
  }

  async function getBlockStatus(viewerId: string, targetId: string) {
    const blocked = blockedByUser.get(viewerId)?.has(targetId) ?? false;
    const blockedBy = blockedByUser.get(targetId)?.has(viewerId) ?? false;
    return { blocked, blockedBy, eitherBlocked: blocked || blockedBy };
  }

  async function getSenderBulkSendCapacity(senderId: string) {
    return senderBulkCapacity.get(senderId) ?? 1000;
  }

  async function upsertIncomingTalkForUser(params: {
    receiverId: string;
    talkId: string;
    talkData: any;
    senderId: string;
    senderName?: string;
  }): Promise<{ identityKey: string }> {
    const { receiverId, talkId, talkData, senderId, senderName } = params;
    const identityKey = buildTalkIdentityKey(talkData);
    const tid = typeof talkId === 'string' ? talkId.trim() : '';
    const useTalkIdAsLeaf = tid.length > 0 && TALK_CONTENT_HASH_ID.test(tid);

    const nowIso = new Date().toISOString();
    if (!incomingTalksMap.has(receiverId)) incomingTalksMap.set(receiverId, new Map());
    const userMap = incomingTalksMap.get(receiverId)!;
    const storageLeaf = useTalkIdAsLeaf ? tid : identityKey;
    const prev = userMap.get(storageLeaf) ?? { senders: {}, talkIds: {}, identityAliases: {} };

    const senderMap = { ...prev.senders, [senderId]: { senderId, senderName: senderName || 'Someone', lastTalkId: talkId, lastReceivedAt: nowIso } };
    const talkIds = { ...prev.talkIds, [talkId]: nowIso };
    const cluster = {
      identityKey,
      title: talkData?.title || prev.title || '',
      type: talkData?.type || 'flow',
      questionCount: Array.isArray(talkData?.questions) ? talkData.questions.length : 0,
      senders: senderMap,
      talkIds,
      latestTalkId: talkId,
      updatedAt: nowIso,
      identityAliases: { ...prev.identityAliases, [identityKey]: true },
    };
    userMap.set(storageLeaf, cluster);
    return { identityKey };
  }

  async function getClusterSenders(params: {
    responderId: string;
    identityKey: string;
    fallbackTalkId: string;
    fallbackSenderId?: string;
  }): Promise<Array<{ senderId: string; senderName: string; talkId: string }>> {
    const { responderId, identityKey, fallbackTalkId, fallbackSenderId } = params;
    const userMap = incomingTalksMap.get(responderId);
    const cluster = userMap?.get(identityKey) ?? userMap?.get(fallbackTalkId) ?? null;
    const list: Array<{ senderId: string; senderName: string; talkId: string }> = [];
    const seen = new Set<string>();
    if (cluster?.senders && typeof cluster.senders === 'object') {
      for (const sender of Object.values(cluster.senders as Record<string, any>)) {
        const sid = (sender as any)?.senderId;
        if (!sid || sid === responderId || seen.has(sid)) continue;
        seen.add(sid);
        list.push({ senderId: sid, senderName: (sender as any).senderName || 'Someone', talkId: (sender as any).lastTalkId || fallbackTalkId });
      }
    }
    if (fallbackSenderId && fallbackSenderId !== responderId && !seen.has(fallbackSenderId)) {
      seen.add(fallbackSenderId);
      list.push({ senderId: fallbackSenderId, senderName: await getUserStageName(fallbackSenderId, 'Someone'), talkId: fallbackTalkId });
    }
    return list;
  }

  async function saveUserAnswerTemplateByContent(_params: any): Promise<void> {
    // Gun write — no-op in tests
  }

  async function fanoutResponseToSenders(params: {
    talkData: any;
    sourceTalkId: string;
    responderId: string;
    responderName: string;
    answers: any[];
    senders: Array<{ senderId: string; senderName: string; talkId: string }>;
    isChatbotResponse: boolean;
    storeOnSourceTalk: boolean;
  }): Promise<Array<{ senderId: string; senderName: string; conversationId: string; talkId: string }>> {
    const { talkData, sourceTalkId, responderId, responderName, answers, senders, isChatbotResponse } = params;
    const isMatch = checkIfMatch(talkData, answers);
    const matches: Array<{ senderId: string; senderName: string; conversationId: string; talkId: string }> = [];
    for (const sender of senders) {
      if (!sender?.senderId || sender.senderId === responderId) continue;
      const targetTalkId = sender.talkId || sourceTalkId;
      // Gun write (response record) — no-op in tests
      await gunService.putPath(['talks', targetTalkId, 'responses', `resp_test`], {
        responderId,
        responderName,
        answers: JSON.stringify(answers),
        submittedAt: new Date().toISOString(),
        isChatbotResponse,
        backendRecorded: true,
        authorId: sender.senderId,
        authorName: sender.senderName,
      });
      if (isMatch) {
        const sortedIds = [responderId, sender.senderId].sort();
        const conversationId = `conv_${sortedIds[0]}_${sortedIds[1]}_${targetTalkId}`;
        // Gun write (conversation) — no-op in tests
        await gunService.putPath(['conversations', conversationId], { data: JSON.stringify({ id: conversationId }) });
        matches.push({ senderId: sender.senderId, senderName: sender.senderName, conversationId, talkId: targetTalkId });
      }
    }
    return matches;
  }

  async function recordTalkStatsResponse(params: {
    talkId: string;
    talkType: TalkType;
    responderId: string;
    region: string;
    answers: Array<{ questionId: string; answerId: string; answerText: string }>;
    outcome?: 'match' | 'ignore' | 'other';
  }): Promise<void> {
    const { talkId, talkType, responderId, region, answers, outcome } = params;
    const responseId = `sr_test_${Date.now()}`;
    const createdAt = Date.now();
    const record: TalkResponse = { responseId, talkId, talkType, responderId, region, answers, createdAt, outcome: outcome ?? 'other' };
    const list = talkResponsesMap.get(talkId) ?? [];
    list.push(record);
    talkResponsesMap.set(talkId, list);
    const dayKey = `${bucketKey(createdAt, 'day')}|${talkId}`;
    (statsIdx.byDay.get(dayKey) ?? statsIdx.byDay.set(dayKey, new Set()).get(dayKey)!).add(responseId);
    (statsIdx.byRegion.get(`${region}|${talkId}`) ?? statsIdx.byRegion.set(`${region}|${talkId}`, new Set()).get(`${region}|${talkId}`)!).add(responseId);
  }

  function getTalkResponses(talkId: string, opts?: { from?: number; to?: number }): TalkResponse[] {
    const list = talkResponsesMap.get(talkId) ?? [];
    if (!opts?.from && !opts?.to) return list;
    return list.filter(
      (r) =>
        (opts!.from == null || r.createdAt >= opts!.from) &&
        (opts!.to == null || r.createdAt <= opts!.to),
    );
  }

  function getAllTalkResponses(): Map<string, TalkResponse[]> {
    return new Map(talkResponsesMap);
  }

  registerTalkDeliveryRoutes(app, {
    gunService,
    incomingTalksMap,
    loadTalkDataFromGraphOrBody,
    getUserStageName,
    upsertIncomingTalkForUser,
    mapTemplateEntriesToTalk,
    fanoutResponseToSenders,
    normalizeSubmittedAnswersForTalk,
    getClusterSenders,
    deriveIsAutoAnswerSet,
    buildAnswerTemplateEntries,
    saveUserAnswerTemplateByContent,
    getUserRegion,
    getUserDeliveryContext,
    getBlockStatus,
    getSenderBulkSendCapacity,
    recordTalkStatsResponse,
    recordBroadcastTargetTagUses: (tags: string[]) => broadcastTagPopularityStore.recordFromTargetTags(tags),
    symmetricTalkEdgeLimiter,
    dailyWeeklyTalkEdgeQuotaRateLimiter,
    ...(opts?.getServerBlockedTerms ? { getServerBlockedTerms: opts.getServerBlockedTerms } : {}),
  });

  registerStatsRoutes(app, {
    talkService: null as any, // not exercised in these tests
    getUserRegion,
    recordTalkStatsResponse,
    getTalkResponses,
    getAllTalkResponses,
    getBroadcastTagPopularity: () => broadcastTagPopularityStore.getSnapshot(),
    getBroadcastTagTrends: (days: number) => broadcastTagPopularityStore.getTrends(days),
  });

  return {
    app,
    incomingTalksMap,
    talkResponsesMap,
    userDeliveryContext,
    blockedByUser,
    senderBulkCapacity,
    broadcastTagPopularityStore,
    exactMemoryByUser,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Talk loop — incoming registration → answer submission → match → stats', () => {
  const talkId = TALK_DATA.id;

  describe('POST /api/talks/:id/received — incoming talk registration', () => {
    it('registers a sender and returns identityKey', async () => {
      const { app } = buildTestServer();
      const res = await request(app)
        .post(`/api/talks/${talkId}/received`)
        .send({ receiverId: RESPONDER_ID, senderId: SENDER_ID, senderName: SENDER_NAME, talkData: TALK_DATA });

      expect(res.status).toBe(200);
      expect(res.body.registered).toBe(true);
      expect(typeof res.body.identityKey).toBe('string');
      expect(res.body.identityKey.length).toBeGreaterThan(0);
    });

    it('auto-responds from exact chatbot memory when a compatible permanent answer exists', async () => {
      const exactMemoryByUser = new Map<string, ExactChatbotMemoryState>();
      const state = createEmptyExactChatbotMemoryState();
      savePermanentAnswer(state, RESPONDER_ID, 'What is your favorite color?', 'Blue', 1000);
      exactMemoryByUser.set(RESPONDER_ID, state);
      const { app } = buildTestServer({ exactMemoryByUser });

      const res = await request(app)
        .post(`/api/talks/${talkId}/received`)
        .send({ receiverId: RESPONDER_ID, senderId: SENDER_ID, senderName: SENDER_NAME, talkData: TALK_DATA });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        registered: true,
        autoResponded: true,
        isMatch: true,
        reason: 'exact_chatbot_memory',
      });
      const updated = exactMemoryByUser.get(RESPONDER_ID)!;
      const event = Object.values(Object.values(updated.users[RESPONDER_ID])[0].history)[0];
      expect(event.autoUseCount).toBe(1);
    });

    it('does not reuse English exact memory for an identical Chinese-language talk', async () => {
      const exactMemoryByUser = new Map<string, ExactChatbotMemoryState>();
      const state = createEmptyExactChatbotMemoryState();
      savePermanentAnswer(state, RESPONDER_ID, 'What is your favorite color?', 'Blue', 1000, { language: 'en' });
      exactMemoryByUser.set(RESPONDER_ID, state);
      const { app, userDeliveryContext } = buildTestServer({ exactMemoryByUser });
      userDeliveryContext.set(RESPONDER_ID, {
        talkFilters: { ...getDefaultTalkIntakeFilters(['en', 'zh']), requireGoodGrammar: false },
        ageVerified: false,
      });

      const res = await request(app)
        .post('/api/talks/talk_chinese_memory/received')
        .send({
          receiverId: RESPONDER_ID,
          senderId: SENDER_ID,
          senderName: SENDER_NAME,
          talkData: { ...TALK_DATA, id: 'talk_chinese_memory', language: 'zh' },
        });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ registered: true, autoResponded: false });
    });

    it('registers but does not auto-respond from saved memory when chatbot is disabled', async () => {
      const exactMemoryByUser = new Map<string, ExactChatbotMemoryState>();
      const state = createEmptyExactChatbotMemoryState();
      savePermanentAnswer(state, RESPONDER_ID, 'What is your favorite color?', 'Blue', 1000);
      exactMemoryByUser.set(RESPONDER_ID, state);
      const { app } = buildTestServer({ exactMemoryByUser });

      const res = await request(app)
        .post(`/api/talks/${talkId}/received`)
        .send({
          receiverId: RESPONDER_ID,
          senderId: SENDER_ID,
          senderName: SENDER_NAME,
          talkData: TALK_DATA,
          chatbotEnabled: false,
        });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        registered: true,
        autoResponded: false,
        reason: 'chatbot_disabled',
      });
      const event = Object.values(Object.values(exactMemoryByUser.get(RESPONDER_ID)!.users[RESPONDER_ID])[0].history)[0];
      expect(event.autoUseCount).toBe(0);
    });

    it('registers but skips auto-response when a permanent answer is absent from current options', async () => {
      const exactMemoryByUser = new Map<string, ExactChatbotMemoryState>();
      const state = createEmptyExactChatbotMemoryState();
      saveTemporaryAnswer(state, RESPONDER_ID, 'What is your favorite color?', 'Blue', 1000);
      savePermanentAnswer(state, RESPONDER_ID, 'What is your favorite color?', 'Green', 2000);
      exactMemoryByUser.set(RESPONDER_ID, state);
      const { app } = buildTestServer({ exactMemoryByUser });

      const res = await request(app)
        .post(`/api/talks/${talkId}/received`)
        .send({ receiverId: RESPONDER_ID, senderId: SENDER_ID, senderName: SENDER_NAME, talkData: TALK_DATA });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        registered: true,
        autoResponded: false,
        reason: 'exact_chatbot_memory_skip',
      });
    });

    it('registers but skips auto-response for suppressed exact questions', async () => {
      const exactMemoryByUser = new Map<string, ExactChatbotMemoryState>();
      const state = createEmptyExactChatbotMemoryState();
      saveTemporaryAnswer(state, RESPONDER_ID, 'What is your favorite color?', 'Blue', 1000);
      saveSuppressedQuestion(state, RESPONDER_ID, 'What is your favorite color?', 2000);
      exactMemoryByUser.set(RESPONDER_ID, state);
      const { app } = buildTestServer({ exactMemoryByUser });

      const res = await request(app)
        .post(`/api/talks/${talkId}/received`)
        .send({ receiverId: RESPONDER_ID, senderId: SENDER_ID, senderName: SENDER_NAME, talkData: TALK_DATA });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        registered: true,
        autoResponded: false,
        reason: 'exact_chatbot_memory_skip',
      });
    });

    it('returns 400 when receiverId or senderId is missing', async () => {
      const { app } = buildTestServer();
      const res = await request(app)
        .post(`/api/talks/${talkId}/received`)
        .send({ senderId: SENDER_ID, talkData: TALK_DATA });
      expect(res.status).toBe(400);
    });

    it('returns 404 when talk data cannot be resolved', async () => {
      const { app } = buildTestServer();
      const res = await request(app)
        .post(`/api/talks/unknown_talk/received`)
        .send({ receiverId: RESPONDER_ID, senderId: SENDER_ID });
      expect(res.status).toBe(404);
    });

    it('does not register a talk when receiver filters reject it', async () => {
      const { app, incomingTalksMap, userDeliveryContext } = buildTestServer();
      userDeliveryContext.set(RESPONDER_ID, {
        talkFilters: {
          ...getRouteTestTalkIntakeFilters(),
          allowedTalkTypes: ['tag'],
        },
        ageVerified: false,
      });

      const res = await request(app)
        .post(`/api/talks/${talkId}/received`)
        .send({ receiverId: RESPONDER_ID, senderId: SENDER_ID, senderName: SENDER_NAME, talkData: TALK_DATA });

      expect(res.status).toBe(200);
      expect(res.body.registered).toBe(false);
      expect(res.body.filteredOut).toBe(true);
      expect(res.body.rejectedBy).toContain('intake_talk_type');
      expect(incomingTalksMap.get(RESPONDER_ID)).toBeUndefined();
    });

    it('accepts English and Chinese talks while rejecting a third language', async () => {
      const { app, incomingTalksMap, userDeliveryContext } = buildTestServer();
      userDeliveryContext.set(RESPONDER_ID, {
        talkFilters: {
          ...getRouteTestTalkIntakeFilters(),
          allowedLanguages: ['en', 'zh'],
        },
        ageVerified: false,
      });

      const deliver = (language: string) => request(app)
        .post(`/api/talks/talk_${language}/received`)
        .send({
          receiverId: RESPONDER_ID,
          senderId: SENDER_ID,
          senderName: SENDER_NAME,
          talkData: { ...TALK_DATA, id: `talk_${language}`, title: `Language ${language}`, language },
        });

      const english = await deliver('en');
      const chinese = await deliver('zh');
      const spanish = await deliver('es');

      expect(english.body.registered).toBe(true);
      expect(chinese.body.registered).toBe(true);
      expect(spanish.body).toMatchObject({ registered: false, filteredOut: true });
      expect(spanish.body.rejectedBy).toContain('intake_language');
      const acceptedTalkIds = Array.from(incomingTalksMap.get(RESPONDER_ID)?.values() || [])
        .flatMap((cluster: any) => Object.keys(cluster.talkIds || {}));
      expect(acceptedTalkIds).toEqual(expect.arrayContaining(['talk_en', 'talk_zh']));
      expect(acceptedTalkIds).not.toContain('talk_es');
    });

    it('does not register a talk when either user blocked the other', async () => {
      const { app, incomingTalksMap, blockedByUser } = buildTestServer();
      blockedByUser.set(RESPONDER_ID, new Set([SENDER_ID]));

      const res = await request(app)
        .post(`/api/talks/${talkId}/received`)
        .send({ receiverId: RESPONDER_ID, senderId: SENDER_ID, senderName: SENDER_NAME, talkData: TALK_DATA });

      expect(res.status).toBe(200);
      expect(res.body.registered).toBe(false);
      expect(res.body.filteredOut).toBe(true);
      expect(res.body.rejectedBy).toContain('blocked_user');
      expect(incomingTalksMap.get(RESPONDER_ID)).toBeUndefined();
    });

    it('does not register an adult talk for a receiver who is not age verified by default', async () => {
      const { app, incomingTalksMap } = buildTestServer();

      const res = await request(app)
        .post(`/api/talks/${ADULT_TALK_DATA.id}/received`)
        .send({
          receiverId: RESPONDER_ID,
          senderId: SENDER_ID,
          senderName: SENDER_NAME,
          talkData: ADULT_TALK_DATA,
        });

      expect(res.status).toBe(200);
      expect(res.body.registered).toBe(false);
      expect(res.body.filteredOut).toBe(true);
      expect(res.body.rejectedBy).toContain('age_gate');
      expect(incomingTalksMap.get(RESPONDER_ID)).toBeUndefined();
    });

    it('does not register when receiver maxDistance intake rejects author location', async () => {
      const { app, incomingTalksMap, userDeliveryContext } = buildTestServer();
      userDeliveryContext.set(RESPONDER_ID, {
        talkFilters: {
          ...getRouteTestTalkIntakeFilters(),
          maxDistanceMiles: 50,
        },
        ageVerified: false,
        location: {
          latitude: 37.7749,
          longitude: -122.4194,
          accuracy: 100,
          timestamp: new Date(),
        },
      });
      const farTalk = {
        ...TALK_DATA,
        authorLocation: { latitude: 40.7128, longitude: -74.006 },
      };

      const res = await request(app)
        .post(`/api/talks/${talkId}/received`)
        .send({ receiverId: RESPONDER_ID, senderId: SENDER_ID, senderName: SENDER_NAME, talkData: farTalk });

      expect(res.status).toBe(200);
      expect(res.body.registered).toBe(false);
      expect(res.body.filteredOut).toBe(true);
      expect(res.body.rejectedBy).toContain('intake_max_distance');
      expect(incomingTalksMap.get(RESPONDER_ID)).toBeUndefined();
    });

    it('accepts only talks inside a configured minimum and maximum distance band', async () => {
      const { app, incomingTalksMap, userDeliveryContext } = buildTestServer();
      userDeliveryContext.set(RESPONDER_ID, {
        talkFilters: {
          ...getRouteTestTalkIntakeFilters(),
          minDistanceMiles: 0.1,
          maxDistanceMiles: 1,
        },
        ageVerified: false,
        location: {
          latitude: 37.7749,
          longitude: -122.4194,
          accuracy: 10,
          timestamp: new Date(),
        },
      });
      const deliver = (id: string, authorLocation: { latitude: number; longitude: number }) => request(app)
        .post(`/api/talks/${id}/received`)
        .send({
          receiverId: RESPONDER_ID,
          senderId: SENDER_ID,
          senderName: SENDER_NAME,
          talkData: { ...TALK_DATA, id, title: id, authorLocation },
        });

      const tooNear = await deliver('too_near', { latitude: 37.7749, longitude: -122.4194 });
      const inBand = await deliver('in_band', { latitude: 37.781, longitude: -122.4194 });
      const tooFar = await deliver('too_far', { latitude: 37.81, longitude: -122.4194 });

      expect(tooNear.body.rejectedBy).toContain('intake_min_distance');
      expect(inBand.body.registered).toBe(true);
      expect(tooFar.body.rejectedBy).toContain('intake_max_distance');
      expect(incomingTalksMap.get(RESPONDER_ID)?.size).toBe(1);
    });

    it('does not register when dirty-word intake applies to questionsJson-only payload', async () => {
      const { app, incomingTalksMap, userDeliveryContext } = buildTestServer();
      userDeliveryContext.set(RESPONDER_ID, {
        talkFilters: {
          ...getRouteTestTalkIntakeFilters(),
          blockDirtyWords: true,
          requireGoodGrammar: false,
        },
        ageVerified: false,
      });
      const talk = {
        ...TALK_DATA,
        questions: [],
        questionsJson: JSON.stringify([
          { text: 'Fake bot message spam', answers: [{ text: 'ok' }] },
        ]),
      };

      const res = await request(app)
        .post(`/api/talks/${talkId}/received`)
        .send({ receiverId: RESPONDER_ID, senderId: SENDER_ID, senderName: SENDER_NAME, talkData: talk });

      expect(res.status).toBe(200);
      expect(res.body.registered).toBe(false);
      expect(res.body.filteredOut).toBe(true);
      expect(res.body.rejectedBy).toContain('intake_dirty_words');
      expect(incomingTalksMap.get(RESPONDER_ID)).toBeUndefined();
    });

    it('does not register when receiver custom blocked phrases match talk text', async () => {
      const { app, incomingTalksMap, userDeliveryContext } = buildTestServer();
      userDeliveryContext.set(RESPONDER_ID, {
        talkFilters: {
          ...getRouteTestTalkIntakeFilters(),
          customBlockedTerms: ['forbiddenword'],
          requireGoodGrammar: false,
        },
        ageVerified: false,
      });
      const talk = { ...TALK_DATA, title: 'Title with forbiddenword inside' };
      const res = await request(app)
        .post(`/api/talks/${talkId}/received`)
        .send({ receiverId: RESPONDER_ID, senderId: SENDER_ID, senderName: SENDER_NAME, talkData: talk });

      expect(res.status).toBe(200);
      expect(res.body.registered).toBe(false);
      expect(res.body.rejectedBy).toContain('intake_custom_blocked_terms');
      expect(incomingTalksMap.get(RESPONDER_ID)).toBeUndefined();
    });

    it('does not register when server-wide blocked terms match talk text', async () => {
      const { app, incomingTalksMap } = buildTestServer({
        getServerBlockedTerms: () => ['serverbad'],
      });
      const talk = { ...TALK_DATA, title: 'Hello serverbad there' };
      const res = await request(app)
        .post(`/api/talks/${talkId}/received`)
        .send({ receiverId: RESPONDER_ID, senderId: SENDER_ID, senderName: SENDER_NAME, talkData: talk });

      expect(res.status).toBe(200);
      expect(res.body.registered).toBe(false);
      expect(res.body.rejectedBy).toContain('moderation_server_terms');
      expect(incomingTalksMap.get(RESPONDER_ID)).toBeUndefined();
    });

    it('rejects a second /received for the same pair while symmetric cooldown is active', async () => {
      const { app } = buildTestServer({ symmetricCooldownMs: 3_600_000 });
      await request(app)
        .post(`/api/talks/${talkId}/received`)
        .send({ receiverId: RESPONDER_ID, senderId: SENDER_ID, senderName: SENDER_NAME, talkData: TALK_DATA });
      const res = await request(app)
        .post(`/api/talks/${talkId}/received`)
        .send({ receiverId: RESPONDER_ID, senderId: SENDER_ID, senderName: SENDER_NAME, talkData: TALK_DATA });

      expect(res.status).toBe(200);
      expect(res.body.registered).toBe(false);
      expect(res.body.rejectedBy).toContain('symmetric_rate_limit');
    });

    it('rejects when sender daily talk quota is exceeded', async () => {
      const { app, incomingTalksMap } = buildTestServer({
        talkSendDailyLimit: 1,
        talkSendWeeklyLimit: 1000,
      });

      const res1 = await request(app)
        .post(`/api/talks/${talkId}/received`)
        .send({ receiverId: RESPONDER_ID, senderId: SENDER_ID, senderName: SENDER_NAME, talkData: TALK_DATA });
      expect(res1.status).toBe(200);
      expect(res1.body.registered).toBe(true);

      const secondReceiverId = 'user_carol';
      const secondReceiverName = 'Carol';
      const res2 = await request(app)
        .post(`/api/talks/${talkId}/received`)
        .send({
          receiverId: secondReceiverId,
          senderId: SENDER_ID,
          senderName: SENDER_NAME,
          receiverName: secondReceiverName,
          talkData: TALK_DATA,
        });
      expect(res2.status).toBe(200);
      expect(res2.body.registered).toBe(false);
      expect(res2.body.filteredOut).toBe(true);
      expect(res2.body.rejectedBy).toContain('daily_talk_send_rate_limit');
      expect(res2.body.rejectedBy).not.toContain('daily_talk_receive_rate_limit');
      expect(incomingTalksMap.get(secondReceiverId)).toBeUndefined();
    });

    it('rejects when receiver daily talk quota is exceeded', async () => {
      const { app, incomingTalksMap } = buildTestServer({
        talkSendDailyLimit: 1,
        talkSendWeeklyLimit: 1000,
      });

      // Alice -> Bob: allowed (sender and receiver each hit count 1)
      const res1 = await request(app)
        .post(`/api/talks/${talkId}/received`)
        .send({ receiverId: RESPONDER_ID, senderId: SENDER_ID, senderName: SENDER_NAME, talkData: TALK_DATA });
      expect(res1.status).toBe(200);
      expect(res1.body.registered).toBe(true);

      // Carol -> Bob: receiver is now at daily cap, so edge should be rejected.
      const secondSenderId = 'user_carol';
      const res2 = await request(app)
        .post(`/api/talks/${talkId}/received`)
        .send({
          receiverId: RESPONDER_ID,
          senderId: secondSenderId,
          senderName: 'Carol',
          talkData: TALK_DATA,
        });
      expect(res2.status).toBe(200);
      expect(res2.body.registered).toBe(false);
      expect(res2.body.filteredOut).toBe(true);
      expect(res2.body.rejectedBy).toContain('daily_talk_receive_rate_limit');
      expect(res2.body.rejectedBy).not.toContain('daily_talk_send_rate_limit');

      const receiverClusters = incomingTalksMap.get(RESPONDER_ID);
      expect(receiverClusters).toBeDefined();
      const clusters = Array.from(receiverClusters!.values());
      expect(clusters).toHaveLength(1);
      const cluster = clusters[0] as any;
      expect(Object.keys(cluster.senders)).toContain(SENDER_ID);
      expect(Object.keys(cluster.senders)).not.toContain(secondSenderId);
    });

    it('resets sender daily quotas at UTC day boundary', async () => {
      jest.useFakeTimers({ advanceTimers: true });
      jest.setSystemTime(new Date('2026-05-07T12:00:00.000Z'));
      try {
        const { app, incomingTalksMap } = buildTestServer({
          talkSendDailyLimit: 1,
          talkSendWeeklyLimit: 1000,
        });

        const res1 = await request(app)
          .post(`/api/talks/${talkId}/received`)
          .send({ receiverId: RESPONDER_ID, senderId: SENDER_ID, senderName: SENDER_NAME, talkData: TALK_DATA });
        expect(res1.status).toBe(200);
        expect(res1.body.registered).toBe(true);

        const secondReceiverId = 'user_carol';
        const res2 = await request(app)
          .post(`/api/talks/${talkId}/received`)
          .send({
            receiverId: secondReceiverId,
            senderId: SENDER_ID,
            senderName: SENDER_NAME,
            receiverName: 'Carol',
            talkData: TALK_DATA,
          });
        expect(res2.status).toBe(200);
        expect(res2.body.registered).toBe(false);
        expect(res2.body.rejectedBy).toContain('daily_talk_send_rate_limit');
        expect(incomingTalksMap.get(secondReceiverId)).toBeUndefined();

        // Next day (UTC)
        jest.setSystemTime(new Date('2026-05-08T12:00:00.000Z'));
        const res3 = await request(app)
          .post(`/api/talks/${talkId}/received`)
          .send({
            receiverId: secondReceiverId,
            senderId: SENDER_ID,
            senderName: SENDER_NAME,
            receiverName: 'Carol',
            talkData: TALK_DATA,
          });
        expect(res3.status).toBe(200);
        expect(res3.body.registered).toBe(true);
        expect(incomingTalksMap.get(secondReceiverId)).toBeDefined();
      } finally {
        jest.useRealTimers();
      }
    });

    it('enforces weekly talk quota (and resets next week)', async () => {
      jest.useFakeTimers({ advanceTimers: true });
      jest.setSystemTime(new Date('2026-05-07T12:00:00.000Z')); // Thu; week starts Mon
      try {
        const { app, incomingTalksMap } = buildTestServer({
          talkSendDailyLimit: 1000,
          talkSendWeeklyLimit: 1,
        });

        const res1 = await request(app)
          .post(`/api/talks/${talkId}/received`)
          .send({ receiverId: RESPONDER_ID, senderId: SENDER_ID, senderName: SENDER_NAME, talkData: TALK_DATA });
        expect(res1.status).toBe(200);
        expect(res1.body.registered).toBe(true);

        const secondReceiverId = 'user_carol';
        const res2 = await request(app)
          .post(`/api/talks/${talkId}/received`)
          .send({
            receiverId: secondReceiverId,
            senderId: SENDER_ID,
            senderName: SENDER_NAME,
            receiverName: 'Carol',
            talkData: TALK_DATA,
          });
        expect(res2.status).toBe(200);
        expect(res2.body.registered).toBe(false);
        expect(res2.body.rejectedBy).toContain('weekly_talk_send_rate_limit');
        expect(incomingTalksMap.get(secondReceiverId)).toBeUndefined();

        // Next week Monday (UTC)
        jest.setSystemTime(new Date('2026-05-11T12:00:00.000Z'));
        const res3 = await request(app)
          .post(`/api/talks/${talkId}/received`)
          .send({
            receiverId: secondReceiverId,
            senderId: SENDER_ID,
            senderName: SENDER_NAME,
            receiverName: 'Carol',
            talkData: TALK_DATA,
          });
        expect(res3.status).toBe(200);
        expect(res3.body.registered).toBe(true);
        expect(incomingTalksMap.get(secondReceiverId)).toBeDefined();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('GET /api/users/:id/incoming-talks — inbox', () => {
    it('returns empty array when user has no incoming talks', async () => {
      const { app } = buildTestServer();
      const res = await request(app).get(`/api/users/${RESPONDER_ID}/incoming-talks`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns registered talk after /received call', async () => {
      const { app } = buildTestServer();
      await request(app)
        .post(`/api/talks/${talkId}/received`)
        .send({ receiverId: RESPONDER_ID, senderId: SENDER_ID, senderName: SENDER_NAME, talkData: TALK_DATA });

      const res = await request(app).get(`/api/users/${RESPONDER_ID}/incoming-talks`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].title).toBe(TALK_DATA.title);
      expect(res.body[0].senders[SENDER_ID]).toBeDefined();
      expect(res.body[0].isAnswered).toBe(false);
    });

    it('merges multiple senders of the same talk into one cluster', async () => {
      const { app } = buildTestServer();
      await request(app)
        .post(`/api/talks/${talkId}/received`)
        .send({ receiverId: RESPONDER_ID, senderId: SENDER_ID, senderName: SENDER_NAME, talkData: TALK_DATA });
      await request(app)
        .post(`/api/talks/${talkId}/received`)
        .send({ receiverId: RESPONDER_ID, senderId: 'user_carol', senderName: 'Carol', talkData: TALK_DATA });

      const res = await request(app).get(`/api/users/${RESPONDER_ID}/incoming-talks`);
      expect(res.body).toHaveLength(1);
      expect(Object.keys(res.body[0].senders)).toHaveLength(2);
    });

    it('rejects an expired talk delivered directly to a receiver', async () => {
      const { app, incomingTalksMap } = buildTestServer();
      const res = await request(app)
        .post(`/api/talks/${EXPIRED_TALK_DATA.id}/received`)
        .send({
          receiverId: RESPONDER_ID,
          senderId: SENDER_ID,
          senderName: SENDER_NAME,
          talkData: EXPIRED_TALK_DATA,
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        registered: false,
        filteredOut: true,
        rejectedBy: ['talk_expired'],
      });
      expect(incomingTalksMap.get(RESPONDER_ID)).toBeUndefined();
    });
  });

  describe('POST /api/talks/:id/register-receivers-for-broadcast', () => {
    it('registers only receivers whose server-side filters allow the talk', async () => {
      const { app, incomingTalksMap, userDeliveryContext } = buildTestServer();
      userDeliveryContext.set(RESPONDER_ID, {
        talkFilters: {
          ...getRouteTestTalkIntakeFilters(),
          allowedTalkTypes: ['tag'],
        },
        ageVerified: false,
      });
      userDeliveryContext.set('user_carol', {
        talkFilters: getRouteTestTalkIntakeFilters(),
        ageVerified: false,
      });

      const res = await request(app)
        .post(`/api/talks/${talkId}/register-receivers-for-broadcast`)
        .send({
          senderId: SENDER_ID,
          senderName: SENDER_NAME,
          receiverIds: [RESPONDER_ID, 'user_carol'],
          talkData: TALK_DATA,
        });

      expect(res.status).toBe(200);
      expect(res.body.registered).toBe(1);
      expect(res.body.filteredOut).toBe(1);
      expect(incomingTalksMap.get(RESPONDER_ID)).toBeUndefined();
      expect(incomingTalksMap.get('user_carol')?.size).toBe(1);
    });

    it('skips blocked peers during broadcast registration', async () => {
      const { app, incomingTalksMap, blockedByUser } = buildTestServer();
      blockedByUser.set('user_carol', new Set([SENDER_ID]));

      const res = await request(app)
        .post(`/api/talks/${talkId}/register-receivers-for-broadcast`)
        .send({
          senderId: SENDER_ID,
          senderName: SENDER_NAME,
          receiverIds: [RESPONDER_ID, 'user_carol'],
          talkData: TALK_DATA,
        });

      expect(res.status).toBe(200);
      expect(res.body.registered).toBe(1);
      expect(res.body.filteredOut).toBe(1);
      expect(incomingTalksMap.get(RESPONDER_ID)?.size).toBe(1);
      expect(incomingTalksMap.get('user_carol')).toBeUndefined();
    });

    it('skips expired talks during broadcast registration', async () => {
      const { app, incomingTalksMap } = buildTestServer();
      const res = await request(app)
        .post(`/api/talks/${EXPIRED_TALK_DATA.id}/register-receivers-for-broadcast`)
        .send({
          senderId: SENDER_ID,
          senderName: SENDER_NAME,
          receiverIds: [RESPONDER_ID],
          talkData: EXPIRED_TALK_DATA,
        });

      expect(res.status).toBe(200);
      expect(res.body.registered).toBe(0);
      expect(res.body.filteredOut).toBe(1);
      expect(incomingTalksMap.get(RESPONDER_ID)).toBeUndefined();
    });

    it('skips receivers without overlapping interests when broadcastTargetTags is set', async () => {
      const { app, incomingTalksMap, userDeliveryContext } = buildTestServer();
      userDeliveryContext.set(RESPONDER_ID, {
        talkFilters: getRouteTestTalkIntakeFilters(),
        ageVerified: false,
        interestTokens: ['tennis'],
      });
      userDeliveryContext.set('user_carol', {
        talkFilters: getRouteTestTalkIntakeFilters(),
        ageVerified: false,
        interestTokens: ['cooking'],
      });

      const res = await request(app)
        .post(`/api/talks/${talkId}/register-receivers-for-broadcast`)
        .send({
          senderId: SENDER_ID,
          senderName: SENDER_NAME,
          receiverIds: [RESPONDER_ID, 'user_carol'],
          talkData: TALK_DATA,
          broadcastTargetTags: ['Tennis'],
        });

      expect(res.status).toBe(200);
      expect(res.body.registered).toBe(1);
      expect(res.body.filteredOut).toBe(1);
      expect(incomingTalksMap.get(RESPONDER_ID)?.size).toBe(1);
      expect(incomingTalksMap.get('user_carol')).toBeUndefined();
    });

    it('registers all receivers when broadcastTargetTags set but receivers have no profile interests', async () => {
      const { app, incomingTalksMap } = buildTestServer();

      const res = await request(app)
        .post(`/api/talks/${talkId}/register-receivers-for-broadcast`)
        .send({
          senderId: SENDER_ID,
          senderName: SENDER_NAME,
          receiverIds: [RESPONDER_ID, 'user_carol'],
          talkData: TALK_DATA,
          broadcastTargetTags: ['anything'],
        });

      expect(res.status).toBe(200);
      expect(res.body.registered).toBe(2);
      expect(res.body.filteredOut).toBe(0);
      expect(incomingTalksMap.get(RESPONDER_ID)?.size).toBe(1);
      expect(incomingTalksMap.get('user_carol')?.size).toBe(1);
    });

    it('registers an adult talk only for age-verified receivers and skips unverified ones', async () => {
      const { app, incomingTalksMap, userDeliveryContext } = buildTestServer();
      const adultReceiverId = 'user_jerry';
      const defaultReceiverId = 'user_bob';
      userDeliveryContext.set(adultReceiverId, {
        talkFilters: getRouteTestTalkIntakeFilters(),
        ageVerified: true,
      });
      userDeliveryContext.set(defaultReceiverId, {
        talkFilters: getRouteTestTalkIntakeFilters(),
        ageVerified: false,
      });

      const res = await request(app)
        .post(`/api/talks/${ADULT_TALK_DATA.id}/register-receivers-for-broadcast`)
        .send({
          senderId: SENDER_ID,
          senderName: SENDER_NAME,
          receiverIds: [adultReceiverId, defaultReceiverId],
          talkData: ADULT_TALK_DATA,
        });

      expect(res.status).toBe(200);
      expect(res.body.registered).toBe(1);
      expect(res.body.filteredOut).toBe(1);
      expect(incomingTalksMap.get(adultReceiverId)?.size).toBe(1);
      expect(incomingTalksMap.get(defaultReceiverId)).toBeUndefined();
    });

    it('caps broadcast registration by sender bulk capacity', async () => {
      const { app, incomingTalksMap, senderBulkCapacity } = buildTestServer();
      senderBulkCapacity.set(SENDER_ID, 1);

      const res = await request(app)
        .post(`/api/talks/${talkId}/register-receivers-for-broadcast`)
        .send({
          senderId: SENDER_ID,
          senderName: SENDER_NAME,
          receiverIds: [RESPONDER_ID, 'user_carol'],
          talkData: TALK_DATA,
        });

      expect(res.status).toBe(200);
      expect(res.body.registered).toBe(1);
      expect(res.body.senderCapacity).toBe(1);
      expect(res.body.capacityDropped).toBe(1);
      expect(res.body.filteredOut).toBe(1);
      expect(incomingTalksMap.get(RESPONDER_ID)?.size).toBe(1);
      expect(incomingTalksMap.get('user_carol')).toBeUndefined();
    });

    it('returns symmetricRateLimited when sender is still in cooldown after a prior bulk', async () => {
      const { app, incomingTalksMap } = buildTestServer({ symmetricCooldownMs: 3_600_000 });
      await request(app)
        .post(`/api/talks/${talkId}/register-receivers-for-broadcast`)
        .send({
          senderId: SENDER_ID,
          senderName: SENDER_NAME,
          receiverIds: [RESPONDER_ID],
          talkData: TALK_DATA,
        });
      const res = await request(app)
        .post(`/api/talks/${talkId}/register-receivers-for-broadcast`)
        .send({
          senderId: SENDER_ID,
          senderName: SENDER_NAME,
          receiverIds: ['user_carol'],
          talkData: TALK_DATA,
        });

      expect(res.status).toBe(200);
      expect(res.body.registered).toBe(0);
      expect(res.body.symmetricRateLimited).toBe(true);
      expect(incomingTalksMap.get('user_carol')).toBeUndefined();
    });

    it('drops all receivers when sender bulk capacity is zero', async () => {
      const { app, incomingTalksMap, senderBulkCapacity } = buildTestServer();
      senderBulkCapacity.set(SENDER_ID, 0);

      const res = await request(app)
        .post(`/api/talks/${talkId}/register-receivers-for-broadcast`)
        .send({
          senderId: SENDER_ID,
          senderName: SENDER_NAME,
          receiverIds: [RESPONDER_ID, 'user_carol'],
          talkData: TALK_DATA,
        });

      expect(res.status).toBe(200);
      expect(res.body.registered).toBe(0);
      expect(res.body.senderCapacity).toBe(0);
      expect(res.body.capacityDropped).toBe(2);
      expect(res.body.filteredOut).toBe(2);
      expect(incomingTalksMap.get(RESPONDER_ID)).toBeUndefined();
      expect(incomingTalksMap.get('user_carol')).toBeUndefined();
    });

    it('records broadcast tag picks on register-receivers and exposes GET /api/stats/broadcast-tags', async () => {
      const { app } = buildTestServer();
      const stats0 = await request(app).get('/api/stats/broadcast-tags');
      expect(stats0.status).toBe(200);
      expect(stats0.body.tags).toEqual([]);

      const res = await request(app)
        .post(`/api/talks/${talkId}/register-receivers-for-broadcast`)
        .send({
          senderId: SENDER_ID,
          senderName: SENDER_NAME,
          receiverIds: [RESPONDER_ID],
          talkData: TALK_DATA,
          broadcastTargetTags: ['Coffee', 'coffee', ' Tennis '],
        });
      expect(res.status).toBe(200);

      const stats = await request(app).get('/api/stats/broadcast-tags');
      expect(stats.status).toBe(200);
      const byId = Object.fromEntries(
        (stats.body.tags as Array<{ id: string; count: number }>).map((x) => [x.id, x.count]),
      );
      expect(byId.coffee).toBe(1);
      expect(byId.tennis).toBe(1);
    });

    it('exposes GET /api/stats/broadcast-tags/trends with UTC day buckets', async () => {
      jest.useFakeTimers({ advanceTimers: true });
      jest.setSystemTime(new Date('2026-05-07T12:00:00.000Z'));
      try {
        const { app } = buildTestServer();
        await request(app)
          .post(`/api/talks/${talkId}/register-receivers-for-broadcast`)
          .send({
            senderId: SENDER_ID,
            senderName: SENDER_NAME,
            receiverIds: [RESPONDER_ID],
            talkData: TALK_DATA,
            broadcastTargetTags: ['Coffee'],
          });
        const tr = await request(app).get('/api/stats/broadcast-tags/trends?days=3');
        expect(tr.status).toBe(200);
        expect(tr.body.days).toContain('2026-05-07');
        const coffee = (tr.body.tags as Array<{ id: string; total: number; byDay: number[] }>).find(
          (t) => t.id === 'coffee',
        );
        expect(coffee?.total).toBe(1);
        expect(coffee?.byDay?.some((n: number) => n >= 1)).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });

    it('does not bump popularity when broadcastTargetTags omitted', async () => {
      const { app } = buildTestServer();
      await request(app)
        .post(`/api/talks/${talkId}/register-receivers-for-broadcast`)
        .send({
          senderId: SENDER_ID,
          senderName: SENDER_NAME,
          receiverIds: [RESPONDER_ID],
          talkData: TALK_DATA,
        });
      const stats = await request(app).get('/api/stats/broadcast-tags');
      expect(stats.body.tags).toEqual([]);
    });

    it('skips receivers outside broadcastMaxDistanceMiles from sender pivot', async () => {
      const { app, incomingTalksMap, userDeliveryContext } = buildTestServer();
      userDeliveryContext.set(SENDER_ID, {
        talkFilters: getRouteTestTalkIntakeFilters(),
        ageVerified: false,
        location: {
          latitude: 37.7749,
          longitude: -122.4194,
          accuracy: 10,
          timestamp: new Date(),
        },
      });
      userDeliveryContext.set(RESPONDER_ID, {
        talkFilters: getRouteTestTalkIntakeFilters(),
        ageVerified: false,
        location: {
          latitude: 40.7128,
          longitude: -74.006,
          accuracy: 10,
          timestamp: new Date(),
        },
      });

      const resFar = await request(app)
        .post(`/api/talks/${talkId}/register-receivers-for-broadcast`)
        .send({
          senderId: SENDER_ID,
          senderName: SENDER_NAME,
          receiverIds: [RESPONDER_ID],
          talkData: TALK_DATA,
          broadcastMaxDistanceMiles: 500,
        });
      expect(resFar.status).toBe(200);
      expect(resFar.body.registered).toBe(0);
      expect(resFar.body.filteredOut).toBe(1);
      expect(incomingTalksMap.get(RESPONDER_ID)).toBeUndefined();

      const resOk = await request(app)
        .post(`/api/talks/${talkId}/register-receivers-for-broadcast`)
        .send({
          senderId: SENDER_ID,
          senderName: SENDER_NAME,
          receiverIds: [RESPONDER_ID],
          talkData: TALK_DATA,
        });
      expect(resOk.status).toBe(200);
      expect(resOk.body.registered).toBe(1);
      expect(incomingTalksMap.get(RESPONDER_ID)?.size).toBe(1);
    });
  });

  describe('POST /api/talks/broadcast-receiver-preview', () => {
    it('returns eligible preview counts with broadcastMaxDistanceMiles', async () => {
      const { app, userDeliveryContext } = buildTestServer();
      userDeliveryContext.set(SENDER_ID, {
        talkFilters: getRouteTestTalkIntakeFilters(),
        ageVerified: false,
        location: {
          latitude: 37.7749,
          longitude: -122.4194,
          accuracy: 10,
          timestamp: new Date(),
        },
      });
      userDeliveryContext.set(RESPONDER_ID, {
        talkFilters: { ...getRouteTestTalkIntakeFilters(), maxDistanceMiles: 10_000 },
        ageVerified: false,
        location: {
          latitude: 40.7128,
          longitude: -74.006,
          accuracy: 10,
          timestamp: new Date(),
        },
      });

      const far = await request(app)
        .post('/api/talks/broadcast-receiver-preview')
        .send({
          senderId: SENDER_ID,
          receiverIds: [RESPONDER_ID],
          talkData: TALK_DATA,
          broadcastMaxDistanceMiles: 500,
        });
      expect(far.status).toBe(200);
      expect(far.body.totalCandidates).toBe(1);
      expect(far.body.eligibleReceivers).toBe(0);
      expect(far.body.rejectedByCounts).toEqual({ broadcast_max_distance: 1 });
      expect(far.body.rejectedReceivers).toEqual([
        { receiverId: RESPONDER_ID, rejectedBy: ['broadcast_max_distance'] },
      ]);

      const unfilt = await request(app)
        .post('/api/talks/broadcast-receiver-preview')
        .send({
          senderId: SENDER_ID,
          receiverIds: [RESPONDER_ID],
          talkData: TALK_DATA,
        });
      expect(unfilt.status).toBe(200);
      expect(unfilt.body.eligibleReceivers).toBe(1);
      expect(unfilt.body.eligibleReceiverIds).toEqual([RESPONDER_ID]);
      expect(unfilt.body.rejectedByCounts).toEqual({});
    });

    it('reports language, age, and block exclusion reasons before a broadcast sends', async () => {
      const { app, userDeliveryContext, blockedByUser } = buildTestServer();
      userDeliveryContext.set(RESPONDER_ID, {
        talkFilters: { ...getRouteTestTalkIntakeFilters(), allowedLanguages: ['zh'] },
        ageVerified: false,
      });
      userDeliveryContext.set('user_carol', {
        talkFilters: getRouteTestTalkIntakeFilters(),
        ageVerified: false,
      });
      userDeliveryContext.set('user_dave', {
        talkFilters: getRouteTestTalkIntakeFilters(),
        ageVerified: true,
      });
      blockedByUser.set('user_dave', new Set([SENDER_ID]));

      const preview = await request(app)
        .post('/api/talks/broadcast-receiver-preview')
        .send({
          senderId: SENDER_ID,
          receiverIds: [RESPONDER_ID, 'user_carol', 'user_dave'],
          talkData: ADULT_TALK_DATA,
        });

      expect(preview.status).toBe(200);
      expect(preview.body.eligibleReceivers).toBe(0);
      expect(preview.body.rejectedByCounts).toMatchObject({
        intake_language: 1,
        age_gate: 2,
        blocked_user: 1,
      });
      expect(preview.body.rejectedReceivers).toEqual(expect.arrayContaining([
        expect.objectContaining({ receiverId: RESPONDER_ID, rejectedBy: expect.arrayContaining(['intake_language']) }),
        expect.objectContaining({ receiverId: 'user_carol', rejectedBy: expect.arrayContaining(['age_gate']) }),
        expect.objectContaining({ receiverId: 'user_dave', rejectedBy: expect.arrayContaining(['blocked_user']) }),
      ]));
    });

    it('reports expired talks as ineligible in broadcast audience preview', async () => {
      const { app } = buildTestServer();
      const preview = await request(app)
        .post('/api/talks/broadcast-receiver-preview')
        .send({
          senderId: SENDER_ID,
          receiverIds: [RESPONDER_ID],
          talkData: EXPIRED_TALK_DATA,
        });

      expect(preview.status).toBe(200);
      expect(preview.body.eligibleReceivers).toBe(0);
      expect(preview.body.rejectedByCounts).toEqual({ talk_expired: 1 });
      expect(preview.body.rejectedReceivers).toEqual([
        { receiverId: RESPONDER_ID, rejectedBy: ['talk_expired'] },
      ]);
    });
  });

  describe('POST /api/talks/:id/response — answer submission', () => {
    it('returns isMatch: true and a conversationId for a matching answer', async () => {
      const { app } = buildTestServer();
      await request(app)
        .post(`/api/talks/${talkId}/received`)
        .send({ receiverId: RESPONDER_ID, senderId: SENDER_ID, senderName: SENDER_NAME, talkData: TALK_DATA });

      const res = await request(app)
        .post(`/api/talks/${talkId}/response`)
        .send({ responderId: RESPONDER_ID, responderName: RESPONDER_NAME, answers: MATCHING_ANSWERS, talkData: TALK_DATA });

      expect(res.status).toBe(200);
      expect(res.body.isMatch).toBe(true);
      expect(typeof res.body.conversationId).toBe('string');
      expect(res.body.conversationId).toMatch(/^conv_/);
      expect(res.body.matches).toHaveLength(1);
      expect(res.body.matches[0].senderId).toBe(SENDER_ID);
    });

    it('returns isMatch: false for a non-matching answer', async () => {
      const { app } = buildTestServer();
      await request(app)
        .post(`/api/talks/${talkId}/received`)
        .send({ receiverId: RESPONDER_ID, senderId: SENDER_ID, senderName: SENDER_NAME, talkData: TALK_DATA });

      const res = await request(app)
        .post(`/api/talks/${talkId}/response`)
        .send({ responderId: RESPONDER_ID, responderName: RESPONDER_NAME, answers: NON_MATCHING_ANSWERS, talkData: TALK_DATA });

      expect(res.status).toBe(200);
      expect(res.body.isMatch).toBe(false);
      expect(res.body.conversationId).toBeNull();
    });

    it('returns 400 when responderId or answers is missing', async () => {
      const { app } = buildTestServer();
      const res = await request(app)
        .post(`/api/talks/${talkId}/response`)
        .send({ answers: MATCHING_ANSWERS, talkData: TALK_DATA });
      expect(res.status).toBe(400);
    });

    it('returns 404 when talk data cannot be resolved', async () => {
      const { app } = buildTestServer();
      const res = await request(app)
        .post(`/api/talks/unknown_talk/response`)
        .send({ responderId: RESPONDER_ID, answers: MATCHING_ANSWERS });
      expect(res.status).toBe(404);
    });

    it('includes all registered senders when multiple senders exist (in-memory map fix)', async () => {
      const { app } = buildTestServer();
      // Register two different senders of the same talk
      await request(app)
        .post(`/api/talks/${talkId}/received`)
        .send({ receiverId: RESPONDER_ID, senderId: SENDER_ID, senderName: SENDER_NAME, talkData: TALK_DATA });
      await request(app)
        .post(`/api/talks/${talkId}/received`)
        .send({ receiverId: RESPONDER_ID, senderId: 'user_carol', senderName: 'Carol', talkData: TALK_DATA });

      const res = await request(app)
        .post(`/api/talks/${talkId}/response`)
        .send({ responderId: RESPONDER_ID, responderName: RESPONDER_NAME, answers: MATCHING_ANSWERS, talkData: TALK_DATA });

      expect(res.status).toBe(200);
      expect(res.body.isMatch).toBe(true);
      // Both senders should get a conversation
      expect(res.body.matches).toHaveLength(2);
      const senderIds = res.body.matches.map((m: any) => m.senderId);
      expect(senderIds).toContain(SENDER_ID);
      expect(senderIds).toContain('user_carol');
    });
  });

  describe('GET /api/stats/talks/:id/summary — match stats', () => {
    it('returns zero counts before any responses', async () => {
      const { app } = buildTestServer();
      const res = await request(app).get(`/api/stats/talks/${talkId}/summary`);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
      expect(res.body.matches).toBe(0);
    });

    it('increments match count after a matching response', async () => {
      const { app } = buildTestServer();
      await request(app)
        .post(`/api/talks/${talkId}/received`)
        .send({ receiverId: RESPONDER_ID, senderId: SENDER_ID, senderName: SENDER_NAME, talkData: TALK_DATA });
      await request(app)
        .post(`/api/talks/${talkId}/response`)
        .send({ responderId: RESPONDER_ID, responderName: RESPONDER_NAME, answers: MATCHING_ANSWERS, talkData: TALK_DATA });

      const res = await request(app).get(`/api/stats/talks/${talkId}/summary`);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.matches).toBe(1);
      expect(res.body.ignores).toBe(0);
    });

    it('increments ignore count after a non-matching response', async () => {
      const { app } = buildTestServer();
      await request(app)
        .post(`/api/talks/${talkId}/received`)
        .send({ receiverId: RESPONDER_ID, senderId: SENDER_ID, senderName: SENDER_NAME, talkData: TALK_DATA });
      await request(app)
        .post(`/api/talks/${talkId}/response`)
        .send({ responderId: RESPONDER_ID, responderName: RESPONDER_NAME, answers: NON_MATCHING_ANSWERS, talkData: TALK_DATA });

      const res = await request(app).get(`/api/stats/talks/${talkId}/summary`);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.matches).toBe(0);
      expect(res.body.ignores).toBe(1);
    });

    it('buckets by-day stats on UTC calendar boundaries', async () => {
      const { app, talkResponsesMap } = buildTestServer();
      talkResponsesMap.set(talkId, [
        {
          responseId: 'r_before_midnight',
          talkId,
          talkType: 'flow',
          responderId: 'u1',
          region: 'test-region',
          answers: MATCHING_ANSWERS,
          createdAt: Date.parse('2026-05-11T23:59:59.000Z'),
          outcome: 'match',
        },
        {
          responseId: 'r_after_midnight',
          talkId,
          talkType: 'flow',
          responderId: 'u2',
          region: 'test-region',
          answers: MATCHING_ANSWERS,
          createdAt: Date.parse('2026-05-12T00:00:00.000Z'),
          outcome: 'match',
        },
      ]);

      const res = await request(app).get(`/api/stats/talks/${talkId}/by-day?bucket=day`);

      expect(res.status).toBe(200);
      expect(res.body.series).toEqual([
        { bucket: '2026-05-11', count: 1 },
        { bucket: '2026-05-12', count: 1 },
      ]);
    });

    it('exposes expanded statistics dashboard, time-series, cross-question, chatroom, and peer endpoints', async () => {
      const { app, talkResponsesMap } = buildTestServer();
      talkResponsesMap.set(talkId, [
        {
          responseId: 'r1',
          talkId,
          talkType: 'survey',
          responderId: 'user_bob',
          region: 'region_west',
          chatroomId: 'room_west',
          answers: [
            { questionId: 'q1', answerId: 'a_blue', answerText: 'Blue' },
            { questionId: 'q2', answerId: 'a_tennis', answerText: 'Tennis' },
          ],
          createdAt: Date.parse('2026-05-11T12:00:00.000Z'),
          outcome: 'match',
        },
        {
          responseId: 'r2',
          talkId,
          talkType: 'survey',
          responderId: 'user_carla',
          region: 'region_west',
          chatroomId: 'room_west',
          answers: [
            { questionId: 'q1', answerId: 'a_blue', answerText: 'Blue' },
            { questionId: 'q2', answerId: 'a_soccer', answerText: 'Soccer' },
          ],
          createdAt: Date.parse('2026-05-12T12:00:00.000Z'),
          outcome: 'ignore',
        },
        {
          responseId: 'r3',
          talkId,
          talkType: 'survey',
          responderId: 'user_dana',
          region: 'region_east',
          chatroomId: 'room_east',
          isTraveller: true,
          answers: [
            { questionId: 'q1', answerId: 'a_green', answerText: 'Green' },
            { questionId: 'q2', answerId: 'a_tennis', answerText: 'Tennis' },
          ],
          createdAt: Date.parse('2026-05-19T12:00:00.000Z'),
          outcome: 'match',
        },
      ]);

      const dashboard = await request(app).get('/api/stats/dashboard?viewerId=user_alice');
      expect(dashboard.status).toBe(200);
      expect(dashboard.body.totals).toMatchObject({ talks: 1, responses: 3, matches: 2, ignores: 1 });
      expect(dashboard.body.privacy).toMatchObject({ minCohortSize: 3, preciseLocationExposed: false });
      expect(dashboard.body.sourceOfTruth.responseEvents).toBe('append-only-gun-mirrored');

      const timeSeries = await request(app).get(`/api/stats/talks/${talkId}/time-series`);
      expect(timeSeries.status).toBe(200);
      expect(timeSeries.body.day.series).toHaveLength(3);
      expect(timeSeries.body.month.series).toEqual([{ bucket: '2026-05', count: 3 }]);

      const cross = await request(app).get(
        `/api/stats/talks/${talkId}/cross-question?questionA=q1&questionB=q2`,
      );
      expect(cross.status).toBe(200);
      expect(cross.body.totalPairs).toBe(3);
      expect(cross.body.cells).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ answerAId: 'a_blue', answerBId: 'a_tennis', count: 1, masked: true }),
        ]),
      );

      const chatrooms = await request(app).get('/api/stats/chatrooms');
      expect(chatrooms.status).toBe(200);
      expect(chatrooms.body.regions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ region: 'room_west', count: 2, matchRate: 50, masked: true }),
          expect.objectContaining({ region: 'room_east', travellerCount: 1, matchRate: 100, masked: true }),
        ]),
      );

      const peers = await request(app).get('/api/stats/peers?viewerId=user_alice');
      expect(peers.status).toBe(200);
      expect(peers.body.peers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ peerId: 'user_bob', responses: 1, matches: 1, matchRate: 100 }),
          expect.objectContaining({ peerId: 'user_carla', ignores: 1 }),
        ]),
      );
    });
  });
});
