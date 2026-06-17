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
 * Gun pub/sub replacement for HTTP signaling polling.
 *
 * Writes each SDP/ICE frame to gun.get('p2p-signal').get(sharedKey).get(nonce)
 * and subscribes via .map().on() — no HTTP roundtrips while the Gun WebSocket
 * is already open for chatroom presence.
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
    const frame = JSON.stringify({
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
    });
    // Store each frame at a unique nonce key so frames never overwrite each other.
    this.gun.get('p2p-signal').get(this.sharedKey!).get(body.nonce).put(frame);
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
      gunRef = this.gun
        .get('p2p-signal')
        .get(this.sharedKey!)
        .map()
        .on(async (data: unknown) => {
          if (stopped || !data || typeof data !== 'string') return;
          let frame: Record<string, unknown>;
          try {
            frame = JSON.parse(data) as Record<string, unknown>;
          } catch {
            return;
          }
          if (frame.senderPub === localPub) return;
          if (frame.recipientPub && frame.recipientPub !== localPub) return;
          const nonceKey = `${String(frame.senderPeerId)}:${String(frame.nonce)}`;
          if (this.nonces.has(nonceKey)) return;
          const envelope: P2PSignalingEnvelope = {
            version: 1,
            conversationId: String(frame.conversationId ?? ''),
            kind: frame.kind as P2PSignalingEnvelope['kind'],
            senderPeerId: String(frame.senderPeerId ?? ''),
            senderPub: String(frame.senderPub ?? ''),
            recipientPub: String(frame.recipientPub ?? ''),
            signalCiphertext: String(frame.signalCiphertext ?? ''),
            timestamp: String(frame.timestamp ?? ''),
            payloadHash: String(frame.payloadHash ?? ''),
            signature: String(frame.signature ?? ''),
            nonce: String(frame.nonce ?? ''),
            createdAt: String(frame.timestamp ?? ''),
            expiresAt: '',
          };
          const verification = await verifySignedP2PEnvelopeProof({
            proof: {
              peerId: envelope.senderPeerId,
              pub: envelope.senderPub,
              timestamp: envelope.timestamp,
              nonce: envelope.nonce,
              payloadHash: envelope.payloadHash,
              signature: envelope.signature,
            },
            payload: p2pSignalingSigningPayload({
              conversationId: envelope.conversationId,
              kind: envelope.kind,
              senderPub: envelope.senderPub,
              recipientPub: envelope.recipientPub,
              signalCiphertext: envelope.signalCiphertext,
            }),
            nonceCache: this.nonces,
          });
          if (!verification.ok) return;
          let decoded: unknown;
          try {
            decoded = decodeSignalingPayload(envelope.signalCiphertext);
          } catch {
            return;
          }
          await onEnvelope(envelope, decoded);
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
}
