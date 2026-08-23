import { buildTalkIdentityKey } from './cid';
import { deriveRetentionCap, representativeIncomingTalkClusterBytes } from './graph-size-report';

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

/**
 * docs/TODO.md §Y2 — `ownerIncomingTalkIndex/<userId>/<identityKey>` has the same unbounded
 * one-node-per-X-per-Y growth shape §L2 already solved for room visit counters: no cap, no
 * delete path. Mirrors `planVisitCounterPrune` (`src/shared/visit-counter.ts`) exactly — oldest
 * `updatedAt` first, pruned back to `maxSlots` — except there's no lifetime aggregate to fold
 * into first: a cluster's own Q&A record already lives independently in the Me tab's answer
 * history (Bernard, 2026-08-01, closing the tombstone half of this item), so a pruned cluster
 * has nothing that needs preserving. Delete outright.
 *
 * TODO §S2: no longer a flat guess — `deriveRetentionCap`'s
 * `floor(categoryShare / measuredAverageBytes)` against a real measured incoming-talk-cluster
 * sample and the shared 8 MiB local-storage budget (`graph-size-report.ts`).
 */
export const DEFAULT_INCOMING_TALK_CLUSTER_MAX_SLOTS =
  deriveRetentionCap(representativeIncomingTalkClusterBytes(), 500);

export type IncomingTalkClusterPrunePlan = {
  /** Clusters to delete, oldest `updatedAt` first — empty when nothing needs pruning yet. */
  clustersToPrune: IncomingTalkClusterWire[];
};

export function planIncomingTalkClusterPrune(
  clusters: IncomingTalkClusterWire[],
  maxSlots: number = DEFAULT_INCOMING_TALK_CLUSTER_MAX_SLOTS,
): IncomingTalkClusterPrunePlan {
  if (clusters.length <= maxSlots) return { clustersToPrune: [] };
  const sorted = [...clusters].sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0));
  const excess = clusters.length - maxSlots;
  return { clustersToPrune: sorted.slice(0, excess) };
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
