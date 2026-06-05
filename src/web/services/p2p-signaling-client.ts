import {
  p2pSignalingSigningPayload,
  verifySignedP2PEnvelopeProof,
  type P2PSignalingEnvelope,
  type P2PSignalingKind,
} from '../../shared/p2p-runtime';

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

/** Wrap signaling JSON so server validation accepts `SEA{` prefix. */
export function encodeSignalingPayload(payload: unknown): string {
  return `SEA${JSON.stringify(payload)}`;
}

export function decodeSignalingPayload(signalCiphertext: string): unknown {
  if (!signalCiphertext.startsWith('SEA')) {
    throw new Error('Invalid signaling ciphertext');
  }
  const json = signalCiphertext.startsWith('SEA{')
    ? signalCiphertext.slice(3)
    : signalCiphertext.slice(3);
  return JSON.parse(json);
}

export class P2PSignalingClient {
  private seenNonces = new Set<string>();

  constructor(
    private apiBase: string,
    private pollMs = 400,
  ) {}

  async post(conversationId: string, body: PostSignalingBody): Promise<void> {
    const res = await fetch(
      `${this.apiBase}/api/p2p/signaling/${encodeURIComponent(conversationId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      throw new Error(`signaling POST failed: ${res.status} ${await res.text()}`);
    }
  }

  async fetchEnvelopes(conversationId: string): Promise<P2PSignalingEnvelope[]> {
    const res = await fetch(
      `${this.apiBase}/api/p2p/signaling/${encodeURIComponent(conversationId)}`,
      { cache: 'no-store' },
    );
    if (!res.ok) {
      return [];
    }
    const data = (await res.json()) as { envelopes?: P2PSignalingEnvelope[] };
    return data.envelopes ?? [];
  }

  /** Poll until handler returns true (stop) or timeout. */
  startPolling(
    conversationId: string,
    localPub: string,
    onEnvelope: (envelope: P2PSignalingEnvelope, payload: unknown) => void | Promise<void>,
  ): () => void {
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        const envelopes = await this.fetchEnvelopes(conversationId);
        for (const envelope of envelopes) {
          if (envelope.recipientPub && envelope.recipientPub !== localPub) continue;
          if (envelope.senderPub === localPub) continue;
          const nonceKey = `${envelope.senderPeerId}:${envelope.nonce}`;
          if (this.seenNonces.has(nonceKey)) continue;
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
            nonceCache: this.seenNonces,
          });
          if (!verification.ok) continue;
          let payload: unknown;
          try {
            payload = decodeSignalingPayload(envelope.signalCiphertext);
          } catch {
            continue;
          }
          await onEnvelope(envelope, payload);
        }
      } catch {
        // ignore transient poll errors
      }
      if (!stopped) {
        setTimeout(tick, this.pollMs);
      }
    };
    void tick();
    return () => {
      stopped = true;
    };
  }
}
