import { buildTalkIdentityKey } from './cid';

/** Gun path root for directed talk offers (P0 mesh delivery). */
export const PEER_TALK_OFFERS_ROOT = 'peerTalkOffers';

/** Author-published full talk body for mesh pull (P0-5). */
export const PEER_TALK_CATALOG_ROOT = 'peerTalkCatalog';

export type PeerTalkCatalogWire = {
  version: 1;
  talkId: string;
  authorId: string;
  talkData: Record<string, unknown>;
  updatedAt: string;
};

export type PeerTalkOfferWire = {
  version: 1;
  talkId: string;
  senderId: string;
  senderName: string;
  /** Full talk JSON (same shape as POST /received body). */
  talkData: Record<string, unknown>;
  createdAt: string;
  /** Chatroom where the sender broadcast (FR-BM-7 room isolation). */
  deliveryChatroomId?: string;
  /** Skip room membership gate (Send My Talks / directed peer send). */
  directPeerSend?: boolean;
};

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

export function buildPeerTalkOfferKey(senderId: string, talkId: string): string {
  return `${String(senderId || '').trim()}::${String(talkId || '').trim()}`;
}

export function parsePeerTalkOfferKey(key: string): { senderId: string; talkId: string } | null {
  const idx = key.indexOf('::');
  if (idx <= 0) return null;
  return { senderId: key.slice(0, idx), talkId: key.slice(idx + 2) };
}

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

/** Restore questions/tags after reading a Gun-safe offer or catalog node. */
export function expandTalkDataFromGunWire(talkData: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...talkData };
  if (!Array.isArray(out.questions) && typeof out.questionsJson === 'string') {
    try {
      out.questions = JSON.parse(out.questionsJson);
    } catch {
      /* ignore */
    }
  }
  if (!Array.isArray(out.tags) && typeof out.tagsJson === 'string') {
    try {
      out.tags = JSON.parse(out.tagsJson);
    } catch {
      /* ignore */
    }
  }
  return out;
}

export function createPeerTalkOfferWire(params: {
  talkId: string;
  senderId: string;
  senderName: string;
  talkData: Record<string, unknown>;
  deliveryChatroomId?: string;
  directPeerSend?: boolean;
  now?: Date;
}): PeerTalkOfferWire {
  const now = params.now ?? new Date();
  return {
    version: 1,
    talkId: params.talkId,
    senderId: params.senderId,
    senderName: params.senderName,
    talkData: gunSafeTalkDataRecord(params.talkData),
    createdAt: now.toISOString(),
    ...(params.deliveryChatroomId ? { deliveryChatroomId: params.deliveryChatroomId } : {}),
    ...(params.directPeerSend ? { directPeerSend: true } : {}),
  };
}

/**
 * Merge one delivery into a local incoming cluster (same shape as server incomingTalksMap).
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

export function clusterFromPeerTalkOffer(offer: PeerTalkOfferWire): IncomingTalkClusterWire {
  return mergeIncomingTalkCluster(null, {
    talkId: offer.talkId,
    talkData: expandTalkDataFromGunWire(offer.talkData),
    senderId: offer.senderId,
    senderName: offer.senderName,
    now: new Date(offer.createdAt),
  });
}
