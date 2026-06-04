import type { TalkResponse } from '../../../src/shared/talk-stats';
import { buildTalkIdentityKey, computeTalkIdFromTalkData } from './talk-content-id';
import { gunBaseURL } from './ports';
import { buildFlowTalkPayload } from './talk-lifecycle-fixtures';

function gunSnapshotNode(soul: string, fields: Record<string, unknown>): Record<string, unknown> {
  const state = Date.now();
  return {
    _: {
      '#': soul,
      '>': Object.fromEntries(Object.keys(fields).map((key) => [key, state])),
    },
    ...fields,
  };
}

type E2eServerSnapshot = {
  version: number;
  gunGraph: Record<string, unknown>;
  incomingTalks: Record<string, Record<string, unknown>>;
  conversations: Record<string, Record<string, unknown>>;
  talkResponses: Record<string, TalkResponse[]>;
  statsIdx?: {
    byDay: Record<string, unknown>;
    byRegion: Record<string, unknown>;
    byTalkAnswer: Record<string, unknown>;
  };
};

export type MatrixResponder = { id: string; stageName: string };
export type MatrixTalk = { talkId: string; title: string; talkData: Record<string, unknown> };

async function postJson(base: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function pairIdForUsers(userA: string, userB: string): string {
  return [String(userA || '').trim(), String(userB || '').trim()].sort().join('__');
}

function linkNode(graph: Record<string, unknown>, parentSoul: string, key: string, childSoul: string): void {
  const existing = graph[parentSoul] && typeof graph[parentSoul] === 'object'
    ? (graph[parentSoul] as Record<string, unknown>)
    : gunSnapshotNode(parentSoul, {});
  existing[key] = { '#': childSoul };
  graph[parentSoul] = existing;
}

function upsertPairTalkResponseNode(
  graph: Record<string, unknown>,
  params: {
    creatorId: string;
    creatorName: string;
    talk: MatrixTalk;
    responder: MatrixResponder;
    responseId: string;
    answers: Array<{ questionId: string; answerId: string; answerText: string }>;
    isMatch: boolean;
    createdAt: number;
  },
): void {
  const pairId = pairIdForUsers(params.creatorId, params.responder.id);
  const rootSoul = 'pairTalkResponses';
  const pairSoul = `${rootSoul}/${pairId}`;
  const talkSoul = `${pairSoul}/${params.talk.talkId}`;
  const responseSoul = `${talkSoul}/${params.responseId}`;
  linkNode(graph, rootSoul, pairId, pairSoul);
  linkNode(graph, pairSoul, params.talk.talkId, talkSoul);
  linkNode(graph, talkSoul, params.responseId, responseSoul);
  graph[responseSoul] = gunSnapshotNode(responseSoul, {
    responseId: params.responseId,
    talkId: params.talk.talkId,
    pairId,
    responderId: params.responder.id,
    responderName: params.responder.stageName,
    authorId: params.creatorId,
    authorName: params.creatorName,
    answers: JSON.stringify(params.answers),
    submittedAt: new Date(params.createdAt).toISOString(),
    isChatbotResponse: false,
    transportMode: 'pair-direct',
    outcome: params.isMatch ? 'match' : 'mismatch',
  });
}

export async function seedMatrixResponders(count: number): Promise<MatrixResponder[]> {
  const base = gunBaseURL();
  const responders: MatrixResponder[] = [];
  for (let i = 0; i < count; i++) {
    const id = `matrix_responder_${i}`;
    const stageName = `Matrix User ${i}`;
    const create = await postJson(base, '/api/users', {
      id,
      stageName,
      languages: ['en'],
      profile: [],
      interests: [],
      talkFilters: {
        allowedLanguages: ['en'],
        minDistanceMiles: 0,
        maxDistanceMiles: 50,
        requireGoodGrammar: false,
        blockDirtyWords: false,
        allowedTalkTypes: ['flow', 'survey', 'tag', 'route'],
      },
    });
    if (!create.ok && create.status !== 400) {
      throw new Error(`seedMatrixResponders create failed: ${create.status} ${await create.text()}`);
    }
    const join = await postJson(base, '/api/chatrooms/global/members', { userId: id, stageName });
    if (!join.ok) {
      throw new Error(`seedMatrixResponders join failed: ${join.status} ${await join.text()}`);
    }
    responders.push({ id, stageName });
  }
  return responders;
}

export async function registerTalkToResponders(
  senderId: string,
  senderName: string,
  receiverIds: string[],
  talk: MatrixTalk,
): Promise<void> {
  const base = gunBaseURL();
  const res = await postJson(
    base,
    `/api/talks/${encodeURIComponent(talk.talkId)}/register-receivers-for-broadcast`,
    {
      senderId,
      senderName,
      receiverIds,
      talkData: talk.talkData,
    },
  );
  if (!res.ok) {
    throw new Error(`register-receivers failed for ${talk.title}: ${res.status} ${await res.text()}`);
  }
}

export async function submitMatrixResponse(
  talk: MatrixTalk,
  responder: MatrixResponder,
  match: boolean,
): Promise<void> {
  const base = gunBaseURL();
  const talkData = talk.talkData as any;
  const questions = Array.isArray(talkData?.questions) ? talkData.questions : [];
  const q = questions[0];
  const answers = Array.isArray(q?.answers) ? q.answers : [];
  const picked = match
    ? answers.find((a: any) => a?.isMatch)
    : answers.find((a: any) => a?.isIgnore);
  const res = await postJson(base, `/api/stats/talks/${encodeURIComponent(talk.talkId)}/record`, {
    responderId: responder.id,
    talkType: talkData?.type || 'flow',
    answers: [
      {
        questionId: String(q?.id || 'q1'),
        answerId: String(picked?.id || (match ? 'a_match' : 'a_ignore')),
        answerText: String(picked?.text || (match ? 'Yes' : 'No')),
      },
    ],
    outcome: match ? 'match' : 'other',
  });
  if (!res.ok) {
    throw new Error(`matrix stats record failed: ${res.status} ${await res.text()}`);
  }
}

/** Responder i matches talk i; all other pairs mismatch (10×10 = 100 replies). */
export async function seedDiagonalReplyMatrix(
  responders: MatrixResponder[],
  talks: MatrixTalk[],
): Promise<void> {
  for (let t = 0; t < talks.length; t++) {
    for (let r = 0; r < responders.length; r++) {
      await submitMatrixResponse(talks[t], responders[r], t === r);
    }
  }
}

/** One champion responder matches every talk; all others mismatch (for sort-by-matches tests). */
export async function seedChampionReplyMatrix(
  responders: MatrixResponder[],
  talks: MatrixTalk[],
  championIndex = 9,
): Promise<void> {
  for (let t = 0; t < talks.length; t++) {
    for (let r = 0; r < responders.length; r++) {
      await submitMatrixResponse(talks[t], responders[r], r === championIndex);
    }
  }
}

function makeIncomingCluster(
  senderId: string,
  senderName: string,
  talk: MatrixTalk,
  identityKey: string,
): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    identityKey,
    title: talk.title,
    type: 'flow',
    language: 'en',
    senders: { [senderId]: { senderId, senderName, lastTalkId: talk.talkId } },
    talkIds: { [talk.talkId]: now },
    latestTalkId: talk.talkId,
    updatedAt: now,
  };
}

