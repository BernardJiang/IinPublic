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
} from './p2p-signaling-client';

/** Derive a deterministic 64-hex channel key from two peer public keys. */
export async function deriveSignalingSharedKey(pubA: string, pubB: string): Promise<string> {
  const sorted = [pubA, pubB].sort();
  const encoder = new TextEncoder();
  const data = encoder.encode(sorted.join(':'));
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

/**
 * Gun pub/sub replacement for HTTP signaling polling.
 *
 * Writes each SDP/ICE frame as a Gun NODE (flat object) keyed by its nonce at
 * gun.get('p2p-signal').get(sharedKey).get(nonce), and the peer subscribes via
 * `.map().on()` — no HTTP roundtrips while the Gun WebSocket is already open for presence.
 * This mirrors the proven `GunMessageStore` record-per-id pattern
 * (`conversations/<id>/messages/<msgId>` object node + `.map().on()`), which replicates
 * peer→peer through the relay in production.
 *
 * Frames MUST be stored as object nodes, not primitive JSON strings: Gun's `.map()`
 * iterates child *nodes*, and primitive-string leaves do not replicate to a peer's map
 * subscription across the relay — so the WebRTC handshake never received the offer/answer
 * frames. Every field is a primitive string (no nested arrays/objects), which Gun stores as
 * a valid single node. Keying by the unique nonce means frames never overwrite each other.
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
  ) {
    this.keyReady = deriveSignalingSharedKey(localPub, otherPub).then(k => {
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
    this.gun.get('p2p-signal').get(this.sharedKey!).get(body.nonce).put(record);
  }

  startPolling(
    _conversationId: string,
    localPub: string,
    onEnvelope: (envelope: P2PSignalingEnvelope, payload: unknown) => void | Promise<void>,
  ): () => void {
    let stopped = false;
    let gunRef: any = null;

    void this.keyReady.then(() => {
      if (stopped) return;
      const channel = this.gun.get('p2p-signal').get(this.sharedKey!);
      gunRef = channel.map().on((data: unknown, nonceKey: string) => {
        if (stopped || !nonceKey || nonceKey.startsWith('_')) return;
        // `.map().on()` can fire before every property of a freshly-put node has
        // replicated; re-read the node once for a consolidated snapshot. Partial/echo
        // snapshots fail the field/verify guards in handleFrame and are retried on the
        // next emission (the nonce cache is only populated on a verified frame).
        channel.get(nonceKey).once((snapshot: unknown) => {
          if (stopped) return;
          void this.handleFrame(snapshot ?? data, localPub, onEnvelope);
        });
      });
    });

    return () => {
      stopped = true;
      try {
        gunRef?.off?.();
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
    if (!data || typeof data !== 'object') return;
    const frame = data as Record<string, unknown>;
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
    if (this.nonces.has(nonceKey)) return;

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
      nonceCache: this.nonces,
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
}
