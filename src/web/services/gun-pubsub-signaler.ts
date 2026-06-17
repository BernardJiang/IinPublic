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

/**
 * Pull interval for re-reading the signaling channel from the hub. Short so the WebRTC
 * handshake completes well inside the connect timeout on the first attempt (no reconnect
 * cycle). Roughly matches the previous HTTP signaling poll cadence.
 */
const SIGNAL_POLL_MS = 250;

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
 * gun.get('p2p-signal').get(sharedKey).get(nonce). The peer both subscribes live
 * (`.map().on()`) and, crucially, PULLS the channel on a short interval (`.map().once()`).
 *
 * Why pull, not just push: in this app the hub is used as a local-graph relay where reads
 * are effectively server-authoritative; browser↔browser live `.on()` push of a peer's write
 * does not reliably propagate (presence, talks, messages all use HTTP/WebRTC, not Gun
 * push). A periodic `.map().once()` issues a Gun GET that retrieves whatever the writer has
 * replicated to the hub — the Gun analog of the previous HTTP signaling poll — so offer/
 * answer/ICE frames reach the other peer and the WebRTC handshake completes.
 *
 * Frames MUST be stored as object nodes, not primitive JSON strings: Gun's `.map()` iterates
 * child *nodes*; every field here is a primitive string (no nested arrays/objects). Keying by
 * the unique nonce means frames never overwrite each other; handleFrame dedups by nonce so a
 * frame re-read on each poll tick is processed at most once.
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
    let liveRef: any = null;
    let timer: ReturnType<typeof setInterval> | undefined;

    const consume = (data: unknown, key: string): void => {
      if (stopped || !key || key.startsWith('_')) return;
      void this.handleFrame(data, localPub, onEnvelope);
    };

    void this.keyReady.then(() => {
      if (stopped) return;
      const channel = this.gun.get('p2p-signal').get(this.sharedKey!);
      // Fast path: live push subscription (fires for local writes and any pushed updates).
      liveRef = channel.map().on(consume);
      // Robust path: periodically PULL the channel from the hub with `.map().once()` (a Gun
      // GET). Unlike `.on()` push, this works even where browser↔browser push does not
      // propagate in this hub topology — the Gun analog of the previous HTTP poll. handleFrame
      // dedups by nonce, so re-reading the same frames each tick is idempotent.
      const drain = () => {
        if (stopped) return;
        channel.map().once(consume);
      };
      drain();
      timer = setInterval(drain, SIGNAL_POLL_MS);
    });

    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
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
