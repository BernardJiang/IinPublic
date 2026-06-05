import {
  p2pRelaySigningPayload,
  verifySignedP2PEnvelopeProof,
  type DirectP2PMessageEnvelope,
} from '../../shared/p2p-runtime';

export class P2PConversationRelayClient {
  private seenNonces = new Set<string>();

  constructor(
    private apiBase: string,
    private pollMs = 400,
  ) {}

  async post(conversationId: string, envelope: DirectP2PMessageEnvelope): Promise<void> {
    const res = await fetch(
      `${this.apiBase}/api/p2p/conversation-relay/${encodeURIComponent(conversationId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope),
      },
    );
    if (!res.ok) {
      throw new Error(`conversation-relay POST failed: ${res.status} ${await res.text()}`);
    }
  }

  async fetchEnvelopes(
    conversationId: string,
    recipientPub: string,
  ): Promise<DirectP2PMessageEnvelope[]> {
    const url = new URL(
      `${this.apiBase}/api/p2p/conversation-relay/${encodeURIComponent(conversationId)}`,
    );
    url.searchParams.set('recipientPub', recipientPub);
    const res = await fetch(url.toString(), { cache: 'no-store' });
    if (!res.ok) return [];
    const data = (await res.json()) as { envelopes?: DirectP2PMessageEnvelope[] };
    return data.envelopes ?? [];
  }

  startPolling(
    conversationId: string,
    localPub: string,
    onEnvelope: (envelope: DirectP2PMessageEnvelope) => void | Promise<void>,
  ): () => void {
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        const envelopes = await this.fetchEnvelopes(conversationId, localPub);
        for (const envelope of envelopes) {
          if (envelope.recipientPub && envelope.recipientPub !== localPub) continue;
          if (envelope.senderPub === localPub) continue;
          const nonceKey = `${envelope.peerId}:${envelope.nonce}`;
          if (this.seenNonces.has(nonceKey)) continue;
          const verification = await verifySignedP2PEnvelopeProof({
            proof: {
              peerId: envelope.peerId,
              pub: envelope.senderPub,
              timestamp: envelope.timestamp,
              nonce: envelope.nonce,
              payloadHash: envelope.payloadHash,
              signature: envelope.signature,
            },
            payload: p2pRelaySigningPayload({
              conversationId: envelope.conversationId,
              messageId: envelope.messageId,
              senderPub: envelope.senderPub,
              ...(envelope.recipientPub ? { recipientPub: envelope.recipientPub } : {}),
              bodyCiphertext: envelope.bodyCiphertext || '',
            }),
            nonceCache: this.seenNonces,
          });
          if (!verification.ok) continue;
          await onEnvelope(envelope);
        }
      } catch {
        // ignore transient poll errors
      }
      if (!stopped) setTimeout(tick, this.pollMs);
    };
    void tick();
    return () => {
      stopped = true;
    };
  }
}
