import {
  createPeerAckMessage,
  createPresenceRecord,
  createSignedRoomPresenceRecord,
  peerAckSigningPayload,
  type PeerAckMessage,
  type PresenceRecord,
} from '../../shared/p2p-presence';
import { createSignedP2PEnvelopeProof, type SeaSigningPair } from '../../shared/p2p-runtime';
import type { ActiveRoomScope } from '../../shared/active-exchange-room';

export type PresenceClientOptions = {
  apiBase: string;
  heartbeatMs?: number;
};

export class P2PPresenceClient {
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private lastRegistered: PresenceRecord | null = null;

  constructor(private readonly options: PresenceClientOptions) {}

  async register(input: {
    userId: string;
    pub: string;
    epub?: string;
    encryptedLocation?: string;
    capabilities?: string[];
    pair?: SeaSigningPair;
    roomScope?: ActiveRoomScope;
    enteredAt?: string;
  }): Promise<PresenceRecord> {
    const record = input.pair && input.roomScope
      ? await createSignedRoomPresenceRecord({
          userId: input.userId,
          pair: input.pair,
          roomScope: input.roomScope,
          ...(input.enteredAt ? { enteredAt: input.enteredAt } : {}),
          ...(input.epub ? { epub: input.epub } : {}),
          ...(input.capabilities ? { capabilities: input.capabilities } : {}),
        })
      : createPresenceRecord(input);
    const res = await fetch(`${this.options.apiBase}/api/presence/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
    if (!res.ok) {
      throw new Error(`presence register failed: ${res.status}`);
    }
    const body = (await res.json()) as { record?: PresenceRecord };
    this.lastRegistered = body.record ?? record;
    return this.lastRegistered;
  }

  async fetchNearby(excludeUserId?: string, limit = 50, roomScope?: ActiveRoomScope): Promise<PresenceRecord[]> {
    const params = new URLSearchParams();
    if (excludeUserId) params.set('excludeUserId', excludeUserId);
    if (limit) params.set('limit', String(limit));
    if (roomScope) {
      params.set('roomId', roomScope.roomId);
      params.set('roomToken', roomScope.roomToken);
      params.set('networkId', roomScope.networkId);
      params.set('protocolEpoch', String(roomScope.protocolEpoch));
      params.set('manifestSequence', String(roomScope.manifestSequence));
      params.set('manifestHash', roomScope.manifestHash);
      params.set('tokenExpiresAt', roomScope.tokenExpiresAt);
    }
    const res = await fetch(`${this.options.apiBase}/api/presence/nearby?${params.toString()}`, {
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { peers?: PresenceRecord[] };
    return body.peers ?? [];
  }

  async acknowledgePeer(input: {
    fromUserId: string;
    fromPub: string;
    toUserId: string;
    toPub: string;
    pair: SeaSigningPair;
  }): Promise<PeerAckMessage> {
    const proof = await createSignedP2PEnvelopeProof({
      pair: input.pair,
      payload: peerAckSigningPayload(input),
    });
    const ack = createPeerAckMessage({
      ...input,
      fromPeerId: proof.peerId,
      timestamp: proof.timestamp,
      payloadHash: proof.payloadHash,
      signature: proof.signature,
      nonce: proof.nonce,
    });
    const res = await fetch(`${this.options.apiBase}/api/presence/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ack),
    });
    if (!res.ok) {
      throw new Error(`presence ack failed: ${res.status}`);
    }
    return (await res.json()) as PeerAckMessage;
  }

  async startHeartbeat(input: {
    userId: string;
    pub: string;
    epub?: string;
    encryptedLocation?: string;
    pair?: SeaSigningPair;
    getRoomScope?: () => ActiveRoomScope | null;
    getRoomEnteredAt?: () => string | null;
  }): Promise<void> {
    this.stopHeartbeat();
    const beat = () => {
      const roomScope = input.getRoomScope?.();
      if (input.getRoomScope && !roomScope) return;
      const enteredAt = input.getRoomEnteredAt?.();
      void this.register({ ...input, ...(roomScope ? { roomScope } : {}), ...(enteredAt ? { enteredAt } : {}) }).catch((err) => {
        console.warn('presence heartbeat failed:', err);
      });
    };
    const initialScope = input.getRoomScope?.();
    if (input.getRoomScope && !initialScope) throw new Error('active room scope is required for presence');
    const enteredAt = input.getRoomEnteredAt?.();
    await this.register({ ...input, ...(initialScope ? { roomScope: initialScope } : {}), ...(enteredAt ? { enteredAt } : {}) });
    this.heartbeatTimer = setInterval(beat, this.options.heartbeatMs ?? 30_000);
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  getLastRegistered(): PresenceRecord | null {
    return this.lastRegistered;
  }
}