/**
 * Seeds creator reply triage state in one import-snapshot call (avoids slow register/response fanout).
 */
export function buildMatrixTalks(authorId: string, count: number): MatrixTalk[] {
  return Array.from({ length: count }, (_, i) => {
    const talkData = buildFlowTalkPayload(authorId, `Matrix Talk ${i}`, { matchText: 'Yes', ignoreText: 'No' });
    const talkId = computeTalkIdFromTalkData(talkData as any);
    return { talkId, title: String(talkData.title), talkData };
  });
}

export async function importChampionReplyMatrixSnapshot(opts: {
  creatorId: string;
  creatorName: string;
  talks: MatrixTalk[];
  responders: MatrixResponder[];
  championIndex: number;
}): Promise<void> {
  const base = gunBaseURL();
  const exportRes = await fetch(`${base}/api/test/export-snapshot`);
  if (!exportRes.ok) {
    throw new Error(`export-snapshot failed: ${exportRes.status} ${await exportRes.text()}`);
  }
  const snapshot = (await exportRes.json()) as E2eServerSnapshot;
  const gunGraph = { ...(snapshot.gunGraph || {}) };
  const incomingTalks = { ...(snapshot.incomingTalks || {}) };
  const talkResponses: Record<string, TalkResponse[]> = { ...(snapshot.talkResponses || {}) };
  const { creatorId, creatorName, talks, responders, championIndex } = opts;
  const nowMs = Date.now();

  if (!gunGraph.users || typeof gunGraph.users !== 'object') {
    gunGraph.users = gunSnapshotNode('users', {});
  }
  const usersRoot = gunGraph.users as Record<string, unknown>;
  for (const responder of responders) {
    const soul = `users/${responder.id}`;
    usersRoot[responder.id] = { '#': soul };
    gunGraph[soul] = gunSnapshotNode(soul, {
      id: responder.id,
      stageName: responder.stageName,
    });
  }

  for (let t = 0; t < talks.length; t++) {
    const talk = talks[t];
    const identityKey = buildTalkIdentityKey(talk.talkData as any);
    for (let r = 0; r < responders.length; r++) {
      const responder = responders[r];
      if (!incomingTalks[responder.id]) incomingTalks[responder.id] = {};
      incomingTalks[responder.id][identityKey] = makeIncomingCluster(
        creatorId,
        creatorName,
        talk,
        identityKey,
      );
      // Champion matches every talk (user-matches sort). Talk 0 also gets every responder (talk-matches sort).
      const match = r === championIndex || t === 0;
      const responseId = `matrix_resp_${t}_${r}`;
      const responseAnswers = [
        { questionId: 'q1', answerId: match ? 'a_match' : 'a_ignore', answerText: match ? 'Yes' : 'No' },
      ];
      const createdAt = nowMs + t * 1000 + r;
      const list = [...(talkResponses[talk.talkId] || [])];
      list.push({
        responseId,
        talkId: talk.talkId,
        talkType: 'flow',
        responderId: responder.id,
        region: 'global',
        answers: responseAnswers,
        createdAt,
        outcome: match ? 'match' : 'other',
        answerMode: 'manual',
      });
      talkResponses[talk.talkId] = list;
      upsertPairTalkResponseNode(gunGraph, {
        creatorId,
        creatorName,
        talk,
        responder,
        responseId,
        answers: responseAnswers,
        isMatch: match,
        createdAt,
      });
    }
  }

  const importRes = await postJson(base, '/api/test/import-snapshot', {
    ...snapshot,
    gunGraph,
    incomingTalks,
    talkResponses,
  });
  if (!importRes.ok) {
    throw new Error(`import-snapshot failed: ${importRes.status} ${await importRes.text()}`);
  }
}

export async function createMatrixTalksViaApi(
  authorId: string,
  count: number,
): Promise<MatrixTalk[]> {
  const base = gunBaseURL();
  const talks: MatrixTalk[] = [];
  for (let i = 0; i < count; i++) {
    const talkData = buildFlowTalkPayload(authorId, `Matrix Talk ${i}`, { matchText: 'Yes', ignoreText: 'No' });
    const talkId = computeTalkIdFromTalkData(talkData as any);
    const res = await postJson(base, '/api/talks', { ...talkData, id: talkId });
    if (!res.ok) {
      throw new Error(`createMatrixTalksViaApi failed: ${res.status} ${await res.text()}`);
    }
    talks.push({ talkId, title: String(talkData.title), talkData });
  }
  return talks;
}

export function buildMatrixTalkPayloads(authorId: string, count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) =>
    buildFlowTalkPayload(authorId, `Matrix Talk ${i}`, { matchText: 'Yes', ignoreText: 'No' }),
  );
}
