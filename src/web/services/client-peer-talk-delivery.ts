import {
  PEER_TALK_OFFERS_ROOT,
  buildPeerTalkOfferKey,
  clusterFromPeerTalkOffer,
  createPeerTalkOfferWire,
  mergeIncomingTalkCluster,
  type IncomingTalkClusterWire,
  type PeerTalkOfferWire,
} from '../../shared/peer-talk-delivery';
import type { P2PRuntimeFlags } from '../../shared/p2p-runtime';
import { usesDirectTalkDelivery } from '../../shared/p2p-runtime';
import type { WebGunService } from './web-gun-service';
import { mirrorIncomingTalkClustersToLocalGun, mirrorTalkDefinitionToLocalGun } from './client-incoming-talk-mirror';

export function publishPeerTalkOffer(
  gunService: WebGunService,
  receiverUserId: string,
  params: {
    talkId: string;
    senderId: string;
    senderName: string;
    talkData: Record<string, unknown>;
  },
): void {
  if (!receiverUserId || receiverUserId === params.senderId) return;
  const offer = createPeerTalkOfferWire(params);
  const key = buildPeerTalkOfferKey(params.senderId, params.talkId);
  gunService.getGun().get(PEER_TALK_OFFERS_ROOT).get(receiverUserId).get(key).put(offer);
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
  if (!usesDirectTalkDelivery(flags) && !flags.p2pClientTalkMirror) {
    return cluster;
  }
  mirrorTalkDefinitionToLocalGun(gunService, params.talkId, params.talkData, flags);
  mirrorIncomingTalkClustersToLocalGun(gunService, receiverUserId, [cluster], flags);
  return cluster;
}

export function applyPeerTalkOfferToLocalInbox(
  gunService: WebGunService,
  receiverUserId: string,
  offer: PeerTalkOfferWire,
  flags: P2PRuntimeFlags,
): IncomingTalkClusterWire {
  return upsertLocalIncomingTalkCluster(
    gunService,
    receiverUserId,
    {
      talkId: offer.talkId,
      talkData: offer.talkData,
      senderId: offer.senderId,
      senderName: offer.senderName,
    },
    flags,
    clusterFromPeerTalkOffer(offer),
  );
}

export function subscribePeerTalkOffers(
  gunService: WebGunService,
  receiverUserId: string,
  handler: (offer: PeerTalkOfferWire, offerKey: string) => void,
): () => void {
  const gun = gunService.getGun();
  const seen = new Set<string>();
  const ref = gun.get(PEER_TALK_OFFERS_ROOT).get(receiverUserId).map();
  ref.on((raw: unknown, key: string) => {
    if (!raw || !key || key.startsWith('_')) return;
    const dedupe = `${key}`;
    if (seen.has(dedupe)) return;
    const offer = raw as PeerTalkOfferWire;
    if (offer?.version !== 1 || !offer.talkId || !offer.senderId || !offer.talkData) return;
    seen.add(dedupe);
    handler(offer, key);
  });
  return () => {
    try {
      ref.off();
    } catch {
      /* ignore */
    }
  };
}

export async function collectLocalIncomingTalkClusters(
  gunService: WebGunService,
  receiverUserId: string,
  opts: { waitMs?: number } = {},
): Promise<IncomingTalkClusterWire[]> {
  const gun = gunService.getGun();
  const waitMs = opts.waitMs ?? 400;
  const clusters: IncomingTalkClusterWire[] = [];
  const ref = gun.get('incomingTalksByUser').get(receiverUserId).map();
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
  for (const c of clusters) {
    if (c.identityKey) byKey.set(c.identityKey, c);
  }
  return [...byKey.values()];
}
