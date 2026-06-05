import {
  OWNER_INCOMING_TALK_INDEX_ROOT,
  PEER_TALK_CATALOG_ROOT,
  PEER_TALK_OFFERS_ROOT,
  buildPeerTalkOfferKey,
  clusterFromPeerTalkOffer,
  createPeerTalkOfferWire,
  expandTalkDataFromGunWire,
  gunSafeTalkDataRecord,
  mergeIncomingTalkCluster,
  peerTalkOfferSigningPayload,
  type IncomingTalkClusterWire,
  type PeerTalkCatalogWire,
  type PeerTalkOfferWire,
} from '../../shared/peer-talk-delivery';
import type { Talk } from '../../shared/types';
import type { P2PRuntimeFlags } from '../../shared/p2p-runtime';
import { createSignedP2PEnvelopeProof, usesDirectTalkDelivery, verifySignedP2PEnvelopeProof } from '../../shared/p2p-runtime';
import { isTrustCapableForOffer } from '../../shared/p2p-trust-neighbor-bridge';
import type { PeerTrustRecord } from '../../shared/p2p-trust';
import type { WebGunService } from './web-gun-service';
import { mirrorIncomingTalkClustersToLocalGun, mirrorTalkDefinitionToLocalGun } from './client-incoming-talk-mirror';

export function publishPeerTalkCatalog(
  gunService: WebGunService,
  params: {
    talkId: string;
    authorId: string;
    talkData: Record<string, unknown>;
  },
): void {
  const { talkId, authorId, talkData } = params;
  if (!talkId || !authorId) return;
  const wire: PeerTalkCatalogWire = {
    version: 1,
    talkId,
    authorId,
    talkData: gunSafeTalkDataRecord(talkData),
    updatedAt: new Date().toISOString(),
  };
  gunService.getGun().get(PEER_TALK_CATALOG_ROOT).get(authorId).get(talkId).put(wire);
}

export async function publishPeerTalkOffer(
  gunService: WebGunService,
  receiverUserId: string,
  params: {
    talkId: string;
    senderId: string;
    senderName: string;
    talkData: Record<string, unknown>;
    deliveryChatroomId?: string;
    directPeerSend?: boolean;
  },
): Promise<void> {
  if (!receiverUserId || receiverUserId === params.senderId) return;
  const pair = gunService.getStoredPair();
  if (!pair?.pub || !pair.priv) throw new Error('Peer talk offers require a SEA signing pair');
  const senderEpub = pair.epub;
  const now = new Date();
  const unsignedOffer = createPeerTalkOfferWire({
    ...params,
    senderPub: String(pair.pub),
    ...(senderEpub ? { senderEpub: String(senderEpub) } : {}),
    now,
  });
  const proof = await createSignedP2PEnvelopeProof({
    pair,
    payload: peerTalkOfferSigningPayload(unsignedOffer),
  });
  const offer = createPeerTalkOfferWire({
    ...params,
    senderPub: String(pair.pub),
    ...(senderEpub ? { senderEpub: String(senderEpub) } : {}),
    proof,
    now,
  });
  const key = buildPeerTalkOfferKey(params.senderId, params.talkId);
  gunService.getGun().get(PEER_TALK_OFFERS_ROOT).get(receiverUserId).get(key).put(offer);
}

async function verifyPeerTalkOfferWire(offer: PeerTalkOfferWire): Promise<boolean> {
  if (!offer.senderPub || !offer.senderPeerId || !offer.timestamp || !offer.payloadHash || !offer.signature || !offer.nonce) {
    return false;
  }
  const verification = await verifySignedP2PEnvelopeProof({
    proof: {
      peerId: offer.senderPeerId,
      pub: offer.senderPub,
      timestamp: offer.timestamp,
      nonce: offer.nonce,
      payloadHash: offer.payloadHash,
      signature: offer.signature,
    },
    payload: peerTalkOfferSigningPayload(offer),
  });
  return verification.ok;
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
  offer: PeerTalkOfferWire & { talkData: Record<string, unknown> },
  flags: P2PRuntimeFlags,
): IncomingTalkClusterWire {
  return upsertLocalIncomingTalkCluster(
    gunService,
    receiverUserId,
    {
      talkId: offer.talkId,
      talkData: expandTalkDataFromGunWire(offer.talkData),
      senderId: offer.senderId,
      senderName: offer.senderName,
    },
    flags,
    clusterFromPeerTalkOffer(offer),
  );
}

