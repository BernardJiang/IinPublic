/**
 * Integration tests for peer relationship and talk-history routes.
 *
 * Uses a real Express app with real peer-route logic and in-memory state.
 */
import express from 'express';
import request from 'supertest';
import { registerPeerRoutes } from '../../server/routes/peer-routes';
import type { TalkResponse, TalkType } from '../../shared/talk-stats';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ALICE = 'user_alice';
const BOB = 'user_bob';
const CAROL = 'user_carol';

const FLOW_TALK_ID = 'qa_flowTalk01';
const TAG_TALK_ID = 'qa_tagTalk002';

function buildTestServer() {
  const app = express();
  app.use(express.json());

  const incomingTalksMap: Map<string, Map<string, any>> = new Map();
  const talkResponsesMap: Map<string, TalkResponse[]> = new Map();
  const stageNames = new Map<string, string>([
    [ALICE, 'Alice'],
    [BOB, 'Bob'],
    [CAROL, 'Carol'],
  ]);
  const blockedByUser = new Map<string, Set<string>>();

  registerPeerRoutes(app, {
    incomingTalksMap,
    talkResponsesMap,
    getUserStageName: async (userId: string, fallbackName?: string) =>
      stageNames.get(userId) || fallbackName || 'Unknown',
    getBlockStatus: async (viewerId: string, targetId: string) => {
      const blocked = blockedByUser.get(viewerId)?.has(targetId) ?? false;
      const blockedBy = blockedByUser.get(targetId)?.has(viewerId) ?? false;
      return { blocked, blockedBy, eitherBlocked: blocked || blockedBy };
    },
  });

  return { app, incomingTalksMap, talkResponsesMap, blockedByUser };
}

function addIncoming(
  map: Map<string, Map<string, any>>,
  receiverId: string,
  identityKey: string,
  senderId: string,
  talkId: string,
  type = 'flow',
  language = 'en',
) {
  if (!map.has(receiverId)) map.set(receiverId, new Map());
  const existing = map.get(receiverId)!.get(identityKey) ?? {
    identityKey,
    title: 'Test Talk',
    type,
    language,
    senders: {},
    talkIds: {},
    latestTalkId: talkId,
    updatedAt: new Date().toISOString(),
  };
  existing.senders[senderId] = { senderId, senderName: 'Someone', lastTalkId: talkId };
  existing.talkIds[talkId] = new Date().toISOString();
  existing.latestTalkId = talkId;
  existing.language = language;
  map.get(receiverId)!.set(identityKey, existing);
}

function addResponse(
  map: Map<string, TalkResponse[]>,
  talkId: string,
  responderId: string,
  outcome: 'match' | 'ignore' | 'other',
  talkType: TalkType = 'flow',
  answerMode: 'manual' | 'auto' = 'manual',
) {
  const list = map.get(talkId) ?? [];
  list.push({
    responseId: `resp_${Math.random().toString(36).slice(2)}`,
    talkId,
    talkType,
    responderId,
    region: 'us-east',
    answers: [],
    createdAt: Date.now(),
    outcome,
    answerMode,
  });
  map.set(talkId, list);
}

// ---------------------------------------------------------------------------
// Tests: relationship endpoint
// ---------------------------------------------------------------------------

