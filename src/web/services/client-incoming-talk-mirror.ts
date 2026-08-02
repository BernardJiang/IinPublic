import {
  OWNER_INCOMING_TALK_INDEX_ROOT,
  mergeIncomingTalkCluster,
  planIncomingTalkClusterPrune,
  type IncomingTalkClusterWire,
} from '../../shared/peer-talk-delivery';
import type { P2PRuntimeFlags } from '../../shared/p2p-runtime';
import type { WebGunService } from './web-gun-service';

type StoredIncomingTalkCluster = Omit<IncomingTalkClusterWire, 'senders' | 'talkIds' | 'identityAliases'> & {
  senders?: IncomingTalkClusterWire['senders'];
  talkIds?: IncomingTalkClusterWire['talkIds'];
  identityAliases?: IncomingTalkClusterWire['identityAliases'];
  sendersJson?: string;
  talkIdsJson?: string;
  identityAliasesJson?: string;
};

function serializeCluster(cluster: IncomingTalkClusterWire): StoredIncomingTalkCluster {
  const { senders, talkIds, identityAliases, ...rest } = cluster;
  return {
    ...rest,
    sendersJson: JSON.stringify(senders || {}),
    talkIdsJson: JSON.stringify(talkIds || {}),
    identityAliasesJson: JSON.stringify(identityAliases || {}),
  };
}

function hydrateCluster(raw: unknown): IncomingTalkClusterWire | null {
  if (!raw || typeof raw !== 'object') return null;
  const stored = raw as StoredIncomingTalkCluster;
  const parseMap = <T>(json: string | undefined, fallback: T): T => {
    if (!json) return fallback;
    try {
      return JSON.parse(json) as T;
    } catch {
      return fallback;
    }
  };
  return {
    ...stored,
    senders: parseMap(stored.sendersJson, stored.senders || {}),
    talkIds: parseMap(stored.talkIdsJson, stored.talkIds || {}),
    identityAliases: parseMap(stored.identityAliasesJson, stored.identityAliases || {}),
  };
}

export function mirrorIncomingTalkClustersToLocalGun(
  gunService: WebGunService,
  userId: string,
  clusters: unknown[],
  flags: P2PRuntimeFlags,
): void {
  if (!flags.p2pClientTalkMirror || !userId || !Array.isArray(clusters)) return;
  const gun = gunService.getGun();
  for (const raw of clusters) {
    const cluster = raw as { identityKey?: string };
    if (!cluster?.identityKey) continue;
    gun.get(OWNER_INCOMING_TALK_INDEX_ROOT).get(userId).get(cluster.identityKey).put(
      serializeCluster(raw as IncomingTalkClusterWire),
    );
  }
}

export function upsertLocalIncomingTalkCluster(
  gunService: WebGunService,
  receiverUserId: string,
  params: {
    talkId: string;
    talkData: Record<string, unknown>;
    senderId: string;
    senderName: string;
  },
  flags: P2PRuntimeFlags,
  existingCluster?: IncomingTalkClusterWire | null,
): IncomingTalkClusterWire {
  const cluster = mergeIncomingTalkCluster(existingCluster, params);
  if (!flags.p2pClientTalkMirror) return cluster;
  mirrorIncomingTalkClustersToLocalGun(gunService, receiverUserId, [cluster], flags);
  // docs/TODO.md §Y2: fire-and-forget, mirroring the visit-counter prune trigger
  // (WebChatroomService.recordRoomVisit) — every device prunes its own local Gun graph
  // independently, there is no single authoritative pruner under the P2P model.
  void pruneIncomingTalkClustersIfNeeded(gunService, receiverUserId, flags).catch((err) => {
    console.warn('[client-incoming-talk-mirror] incoming-talk-cluster prune failed (non-fatal):', receiverUserId, err);
  });
  return cluster;
}

/**
 * docs/TODO.md §Y2 — once a user's live incoming-talk-cluster count exceeds
 * `DEFAULT_INCOMING_TALK_CLUSTER_MAX_SLOTS`, delete the oldest (by `updatedAt`) outright.
 * No aggregate fold needed here (see `planIncomingTalkClusterPrune`'s doc comment) — a
 * pruned cluster's own Q&A record already survives independently in the Me tab.
 */
export async function pruneIncomingTalkClustersIfNeeded(
  gunService: WebGunService,
  receiverUserId: string,
  flags: P2PRuntimeFlags,
): Promise<void> {
  if (!flags.p2pClientTalkMirror || !receiverUserId) return;
  const clusters = await collectLocalIncomingTalkClusters(gunService, receiverUserId, flags);
  const plan = planIncomingTalkClusterPrune(clusters);
  if (plan.clustersToPrune.length === 0) return;
  const gun = gunService.getGun();
  const ownerRef = gun.get(OWNER_INCOMING_TALK_INDEX_ROOT).get(receiverUserId);
  for (const cluster of plan.clustersToPrune) {
    if (cluster.identityKey) ownerRef.get(cluster.identityKey).put(null);
  }
}

export async function collectLocalIncomingTalkClusters(
  gunService: WebGunService,
  receiverUserId: string,
  _flags: P2PRuntimeFlags,
  opts: { waitMs?: number } = {},
): Promise<IncomingTalkClusterWire[]> {
  const gun = gunService.getGun();
  const waitMs = opts.waitMs ?? 400;
  const clusters: IncomingTalkClusterWire[] = [];
  const ref = gun.get(OWNER_INCOMING_TALK_INDEX_ROOT).get(receiverUserId).map();
  await new Promise<void>((resolve) => {
    ref.once((raw: unknown, key: string) => {
      if (!raw || !key || key.startsWith('_')) return;
      const cluster = hydrateCluster(raw);
      if (cluster?.identityKey) clusters.push(cluster);
    });
    setTimeout(resolve, waitMs);
  });
  try {
    ref.off();
  } catch {
    /* ignore */
  }
  const byKey = new Map<string, IncomingTalkClusterWire>();
  for (const cluster of clusters) {
    if (cluster.identityKey) byKey.set(cluster.identityKey, cluster);
  }
  return [...byKey.values()];
}

export function subscribeLocalIncomingTalkClusters(
  gunService: WebGunService,
  receiverUserId: string,
  _flags: P2PRuntimeFlags,
  handler: (cluster: IncomingTalkClusterWire, id: string) => void,
): () => void {
  const ref = gunService.getGun().get(OWNER_INCOMING_TALK_INDEX_ROOT).get(receiverUserId).map();
  ref.on((raw: unknown, key: string) => {
    if (!raw || !key || key.startsWith('_')) return;
    const cluster = hydrateCluster(raw);
    if (cluster?.identityKey) handler(cluster, key);
  });
  return () => {
    try {
      ref.off();
    } catch {
      /* ignore */
    }
  };
}
