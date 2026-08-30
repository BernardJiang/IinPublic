import {
  verifySignedP2PEnvelopeProof,
  p2pSignalingSigningPayload,
  type P2PSignalingEnvelope,
} from '../../shared/p2p-runtime';
import { BoundedNonceCache } from '../../shared/p2p-abuse-defense';
import {
  decodeSignalingPayload,
  type PostSignalingBody,
  type SignalingTransport,
} from './signaling-transport';

/**
 * Derive a deterministic 64-hex channel key from two peer public keys and a channel id.
 *
 * The channel id (the session's conversationId) is essential: the same pair of users runs
 * BOTH a mesh session (`mesh:<room>:<sortedUsers>`) and a DM conversation session
 * (`conv_<sortedUsers>_<talkId>`) concurrently. Keying on the pubs alone would put both on one
 * `p2p-signal` channel, cross-feeding mesh SDP into the DM RTCPeerConnection (and vice versa)
 * and breaking the handshake. Both peers derive the same conversationId, so the key stays
 * symmetric.
 */
export async function deriveSignalingSharedKey(
  pubA: string,
  pubB: string,
  channelId = '',
): Promise<string> {
  const sorted = [pubA, pubB].sort();
  const encoder = new TextEncoder();
  const data = encoder.encode(`${sorted.join(':')}|${channelId}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Flat (single-level, all-primitive) shape stored as a Gun node per signaling frame. */
type SignalFrameRecord = {
  conversationId: string;
  kind: PostSignalingBody['kind'];
  senderPeerId: string;
  senderPub: string;
  recipientPub: string;
  signalCiphertext: string;
  timestamp: string;
  payloadHash: string;
  signature: string;
  nonce: string;
};

export async function handleSignalingFrame(
  data: unknown,
  localPub: string,
  nonces: BoundedNonceCache,
  onEnvelope: (envelope: P2PSignalingEnvelope, payload: unknown) => void | Promise<void>,
): Promise<void> {
  if (!data || typeof data !== 'object') return;
  const wire = data as Record<string, unknown>;
  let frame = wire;
  if (typeof wire.frame === 'string') {
    try {
      const parsed = JSON.parse(wire.frame) as unknown;
      if (!parsed || typeof parsed !== 'object') return;
      frame = parsed as Record<string, unknown>;
    } catch {
      return;
    }
  }
  const senderPub = String(frame.senderPub ?? '');
  const senderPeerId = String(frame.senderPeerId ?? '');
  const signature = String(frame.signature ?? '');
  const payloadHash = String(frame.payloadHash ?? '');
  const nonce = String(frame.nonce ?? '');
  const timestamp = String(frame.timestamp ?? '');
  const signalCiphertext = String(frame.signalCiphertext ?? '');
  const kind = frame.kind as P2PSignalingEnvelope['kind'];
  const conversationId = String(frame.conversationId ?? '');

  // Skip our own echoed frames and any not addressed to us.
  if (!senderPub || senderPub === localPub) return;
  const recipientPub = String(frame.recipientPub ?? '');
  if (recipientPub && recipientPub !== localPub) return;
  // Skip incompletely-synced nodes (a later emission fires once all fields replicate).
  if (!senderPeerId || !signature || !payloadHash || !nonce || !timestamp || !signalCiphertext || !kind) {
    return;
  }
  const nonceKey = `${senderPeerId}:${nonce}`;
  if (nonces.has(nonceKey)) return;

  const envelope: P2PSignalingEnvelope = {
    version: 1,
    conversationId,
    kind,
    senderPeerId,
    senderPub,
    recipientPub,
    signalCiphertext,
    timestamp,
    payloadHash,
    signature,
    nonce,
    createdAt: timestamp,
    expiresAt: '',
  };
  const verification = await verifySignedP2PEnvelopeProof({
    proof: { peerId: senderPeerId, pub: senderPub, timestamp, nonce, payloadHash, signature },
    payload: p2pSignalingSigningPayload({
      conversationId,
      kind,
      senderPub,
      recipientPub,
      signalCiphertext,
    }),
    nonceCache: nonces,
  });
  if (!verification.ok) return;
  let decoded: unknown;
  try {
    decoded = decodeSignalingPayload(signalCiphertext);
  } catch {
    return;
  }
  await onEnvelope(envelope, decoded);
}

/**
 * Gun pub/sub replacement for HTTP signaling polling.
 *
 * Writes each SDP/ICE frame as a one-field Gun NODE keyed by its nonce at
 * gun.get('p2p-signal').get(sharedKey).get(nonce), and the peer subscribes via `.map().on()`.
 * Pure peer↔peer: frames travel over the open Gun connection with no HTTP signaling endpoint
 * and no server in the data path. `.map().on()` fires both for frames already present when the
 * subscription opens (so an offer written before the answerer subscribes is still delivered)
 * and for every subsequent frame.
 *
 * Frames MUST be stored as object nodes, not primitive JSON strings: Gun's `.map()` iterates
 * child *nodes*. The signed frame itself is JSON inside the node's single `frame` field. This
 * avoids expanding every SDP/ICE frame into ten Radix entries on low-memory embedded nodes.
 * Keying by the unique nonce means frames never overwrite each other; handleFrame dedups by nonce.
 *
 * The Gun path is in-memory only on the server node (shouldSkipServerGunPersist
 * returns true for 'p2p-signal' paths), so frames never land on radata.
 */
export class GunPubSubSignaler implements SignalingTransport {
  private sharedKey: string | null = null;
  private readonly keyReady: Promise<void>;
  private readonly nonces = new BoundedNonceCache();

  constructor(
    private readonly gun: any,
    localPub: string,
    otherPub: string,
    channelId = '',
  ) {
    this.keyReady = deriveSignalingSharedKey(localPub, otherPub, channelId).then(k => {
      this.sharedKey = k;
    });
  }

  async post(conversationId: string, body: PostSignalingBody): Promise<void> {
    await this.keyReady;
    // Store each frame as a flat Gun node keyed by its unique nonce (mirrors the proven
    // GunMessageStore record-per-id write), so frames never overwrite each other and the
    // peer's `.map()` iterates them as child nodes.
    const record: SignalFrameRecord = {
      conversationId,
      kind: body.kind,
      senderPeerId: body.senderPeerId,
      senderPub: body.senderPub,
      recipientPub: body.recipientPub,
      signalCiphertext: body.signalCiphertext,
      timestamp: body.timestamp,
      payloadHash: body.payloadHash,
      signature: body.signature,
      nonce: body.nonce,
    };
    this.gun
      .get('p2p-signal')
      .get(this.sharedKey!)
      .get(body.nonce)
      .put({ frame: JSON.stringify(record) });
  }

  startPolling(
    _conversationId: string,
    localPub: string,
    onEnvelope: (envelope: P2PSignalingEnvelope, payload: unknown) => void | Promise<void>,
  ): () => void {
    let stopped = false;
    let liveRef: any = null;

    void this.keyReady.then(() => {
      if (stopped) return;
      // Pure peer↔peer push: subscribe to the shared channel and let Gun deliver each frame.
      // `.map().on()` fires for children already present when the subscription opens (e.g. an
      // offer written before the answerer subscribed) and for every subsequent frame — no
      // polling and no server in the data path. handleFrame dedups by nonce.
      liveRef = this.gun
        .get('p2p-signal')
        .get(this.sharedKey!)
        .map()
        .on((data: unknown, key: string) => {
          if (stopped || !key || key.startsWith('_')) return;
          void this.handleFrame(data, localPub, onEnvelope);
        });
    });

    return () => {
      stopped = true;
      try {
        liveRef?.off?.();
      } catch {
        // ignore
      }
    };
  }

  private async handleFrame(
    data: unknown,
    localPub: string,
    onEnvelope: (envelope: P2PSignalingEnvelope, payload: unknown) => void | Promise<void>,
  ): Promise<void> {
    await handleSignalingFrame(data, localPub, this.nonces, onEnvelope);
  }
}
