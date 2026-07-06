import type { P2PSignalingEnvelope, P2PSignalingKind } from '../../shared/p2p-runtime';

export type PostSignalingBody = {
  kind: P2PSignalingKind;
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
 * Common shape for delivering SDP/ICE signaling frames between two peers.
 * GunPubSubSignaler is the only production implementation; the interface keeps
 * the WebRTC session independent from the underlying signaling bus.
 */
export interface SignalingTransport {
  post(conversationId: string, body: PostSignalingBody): Promise<void>;
  startPolling(
    conversationId: string,
    localPub: string,
    onEnvelope: (envelope: P2PSignalingEnvelope, payload: unknown) => void | Promise<void>,
  ): () => void;
}

export class CompositeSignalingTransport implements SignalingTransport {
  private readonly transports: SignalingTransport[];
  private readonly delivered = new Set<string>();

  constructor(transports: SignalingTransport[]) {
    this.transports = transports;
  }

  async post(conversationId: string, body: PostSignalingBody): Promise<void> {
    const results = await Promise.allSettled(
      this.transports.map((transport) => transport.post(conversationId, body)),
    );
    if (results.some((result) => result.status === 'fulfilled')) return;
    const first = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    throw first?.reason instanceof Error ? first.reason : new Error('all signaling transports failed');
  }

  startPolling(
    conversationId: string,
    localPub: string,
    onEnvelope: (envelope: P2PSignalingEnvelope, payload: unknown) => void | Promise<void>,
  ): () => void {
    const stops = this.transports.map((transport) =>
      transport.startPolling(conversationId, localPub, async (envelope, payload) => {
        const key = `${envelope.senderPeerId}:${envelope.nonce}`;
        if (this.delivered.has(key)) return;
        this.delivered.add(key);
        await onEnvelope(envelope, payload);
      }),
    );
    return () => {
      for (const stop of stops) stop();
    };
  }
}

/** Wrap signaling JSON so validation preserves the SEA ciphertext envelope convention. */
export function encodeSignalingPayload(payload: unknown): string {
  return `SEA${JSON.stringify(payload)}`;
}

export function decodeSignalingPayload(signalCiphertext: string): unknown {
  if (!signalCiphertext.startsWith('SEA')) {
    throw new Error('Invalid signaling ciphertext');
  }
  const json = signalCiphertext.slice(3);
  return JSON.parse(json);
}