describe('GET /api/users/:userId/peers/:peerId/relationship', () => {
  it('returns zeros for two strangers', async () => {
    const { app } = buildTestServer();
    const res = await request(app).get(`/api/users/${ALICE}/peers/${BOB}/relationship`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      sent: { talks: 0, matches: 0 },
      received: { talks: 0, matches: 0 },
      mutualMatchedTalks: 0,
      mutualTagCount: 0,
    });
  });

  it('counts talks Alice sent to Bob', async () => {
    const { app, incomingTalksMap } = buildTestServer();
    // Alice sent a talk to Bob → appears in Bob's incoming with Alice as sender
    addIncoming(incomingTalksMap, BOB, 'ik_talk1', ALICE, FLOW_TALK_ID);

    const res = await request(app).get(`/api/users/${ALICE}/peers/${BOB}/relationship`);
    expect(res.status).toBe(200);
    expect(res.body.sent.talks).toBe(1);
    expect(res.body.received.talks).toBe(0);
  });

  it('counts talks Bob sent to Alice', async () => {
    const { app, incomingTalksMap } = buildTestServer();
    addIncoming(incomingTalksMap, ALICE, 'ik_talk2', BOB, FLOW_TALK_ID);

    const res = await request(app).get(`/api/users/${ALICE}/peers/${BOB}/relationship`);
    expect(res.body.received.talks).toBe(1);
    expect(res.body.sent.talks).toBe(0);
  });

  it('counts matches when Bob responded with match to Alice talk', async () => {
    const { app, incomingTalksMap, talkResponsesMap } = buildTestServer();
    addIncoming(incomingTalksMap, BOB, 'ik_talk1', ALICE, FLOW_TALK_ID);
    addResponse(talkResponsesMap, FLOW_TALK_ID, BOB, 'match');

    const res = await request(app).get(`/api/users/${ALICE}/peers/${BOB}/relationship`);
    expect(res.body.sent.matches).toBe(1);
  });

  it('does not count mismatches as matches', async () => {
    const { app, incomingTalksMap, talkResponsesMap } = buildTestServer();
    addIncoming(incomingTalksMap, BOB, 'ik_talk1', ALICE, FLOW_TALK_ID);
    addResponse(talkResponsesMap, FLOW_TALK_ID, BOB, 'other');

    const res = await request(app).get(`/api/users/${ALICE}/peers/${BOB}/relationship`);
    expect(res.body.sent.matches).toBe(0);
  });

  it('counts mutual matched talks', async () => {
    const { app, talkResponsesMap } = buildTestServer();
    // Both Alice and Bob matched on the same talk
    addResponse(talkResponsesMap, FLOW_TALK_ID, ALICE, 'match');
    addResponse(talkResponsesMap, FLOW_TALK_ID, BOB, 'match');

    const res = await request(app).get(`/api/users/${ALICE}/peers/${BOB}/relationship`);
    expect(res.body.mutualMatchedTalks).toBe(1);
  });

  it('mutual matched talks excludes talks where only one user matched', async () => {
    const { app, talkResponsesMap } = buildTestServer();
    addResponse(talkResponsesMap, FLOW_TALK_ID, ALICE, 'match');
    addResponse(talkResponsesMap, FLOW_TALK_ID, BOB, 'other');

    const res = await request(app).get(`/api/users/${ALICE}/peers/${BOB}/relationship`);
    expect(res.body.mutualMatchedTalks).toBe(0);
  });

  it('counts mutualTagCount for tag-type mutual matches', async () => {
    const { app, talkResponsesMap } = buildTestServer();
    addResponse(talkResponsesMap, TAG_TALK_ID, ALICE, 'match', 'tag');
    addResponse(talkResponsesMap, TAG_TALK_ID, BOB, 'match', 'tag');

    const res = await request(app).get(`/api/users/${ALICE}/peers/${BOB}/relationship`);
    expect(res.body.mutualTagCount).toBe(1);
  });

  it('does not count flow-type mutual matches as mutualTagCount', async () => {
    const { app, talkResponsesMap } = buildTestServer();
    addResponse(talkResponsesMap, FLOW_TALK_ID, ALICE, 'match', 'flow');
    addResponse(talkResponsesMap, FLOW_TALK_ID, BOB, 'match', 'flow');

    const res = await request(app).get(`/api/users/${ALICE}/peers/${BOB}/relationship`);
    expect(res.body.mutualTagCount).toBe(0);
    expect(res.body.mutualMatchedTalks).toBe(1);
  });

  it('returns 400 if userId missing', async () => {
    const { app } = buildTestServer();
    const res = await request(app).get(`/api/users//peers/${BOB}/relationship`);
    expect(res.status).toBe(404); // Express treats empty param as 404
  });

  it('Carol is irrelevant to Alice–Bob relationship', async () => {
    const { app, incomingTalksMap, talkResponsesMap } = buildTestServer();
    addIncoming(incomingTalksMap, CAROL, 'ik_carol', ALICE, FLOW_TALK_ID);
    addResponse(talkResponsesMap, FLOW_TALK_ID, CAROL, 'match');

    const res = await request(app).get(`/api/users/${ALICE}/peers/${BOB}/relationship`);
    expect(res.body.sent.talks).toBe(0);
    expect(res.body.mutualMatchedTalks).toBe(0);
  });

  it('returns 403 when the peer blocked the viewer', async () => {
    const { app, blockedByUser } = buildTestServer();
    blockedByUser.set(BOB, new Set([ALICE]));

    const res = await request(app).get(`/api/users/${ALICE}/peers/${BOB}/relationship`);
    expect(res.status).toBe(403);
    expect(res.body.blockedBy).toBe(true);
  });
});

