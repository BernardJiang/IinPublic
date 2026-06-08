import { buildTalkIdentityKey } from './cid';

/** Owner-scoped mesh IN index. */
export const OWNER_INCOMING_TALK_INDEX_ROOT = 'ownerIncomingTalkIndex';

export type IncomingTalkClusterWire = {
  identityKey: string;
  title: string;
  type: string;
  language: string;
  senders: Record<
    string,
    { senderId: string; senderName: string; lastTalkId: string; lastReceivedAt: string }
  >;
  talkIds: Record<string, string>;
  questionsJson?: string;
  questionCount: number;
  latestTalkId: string;
  updatedAt: string;
  identityAliases: Record<string, boolean>;
  authorLocation?: { latitude: number; longitude: number };
};

/** Gun cannot store nested arrays; serialize questions/tags before .put on mesh paths. */
export function gunSafeTalkDataRecord(talkData: Record<string, unknown>): Record<string, unknown> {
  // Serialize through JSON to normalize Date instances into ISO strings.
  const out: Record<string, unknown> = JSON.parse(JSON.stringify(talkData || {}));
  if (Array.isArray(out.questions)) {
    out.questionsJson = JSON.stringify(out.questions);
    delete out.questions;
  }
  if (Array.isArray(out.tags)) {
    out.tagsJson = JSON.stringify(out.tags);
    delete out.tags;
  }
  return out;
}

/**
 * Merge one mesh delivery into a local incoming cluster.
 */
export function mergeIncomingTalkCluster(
  existing: IncomingTalkClusterWire | null | undefined,
  params: {
    talkId: string;
    talkData: Record<string, unknown>;
    senderId: string;
    senderName: string;
    now?: Date;
  },
): IncomingTalkClusterWire {
  const nowIso = (params.now ?? new Date()).toISOString();
  const identityKey = buildTalkIdentityKey(params.talkData);
  const base: IncomingTalkClusterWire = existing ?? {
    identityKey,
    title: '',
    type: 'flow',
    language: 'en',
    senders: {},
    talkIds: {},
    questionCount: 0,
    latestTalkId: params.talkId,
    updatedAt: nowIso,
    identityAliases: { [identityKey]: true },
  };

  const senderMap = { ...base.senders };
  senderMap[params.senderId] = {
    senderId: params.senderId,
    senderName: params.senderName || senderMap[params.senderId]?.senderName || 'Someone',
    lastTalkId: params.talkId,
    lastReceivedAt: nowIso,
  };

  const talkIds = { ...base.talkIds, [params.talkId]: nowIso };
  const questions = params.talkData?.questions;
  const questionsJsonForNode =
    Array.isArray(questions) && questions.length > 0
      ? JSON.stringify(questions)
      : base.questionsJson;

  const authorLocation =
    params.talkData?.authorLocation && typeof params.talkData.authorLocation === 'object'
      ? {
          latitude: Number((params.talkData.authorLocation as { latitude: number }).latitude),
          longitude: Number((params.talkData.authorLocation as { longitude: number }).longitude),
        }
      : base.authorLocation;

  return {
    identityKey: base.identityKey || identityKey,
    title: String(params.talkData?.title || base.title || ''),
    type: String(params.talkData?.type || base.type || 'flow'),
    language: String(params.talkData?.language || base.language || 'en'),
    senders: senderMap,
    talkIds,
    ...(questionsJsonForNode ? { questionsJson: questionsJsonForNode } : {}),
    questionCount: Array.isArray(questions) ? questions.length : base.questionCount || 0,
    latestTalkId: params.talkId,
    updatedAt: nowIso,
    identityAliases: {
      ...(base.identityAliases || {}),
      [identityKey]: true,
    },
    ...(authorLocation ? { authorLocation } : {}),
  };
}
