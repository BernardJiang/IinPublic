import type { P2PSignalingEnvelope } from '../../shared/p2p-runtime';
import { BoundedNonceCache } from '../../shared/p2p-abuse-defense';
import type { PostSignalingBody, SignalingTransport } from './signaling-transport';
import { handleSignalingFrame } from './gun-pubsub-signaler';

type SignalingRelayResponse = {
  conversationId: string;
  frames?: unknown[];
};

export class HttpRelaySignaler implements SignalingTransport {
  private readonly nonces = new BoundedNonceCache();

  constructor(
    private readonly apiBase: string,
    private readonly pollMs = 600,
  ) {}

  async post(conversationId: string, body: PostSignalingBody): Promise<void> {
    const response = await fetch(
      `${this.apiBase}/api/p2p/signaling-relay/${encodeURIComponent(conversationId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      // Surface the server's rejection reason (e.g. 'invalid signature', 'duplicate
      // nonce', 'stale timestamp'): a bare status made recurring 400 loops undiagnosable.
      let reason = '';
      try {
        reason = String(((await response.json()) as { error?: string }).error || '');
      } catch { /* body not JSON */ }
      throw new Error(`HTTP signaling relay POST failed: ${response.status}${reason ? ` (${reason})` : ''}`);
    }
  }

  startPolling(
    conversationId: string,
    localPub: string,
    onEnvelope: (envelope: P2PSignalingEnvelope, payload: unknown) => void | Promise<void>,
  ): () => void {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (stopped) return;
      try {
        const params = new URLSearchParams({ recipientPub: localPub });
        const response = await fetch(
          `${this.apiBase}/api/p2p/signaling-relay/${encodeURIComponent(conversationId)}?${params.toString()}`,
          { cache: 'no-store' },
        );
        if (response.ok) {
          const body = (await response.json()) as SignalingRelayResponse;
          for (const frame of body.frames ?? []) {
            await handleSignalingFrame(frame, localPub, this.nonces, onEnvelope);
          }
        }
      } catch {
        // Signaling is best-effort; Gun pub/sub or the next HTTP poll may still deliver.
      } finally {
        if (!stopped) timer = setTimeout(poll, this.pollMs);
      }
    };

    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }
}
