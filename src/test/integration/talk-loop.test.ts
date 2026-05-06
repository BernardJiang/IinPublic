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
import { checkIfMatch } from '../../shared/talk-engine';
import { buildTalkIdentityKey } from '../../shared/talk-content-id';
import { TALK_CONTENT_HASH_ID } from '../../shared/incoming-talk-ids';
import { getDefaultTalkIntakeFilters } from '../../shared/talk-intake-filters';
import { bucketKey, type TalkResponse, type TalkType } from '../../shared/talk-stats';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SENDER_ID = 'user_alice';
const SENDER_NAME = 'Alice';
const RESPONDER_ID = 'user_bob';
const RESPONDER_NAME = 'Bob';

const TALK_DATA = {
  id: 'talk_abc123',
  title: 'Favourite colour?',
  authorId: SENDER_ID,
  type: 'flow' as TalkType,
  isAdult: false,
  language: 'en',
  tags: [],
  questions: [
    {
      id: 'q1',
      text: 'Favourite colour?',
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

const MATCHING_ANSWERS = [{ questionId: 'q1', answerId: 'a_blue', answerText: 'Blue' }];
const NON_MATCHING_ANSWERS = [{ questionId: 'q1', answerId: 'a_red', answerText: 'Red' }];

// ---------------------------------------------------------------------------
// Test server factory
// ---------------------------------------------------------------------------

function buildTestServer() {
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
  }>();
  const blockedByUser = new Map<string, Set<string>>();

  // Stub GunService — null reads, no-op writes.
  const gunService = {
    getPath: jest.fn().mockResolvedValue(null),
    putPath: jest.fn().mockResolvedValue(undefined),
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
    return (
      userDeliveryContext.get(userId) || {
        talkFilters: getDefaultTalkIntakeFilters(['en']),
        ageVerified: false,
      }
    );
  }

  async function getBlockStatus(viewerId: string, targetId: string) {
    const blocked = blockedByUser.get(viewerId)?.has(targetId) ?? false;
    const blockedBy = blockedByUser.get(targetId)?.has(viewerId) ?? false;
    return { blocked, blockedBy, eitherBlocked: blocked || blockedBy };
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
    recordTalkStatsResponse,
  });

  registerStatsRoutes(app, {
    talkService: null as any, // not exercised in these tests
    getUserRegion,
    recordTalkStatsResponse,
    getTalkResponses,
  });

  return { app, incomingTalksMap, talkResponsesMap, userDeliveryContext, blockedByUser };
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
          ...getDefaultTalkIntakeFilters(['en']),
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
  });

  describe('POST /api/talks/:id/register-receivers-for-broadcast', () => {
    it('registers only receivers whose server-side filters allow the talk', async () => {
      const { app, incomingTalksMap, userDeliveryContext } = buildTestServer();
      userDeliveryContext.set(RESPONDER_ID, {
        talkFilters: {
          ...getDefaultTalkIntakeFilters(['en']),
          allowedTalkTypes: ['tag'],
        },
        ageVerified: false,
      });
      userDeliveryContext.set('user_carol', {
        talkFilters: getDefaultTalkIntakeFilters(['en']),
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

    it('registers an adult talk only for age-verified receivers and skips unverified ones', async () => {
      const { app, incomingTalksMap, userDeliveryContext } = buildTestServer();
      const adultReceiverId = 'user_jerry';
      const defaultReceiverId = 'user_bob';
      userDeliveryContext.set(adultReceiverId, {
        talkFilters: getDefaultTalkIntakeFilters(['en']),
        ageVerified: true,
      });
      userDeliveryContext.set(defaultReceiverId, {
        talkFilters: getDefaultTalkIntakeFilters(['en']),
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
  });
});
