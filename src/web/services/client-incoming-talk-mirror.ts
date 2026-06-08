import {
  OWNER_INCOMING_TALK_INDEX_ROOT,
  gunSafeTalkDataRecord,
  mergeIncomingTalkCluster,
  type IncomingTalkClusterWire,
} from '../../shared/peer-talk-delivery';
import type { P2PRuntimeFlags } from '../../shared/p2p-runtime';
import type { WebGunService } from './web-gun-service';

/** Mirror a talk definition node for mesh subscribers. */
export function mirrorTalkDefinitionToLocalGun(
  gunService: WebGunService,
  talkId: string,
  talkData: unknown,
  flags: P2PRuntimeFlags,
): void {
  if (!flags.p2pClientTalkMirror || !talkId) return;
  const wire =
    talkData && typeof talkData === 'object'
      ? gunSafeTalkDataRecord(talkData as Record<string, unknown>)
      : talkData;
  gunService.getGun().get('talks').get(talkId).put(wire);
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
    gun.get(OWNER_INCOMING_TALK_INDEX_ROOT).get(userId).get(cluster.identityKey).put(raw);
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
  mirrorTalkDefinitionToLocalGun(gunService, params.talkId, params.talkData, flags);
  mirrorIncomingTalkClustersToLocalGun(gunService, receiverUserId, [cluster], flags);
  return cluster;
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
      const cluster = raw as IncomingTalkClusterWire;
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
    const cluster = raw as IncomingTalkClusterWire;
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