/**
 * Optional trust gate injected by the caller.
 * Receives the sender id and returns `false` to silently drop the offer.
 * When omitted all verified offers are accepted (existing behaviour).
 */
export type TrustGate = (senderId: string) => boolean | Promise<boolean>;

export function subscribePeerTalkOffers(
  gunService: WebGunService,
  receiverUserId: string,
  handler: (offer: PeerTalkOfferWire, offerKey: string) => void,
  opts: { trustGate?: TrustGate } = {},
): () => void {
  const gun = gunService.getGun();
  const seen = new Set<string>();
  const ref = gun.get(PEER_TALK_OFFERS_ROOT).get(receiverUserId).map();
  ref.on((raw: unknown, key: string) => {
    if (!raw || !key || key.startsWith('_')) return;
    const dedupe = `${key}`;
    if (seen.has(dedupe)) return;
    const offer = raw as PeerTalkOfferWire;
    if (offer?.version !== 1 || !offer.talkId || !offer.senderId || !offer.talkRef) return;
    seen.add(dedupe);
    void verifyPeerTalkOfferWire(offer).then(async (ok) => {
      if (!ok) return;
      if (opts.trustGate) {
        const allowed = await opts.trustGate(offer.senderId);
        if (!allowed) return;
      }
      handler(offer, key);
    });
  });
  return () => {
    try {
      ref.off();
    } catch {
      /* ignore */
    }
  };
}

/**
 * Build a `TrustGate` from an in-memory trust store.
 * Blocked senders are silently dropped; unknown senders default to allowed.
 */
export function buildTrustGateFromStore(
  trustStore: Map<string, PeerTrustRecord>,
  getSenderPeerId: (senderId: string) => string | undefined,
): TrustGate {
  return (senderId: string) => {
    const peerId = getSenderPeerId(senderId);
    const trustRecord = peerId ? trustStore.get(peerId) : undefined;
    return isTrustCapableForOffer(trustRecord, 'receive-broadcast');
  };
}

export async function reconcilePeerTalkOffersFromGun(
  gunService: WebGunService,
  receiverUserId: string,
  flags: P2PRuntimeFlags,
  shouldAccept: (offer: PeerTalkOfferWire & { talkData: Record<string, unknown> }) => boolean | Promise<boolean>,
  opts: { waitMs?: number; trustGate?: TrustGate } = {},
): Promise<IncomingTalkClusterWire[]> {
  const gun = gunService.getGun();
  const waitMs = opts.waitMs ?? 500;
  const merged: IncomingTalkClusterWire[] = [];
  const offers: PeerTalkOfferWire[] = [];
  const seen = new Set<string>();
  const ref = gun.get(PEER_TALK_OFFERS_ROOT).get(receiverUserId).map();
  await new Promise<void>((resolve) => {
    setTimeout(() => {
      try {
        ref.off();
      } catch {
        /* ignore */
      }
      resolve();
    }, waitMs);
    ref.on((raw: unknown, key: string) => {
      if (!raw || !key || key.startsWith('_')) return;
      const dedupe = `${key}`;
      if (seen.has(dedupe)) return;
      const offer = raw as PeerTalkOfferWire;
      if (offer?.version !== 1 || !offer.talkId || !offer.senderId || !offer.talkRef) return;
      seen.add(dedupe);
      offers.push(offer);
    });
  });
  for (const offer of offers) {
    if (!(await verifyPeerTalkOfferWire(offer))) continue;
    if (opts.trustGate) {
      const allowed = await opts.trustGate(offer.senderId);
      if (!allowed) continue;
    }
    const authorId = offer.talkRef?.authorId || offer.senderId;
    const talkId = offer.talkRef?.talkId || offer.talkId;
    const talkData =
      offer.talkData ??
      (await loadPeerTalkCatalogFromGun(gunService, authorId, talkId, {
        timeoutMs: 1200,
      }));
    if (!talkData) continue;
    const hydratedOffer: PeerTalkOfferWire & { talkData: Record<string, unknown> } = {
      ...offer,
      talkData: talkData as unknown as Record<string, unknown>,
    };
    if (!(await shouldAccept(hydratedOffer))) continue;
    merged.push(applyPeerTalkOfferToLocalInbox(gunService, receiverUserId, hydratedOffer, flags));
  }
  return merged;
}