describe('GET /api/users/:userId/replies', () => {
  it('returns one hundred distinct creator replies for ten talks sent to ten users', async () => {
    const { app, incomingTalksMap, talkResponsesMap } = buildTestServer();
    for (let userIndex = 0; userIndex < 10; userIndex++) {
      const receiverId = `receiver_${userIndex}`;
      for (let talkIndex = 0; talkIndex < 10; talkIndex++) {
        const talkId = `talk_${talkIndex}`;
        addIncoming(incomingTalksMap, receiverId, `identity_${talkIndex}`, ALICE, talkId);
        addResponse(
          talkResponsesMap,
          talkId,
          receiverId,
          userIndex + talkIndex < 10 ? 'match' : 'other',
        );
      }
    }

    const res = await request(app).get(`/api/users/${ALICE}/replies`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(100);
    expect(new Set(res.body.map((reply: { responseId: string }) => reply.responseId)).size).toBe(100);
    expect(res.body.filter((reply: { responderId: string }) => reply.responderId === 'receiver_0')).toHaveLength(10);
    expect(res.body.filter((reply: { talkId: string }) => reply.talkId === 'talk_0')).toHaveLength(10);
    expect(res.body.some((reply: { outcome: string }) => reply.outcome === 'match')).toBe(true);
    expect(res.body.some((reply: { outcome: string }) => reply.outcome === 'mismatch')).toBe(true);
  });

  it('returns language and manual/auto metadata for creator reply triage', async () => {
    const { app, incomingTalksMap, talkResponsesMap } = buildTestServer();
    addIncoming(incomingTalksMap, BOB, 'ik_zh', ALICE, FLOW_TALK_ID, 'flow', 'zh');
    addResponse(talkResponsesMap, FLOW_TALK_ID, BOB, 'match', 'flow', 'auto');

    const res = await request(app).get(`/api/users/${ALICE}/replies`);
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      language: 'zh',
      answerMode: 'auto',
      type: 'flow',
    });
  });

  it('omits replies from a responder blocked in either direction', async () => {
    const { app, incomingTalksMap, talkResponsesMap, blockedByUser } = buildTestServer();
    addIncoming(incomingTalksMap, BOB, 'ik_bob', ALICE, FLOW_TALK_ID);
    addResponse(talkResponsesMap, FLOW_TALK_ID, BOB, 'match');
    blockedByUser.set(BOB, new Set([ALICE]));

    const res = await request(app).get(`/api/users/${ALICE}/replies`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tests: talk-history endpoint
// ---------------------------------------------------------------------------

describe('GET /api/users/:userId/peers/:peerId/talk-history', () => {
  it('returns empty array for strangers', async () => {
    const { app } = buildTestServer();
    const res = await request(app).get(`/api/users/${ALICE}/peers/${BOB}/talk-history`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns sent talk with direction=sent', async () => {
    const { app, incomingTalksMap } = buildTestServer();
    addIncoming(incomingTalksMap, BOB, 'ik_talk1', ALICE, FLOW_TALK_ID);

    const res = await request(app).get(`/api/users/${ALICE}/peers/${BOB}/talk-history`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].direction).toBe('sent');
    expect(res.body[0].talkId).toBe(FLOW_TALK_ID);
  });

  it('returns received talk with direction=received', async () => {
    const { app, incomingTalksMap } = buildTestServer();
    addIncoming(incomingTalksMap, ALICE, 'ik_talk2', BOB, FLOW_TALK_ID);

    const res = await request(app).get(`/api/users/${ALICE}/peers/${BOB}/talk-history`);
    expect(res.body[0].direction).toBe('received');
  });

  it('outcome=match when Bob matched on Alice sent talk', async () => {
    const { app, incomingTalksMap, talkResponsesMap } = buildTestServer();
    addIncoming(incomingTalksMap, BOB, 'ik_talk1', ALICE, FLOW_TALK_ID);
    addResponse(talkResponsesMap, FLOW_TALK_ID, BOB, 'match');

    const res = await request(app).get(`/api/users/${ALICE}/peers/${BOB}/talk-history`);
    expect(res.body[0].outcome).toBe('match');
  });

  it('outcome=mismatch when Bob did not match', async () => {
    const { app, incomingTalksMap, talkResponsesMap } = buildTestServer();
    addIncoming(incomingTalksMap, BOB, 'ik_talk1', ALICE, FLOW_TALK_ID);
    addResponse(talkResponsesMap, FLOW_TALK_ID, BOB, 'other');

    const res = await request(app).get(`/api/users/${ALICE}/peers/${BOB}/talk-history`);
    expect(res.body[0].outcome).toBe('mismatch');
  });

  it('outcome=pending when no response recorded', async () => {
    const { app, incomingTalksMap } = buildTestServer();
    addIncoming(incomingTalksMap, BOB, 'ik_talk1', ALICE, FLOW_TALK_ID);

    const res = await request(app).get(`/api/users/${ALICE}/peers/${BOB}/talk-history`);
    expect(res.body[0].outcome).toBe('pending');
  });

  it('returns both sent and received talks together', async () => {
    const { app, incomingTalksMap } = buildTestServer();
    addIncoming(incomingTalksMap, BOB, 'ik_sent', ALICE, FLOW_TALK_ID);
    addIncoming(incomingTalksMap, ALICE, 'ik_recv', BOB, TAG_TALK_ID);

    const res = await request(app).get(`/api/users/${ALICE}/peers/${BOB}/talk-history`);
    expect(res.body).toHaveLength(2);
    const directions = res.body.map((i: any) => i.direction).sort();
    expect(directions).toEqual(['received', 'sent']);
  });

  it('does not include talks where Carol was the sender/receiver', async () => {
    const { app, incomingTalksMap } = buildTestServer();
    addIncoming(incomingTalksMap, CAROL, 'ik_carol', ALICE, FLOW_TALK_ID);
    addIncoming(incomingTalksMap, ALICE, 'ik_carol2', CAROL, TAG_TALK_ID);

    const res = await request(app).get(`/api/users/${ALICE}/peers/${BOB}/talk-history`);
    expect(res.body).toHaveLength(0);
  });

  it('returns 403 when the peer blocked the viewer', async () => {
    const { app, blockedByUser } = buildTestServer();
    blockedByUser.set(BOB, new Set([ALICE]));

    const res = await request(app).get(`/api/users/${ALICE}/peers/${BOB}/talk-history`);
    expect(res.status).toBe(403);
    expect(res.body.blockedBy).toBe(true);
  });
});
