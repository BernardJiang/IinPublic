import { TALK_CONTENT_HASH_ID } from '../shared/incoming-talk-ids';
import {
  PEER_TALK_CATALOG_ROOT,
  PEER_TALK_OFFERS_ROOT,
  buildPeerTalkOfferKey,
  createPeerTalkOfferWire,
  gunSafeTalkDataRecord,
  type PeerTalkCatalogWire,
} from '../shared/peer-talk-delivery';
import type { GunService } from './services/gun-service';

/**
 * Mirror directed/broadcast talk delivery onto Gun mesh paths so P0 browsers
 * reconcile `peerTalkOffers` + `incomingTalksByUser` (GET /incoming-talks stays empty).
 */
export async function mirrorP0TalkDeliveryToGun(
  gunService: GunService,
  params: {
    receiverId: string;
    talkId: string;
    talkData: Record<string, unknown>;
    senderId: string;
    senderName: string;
    cluster: Record<string, unknown>;
    deliveryChatroomId?: string;
    directPeerSend?: boolean;
  },
): Promise<void> {
  const { receiverId, talkId, talkData, senderId, senderName, cluster } = params;
  const tid = String(talkId || '').trim();
  if (!receiverId || !tid || !senderId) return;

  const talkRecord = gunSafeTalkDataRecord(talkData);
  const catalog: PeerTalkCatalogWire = {
    version: 1,
    talkId: tid,
    authorId: senderId,
    talkData: talkRecord,
    updatedAt: new Date().toISOString(),
  };
  const relay = { relayP0TalkDelivery: true as const };
  await gunService.putPath([PEER_TALK_CATALOG_ROOT, senderId, tid], catalog, relay);

  const offer = createPeerTalkOfferWire({
    talkId: tid,
    senderId,
    senderName,
    talkData: talkRecord,
    ...(params.deliveryChatroomId ? { deliveryChatroomId: params.deliveryChatroomId } : {}),
    ...(params.directPeerSend ? { directPeerSend: true } : {}),
  });
  const offerKey = buildPeerTalkOfferKey(senderId, tid);
  await gunService.putPath([PEER_TALK_OFFERS_ROOT, receiverId, offerKey], offer, relay);

  const identityKey = String(cluster.identityKey || '').trim();
  const storageLeaf = TALK_CONTENT_HASH_ID.test(tid) ? tid : identityKey || tid;
  await gunService.putPath(['incomingTalksByUser', receiverId, storageLeaf], cluster, relay);
}
