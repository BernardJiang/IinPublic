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

export function createPeerTalkOfferWire(params: {
  talkId: string;
  senderId: string;
  senderName: string;
  talkData: Record<string, unknown>;
  now?: Date;
}): PeerTalkOfferWire {
  const now = params.now ?? new Date();
  return {
    version: 1,
    talkId: params.talkId,
    senderId: params.senderId,
    senderName: params.senderName,
    talkData: params.talkData,
    createdAt: now.toISOString(),
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
    talkData: offer.talkData,
    senderId: offer.senderId,
    senderName: offer.senderName,
    now: new Date(offer.createdAt),
  });
}