export async function collectLocalIncomingTalkClusters(
  gunService: WebGunService,
  receiverUserId: string,
  flags: P2PRuntimeFlags,
  opts: { waitMs?: number } = {},
): Promise<IncomingTalkClusterWire[]> {
  const gun = gunService.getGun();
  const waitMs = opts.waitMs ?? 400;
  const clusters: IncomingTalkClusterWire[] = [];
  const roots = flags.p2pDirectTalkDelivery
    ? [OWNER_INCOMING_TALK_INDEX_ROOT, 'incomingTalksByUser']
    : ['incomingTalksByUser'];
  const refs = roots.map((root) => gun.get(root).get(receiverUserId).map());
  await new Promise<void>((resolve) => {
    for (const ref of refs) {
      ref.once((raw: unknown, key: string) => {
        if (!raw || !key || key.startsWith('_')) return;
        const cluster = raw as IncomingTalkClusterWire;
        if (cluster?.identityKey) clusters.push(cluster);
      });
    }
    setTimeout(resolve, waitMs);
  });
  for (const ref of refs) {
    try {
      ref.off();
    } catch {
      /* ignore */
    }
  }
  const byKey = new Map<string, IncomingTalkClusterWire>();
  for (const c of clusters) {
    if (c.identityKey) byKey.set(c.identityKey, c);
  }
  return [...byKey.values()];
}

export function subscribeLocalIncomingTalkClusters(
  gunService: WebGunService,
  receiverUserId: string,
  flags: P2PRuntimeFlags,
  handler: (cluster: IncomingTalkClusterWire, id: string) => void,
): () => void {
  const gun = gunService.getGun();
  const roots = flags.p2pDirectTalkDelivery
    ? [OWNER_INCOMING_TALK_INDEX_ROOT, 'incomingTalksByUser']
    : ['incomingTalksByUser'];
  const refs = roots.map((root) => {
    const ref = gun.get(root).get(receiverUserId).map();
    ref.on((raw: unknown, key: string) => {
      if (!raw || !key || key.startsWith('_')) return;
      const cluster = raw as IncomingTalkClusterWire;
      if (cluster?.identityKey) handler(cluster, key);
    });
    return ref;
  });
  return () => {
    for (const ref of refs) {
      try {
        ref.off();
      } catch {
        /* ignore */
      }
    }
  };
}

function talkLooksComplete(talk: Talk | null): boolean {
  if (!talk) return false;
  if ((talk as Talk).type === 'tag') return !!(talk.title && talk.authorId);
  if (!Array.isArray(talk.questions) || talk.questions.length === 0) return false;
  const q0 = talk.questions[0];
  return !!(q0 && Array.isArray(q0.answers) && q0.answers.length > 0);
}

function normalizeTalkFromCatalog(raw: PeerTalkCatalogWire): Talk | null {
  const data = raw?.talkData;
  if (!data || typeof data !== 'object') return null;
  const body = expandTalkDataFromGunWire(data) as unknown as Talk;
  return { ...body, id: String(raw.talkId || body.id || '') };
}

export async function loadPeerTalkCatalogFromGun(
  gunService: WebGunService,
  authorId: string,
  talkId: string,
  opts: { timeoutMs?: number } = {},
): Promise<Talk | null> {
  const timeoutMs = opts.timeoutMs ?? 3000;
  const gun = gunService.getGun();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: Talk | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    gun
      .get(PEER_TALK_CATALOG_ROOT)
      .get(authorId)
      .get(talkId)
      .once((raw: unknown) => {
        clearTimeout(timer);
        const wire = raw as PeerTalkCatalogWire;
        if (wire?.version !== 1 || !wire.talkData) {
          finish(null);
          return;
        }
        const talk = normalizeTalkFromCatalog(wire);
        finish(talkLooksComplete(talk) ? talk : null);
      });
  });
}

/** P0-5: resolve talk from local/mesh paths only (no server GET /api/talks). */
export async function resolveTalkFromPeerMesh(
  gunService: WebGunService,
  talkId: string,
  authorId: string,
  getLocalTalk: (id: string) => Promise<Talk | null>,
  opts: { attempts?: number; gapMs?: number } = {},
): Promise<Talk | null> {
  const attempts = opts.attempts ?? 24;
  const gapMs = opts.gapMs ?? 250;
  for (let i = 0; i < attempts; i++) {
    const local = await getLocalTalk(talkId);
    if (talkLooksComplete(local)) return local;
    const catalog = await loadPeerTalkCatalogFromGun(gunService, authorId, talkId, { timeoutMs: 800 });
    if (talkLooksComplete(catalog)) return catalog;
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, gapMs));
    }
  }
  return null;
}
