import {
  createNearbyKnock,
  nearbyKnockChannel,
  verifyNearbyKnock,
  NEARBY_KNOCK_LIFETIME_MS,
  type NearbyKnock,
} from '../../shared/nearby-v3-knock';
import type { NearbyCard } from '../../shared/nearby-v3-card';
import type { SeaSigningPair } from '../../shared/p2p-runtime';
import type { NearbyV3Link } from './nearby-v3-service';

/**
 * The Nearby v3 peer link (§3.7 "Implementation plan", phase 2): gossip rides the mesh DataChannel,
 * and a signed knock on the other person's own signalling channel asks them to open their side of
 * the pair's link, since they may not have us on their list.
 */

/** What the link needs from PeerMeshService. */
export type NearbyV3MeshPort = {
  requestNearbyGossip(
    peer: { userId: string; pub: string },
    message: Record<string, unknown>,
    timeoutMs: number,
    options?: { expectReply?: boolean },
  ): Promise<Record<string, unknown> | null>;
  pinPeer(userId: string, pub: string, ttlMs: number, options?: { fromKnock?: boolean }): void;
  isPinned(userId: string): boolean;
};

const NEARBY_SEND_TIMEOUT_MS = 8_000;

export class NearbyV3MeshLink implements NearbyV3Link {
  constructor(private readonly mesh: NearbyV3MeshPort) {}

  async request(to: NearbyCard, message: unknown, timeoutMs: number): Promise<unknown> {
    return this.mesh.requestNearbyGossip({ userId: to.userId, pub: to.pub }, message as Record<string, unknown>, timeoutMs);
  }

  async send(to: NearbyCard, message: unknown): Promise<void> {
    await this.mesh.requestNearbyGossip({ userId: to.userId, pub: to.pub }, message as Record<string, unknown>, NEARBY_SEND_TIMEOUT_MS, { expectReply: false });
  }
}

/** How long a knocker's link stays open on the receiving side without further reason. */
export const NEARBY_KNOCK_PIN_MS = 60_000;

/**
 * The receiving side of knocks: verifies each one, skips blocked people and anyone past the incoming
 * limit, and opens (pins) the link for the rest. Past the limit the knocker's request times out and
 * they try someone else; nothing tells them why.
 */
export class NearbyKnockGate {
  private readonly accepted = new Map<string, number>();
  private readonly seenNonces = new Set<string>();

  constructor(private readonly deps: {
    localPub: () => string | null;
    mesh: Pick<NearbyV3MeshPort, 'pinPeer' | 'isPinned'>;
    incomingLimit: () => number;
    isBlocked?: (userId: string) => boolean;
    onCard?: (card: NearbyCard) => void;
    now?: () => number;
  }) {}

  async receive(value: unknown): Promise<'accepted' | 'refreshed' | 'rejected' | 'busy'> {
    const localPub = this.deps.localPub();
    if (!localPub) return 'rejected';
    const nowMs = this.deps.now?.() ?? Date.now();
    const verification = await verifyNearbyKnock(value, { localPub, now: new Date(nowMs) });
    if (!verification.ok) return 'rejected';
    const knock = verification.knock;
    const nonce = `${knock.fromPub}:${knock.proof.nonce}`;
    if (this.seenNonces.has(nonce)) return 'rejected';
    this.seenNonces.add(nonce);
    if (this.seenNonces.size > 2_048) this.seenNonces.delete(this.seenNonces.values().next().value as string);
    if (this.deps.isBlocked?.(knock.fromUserId)) return 'rejected';
    for (const [userId, until] of this.accepted) if (until <= nowMs) this.accepted.delete(userId);
    const known = this.accepted.has(knock.fromUserId) || this.deps.mesh.isPinned(knock.fromUserId);
    if (!known && this.accepted.size >= this.deps.incomingLimit()) return 'busy';
    this.accepted.set(knock.fromUserId, nowMs + NEARBY_KNOCK_PIN_MS);
    this.deps.mesh.pinPeer(knock.fromUserId, knock.fromPub, NEARBY_KNOCK_PIN_MS, { fromKnock: true });
    if (knock.card) this.deps.onCard?.(knock.card);
    return known ? 'refreshed' : 'accepted';
  }
}

type GunLike = {
  get(key: string): GunLike;
  put(value: unknown): unknown;
  map(): GunLike;
  on(callback: (data: unknown, key: string) => void): unknown;
  off?(): void;
};

/**
 * Knocks travel like signalling frames: a one-field node under `p2p-signal/<channel>/<nonce>`, a path
 * the server keeps in memory only. The channel is derived from the receiver's public key.
 */
export class GunNearbyKnockChannel {
  constructor(private readonly gun: GunLike) {}

  async send(input: { fromUserId: string; pair: SeaSigningPair; toPub: string; card: NearbyCard | null }): Promise<NearbyKnock> {
    const knock = await createNearbyKnock(input);
    this.gun.get('p2p-signal').get(nearbyKnockChannel(input.toPub)).get(knock.proof.nonce).put({ frame: JSON.stringify(knock) });
    return knock;
  }

  listen(localPub: string, onKnock: (knock: unknown) => void): () => void {
    let stopped = false;
    const startedAt = Date.now();
    const ref = this.gun.get('p2p-signal').get(nearbyKnockChannel(localPub)).map();
    ref.on((data, key) => {
      if (stopped || !key || key.startsWith('_') || !data || typeof data !== 'object') return;
      const frame = (data as { frame?: unknown }).frame;
      if (typeof frame !== 'string') return;
      try {
        const knock = JSON.parse(frame) as { issuedAt?: unknown };
        // Old knocks replay when the subscription opens; only recent ones matter.
        if (typeof knock.issuedAt === 'string' && Date.parse(knock.issuedAt) < startedAt - NEARBY_KNOCK_LIFETIME_MS) return;
        onKnock(knock);
      } catch {
        // Not a knock.
      }
    });
    return () => {
      stopped = true;
      try { ref.off?.(); } catch { /* ignore */ }
    };
  }
}
