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
