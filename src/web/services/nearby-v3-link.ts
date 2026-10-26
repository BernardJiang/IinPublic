import {
  createNearbyKnock,
  nearbyKnockChannel,
  verifyNearbyKnock,
  NEARBY_KNOCK_LIFETIME_MS,
  type NearbyKnock,
} from '../../shared/nearby-v3-knock';
import type { NearbyCard } from '../../shared/nearby-v3-card';
import { nearbyLocalPostChannel, nearbyLocalReadChannels } from '../../shared/nearby-v3-local';
import type { SeaSigningPair } from '../../shared/p2p-runtime';
import type { NearbyV3Link } from '../../core/nearby-v3-service';

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
  /** `knockedAtMs`: when the knocker signed its knock (it is opening its side of the link then). */
  pinPeer(userId: string, pub: string, ttlMs: number, options?: { fromKnock?: boolean; knockedAtMs?: number }): void;
  isPinned(userId: string): boolean;
  /** False while the mesh is not in Nearby yet (a room switch in progress): nothing can be sent. */
  isPersonalReady?(): boolean;
};

const NEARBY_SEND_TIMEOUT_MS = 8_000;

export class NearbyV3MeshLink implements NearbyV3Link {
  constructor(private readonly mesh: NearbyV3MeshPort) {}

  ready(): boolean {
    return this.mesh.isPersonalReady?.() ?? true;
  }

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
    this.deps.mesh.pinPeer(knock.fromUserId, knock.fromPub, NEARBY_KNOCK_PIN_MS, { fromKnock: true, knockedAtMs: Date.parse(knock.issuedAt) });
    if (knock.card && knock.card.pub === knock.fromPub) this.deps.onCard?.(knock.card);
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

/**
 * The offline board (`nearby-v3-local.ts`): post my card while the hub is unreachable, and read the
 * cards posted in my cell and the eight around it. One node per poster (keyed by pub), so a repost
 * replaces the old card.
 */
export class GunNearbyLocalBoard {
  private watched = new Map<string, () => void>();

  constructor(private readonly gun: GunLike, private readonly onCard: (card: unknown) => void) {}

  post(card: NearbyCard): void {
    this.gun.get('p2p-signal').get(nearbyLocalPostChannel(card.point)).get(card.pub).put({ frame: JSON.stringify(card) });
  }

  /** Read the channels around `point`; reading moves with the point and stops for cells left. */
  watch(point: { latitude: number; longitude: number }): void {
    const wanted = new Set(nearbyLocalReadChannels(point));
    for (const [channel, stop] of this.watched) {
      if (!wanted.has(channel)) {
        stop();
        this.watched.delete(channel);
      }
    }
    for (const channel of wanted) {
      if (this.watched.has(channel)) continue;
      let stopped = false;
      const ref = this.gun.get('p2p-signal').get(channel).map();
      ref.on((data, key) => {
        if (stopped || !key || key.startsWith('_') || !data || typeof data !== 'object') return;
        const frame = (data as { frame?: unknown }).frame;
        if (typeof frame !== 'string') return;
        try {
          this.onCard(JSON.parse(frame));
        } catch {
          // Not a card.
        }
      });
      this.watched.set(channel, () => {
        stopped = true;
        try { ref.off?.(); } catch { /* ignore */ }
      });
    }
  }

  stop(): void {
    for (const stop of this.watched.values()) stop();
    this.watched.clear();
  }
}
