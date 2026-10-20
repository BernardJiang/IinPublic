import type { NearbyCard } from '../../shared/nearby-v3-card';
import type { NearbyV3Config } from '../../shared/nearby-v3-config';
import type { SeaSigningPair } from '../../shared/p2p-runtime';
import type { PublicLocation } from '../../shared/public-location';
import type { NearbyListEntry } from '../../shared/nearby-v3-list';
import { GunNearbyKnockChannel, GunNearbyLocalBoard, NearbyKnockGate, NearbyV3MeshLink, type NearbyV3MeshPort } from './nearby-v3-link';
import { NearbyV3Service, type NearbyV3Hub } from './nearby-v3-service';
import type { WebGunService } from './web-gun-service';

/**
 * Nearby on one device (§3.7): the personal list, knocks in and out, and the hub client. The app's
 * own mesh carries gossip and Talks; while Nearby is active it runs in personal mode with the list
 * as its roster (`NEARBY_V3_ROOM_ID`).
 */
export class FetchNearbyV3Hub implements NearbyV3Hub {
  constructor(private readonly apiBase: () => string) {}

  async heartbeat(card: NearbyCard): Promise<void> {
    const response = await fetch(`${this.apiBase()}/api/nearby/v3/card`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: unknown } | null;
      throw new Error(`hub refused the card (${response.status}${body?.error ? `: ${String(body.error)}` : ''})`);
    }
  }

  async introductions(input: { point: { latitude: number; longitude: number }; scope: string; excludePub: string }): Promise<NearbyCard[]> {
    const response = await fetch(`${this.apiBase()}/api/nearby/v3/introductions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(`introductions failed (${response.status})`);
    const body = await response.json() as { cards?: unknown };
    return Array.isArray(body.cards) ? body.cards as NearbyCard[] : [];
  }

  async stats(bounds?: { west: number; south: number; east: number; north: number }): Promise<{
    online: number;
    heat: Array<{ latitude: number; longitude: number; count: number }>;
  }> {
    const query = bounds ? `?${new URLSearchParams(Object.entries(bounds).map(([key, value]) => [key, String(value)]))}` : '';
    const response = await fetch(`${this.apiBase()}/api/nearby/v3/stats${query}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`stats failed (${response.status})`);
    return await response.json() as { online: number; heat: Array<{ latitude: number; longitude: number; count: number }> };
  }
}

export type NearbyV3RosterMember = { userId: string; stageName: string; pub: string; isTraveler: boolean };

export type NearbyV3RuntimeDeps = {
  gunService: WebGunService;
  mesh: NearbyV3MeshPort;
  apiBase: () => string;
  userId: string;
  stageName: () => string;
  config: () => NearbyV3Config;
  position: () => { point: PublicLocation; traveler: boolean } | null;
  isPaused?: () => boolean;
  /** The list changed: it is the Nearby roster. */
  onRoster: (members: NearbyV3RosterMember[], entries: readonly NearbyListEntry[]) => void;
};

export class NearbyV3Runtime {
  readonly service: NearbyV3Service;
  readonly hub: FetchNearbyV3Hub;
  private readonly knocks: GunNearbyKnockChannel;
  /** Offline Nearby: cards posted by phones that cannot reach the hub, read around my point. */
  private readonly board: GunNearbyLocalBoard;
  private readonly gate: NearbyKnockGate;
  private stopKnocks: (() => void) | null = null;

  constructor(private readonly deps: NearbyV3RuntimeDeps) {
    this.hub = new FetchNearbyV3Hub(deps.apiBase);
    this.knocks = new GunNearbyKnockChannel(deps.gunService.getGun() as never);
    this.board = new GunNearbyLocalBoard(deps.gunService.getGun() as never, (card) => {
      void this.service.localCard(card).catch(() => undefined);
    });
    this.service = new NearbyV3Service({
      config: deps.config,
      identity: () => {
        const local = this.pair();
        return local?.pub && local.priv ? { userId: deps.userId, pair: local, stageName: deps.stageName() } : null;
      },
      position: () => {
        const position = deps.position();
        return position ? { ...position, scope: 'nearby' } : null;
      },
      hub: this.hub,
      link: new NearbyV3MeshLink(deps.mesh),
      localBoard: this.board,
      storage: typeof localStorage !== 'undefined' ? localStorage : null,
      ...(deps.isPaused ? { isPaused: deps.isPaused } : {}),
      onChange: (entries) => {
        deps.onRoster(entries.map((entry) => ({
          userId: entry.card.userId,
          stageName: entry.card.stageName || entry.card.userId,
          pub: entry.card.pub,
          isTraveler: entry.card.traveler,
        })), entries);
      },
    });
    // A block stops Talks (filtered on both sides), never card gossip or knocks: if a blocked
    // person's swaps failed, the blocker would vanish from their list at the moment of the block
    // and give himself away (Settings → Credit: Eve can guess, not prove).
    this.gate = new NearbyKnockGate({
      localPub: () => this.pair()?.pub ?? null,
      mesh: deps.mesh,
      incomingLimit: () => deps.config().incomingConnections,
      onCard: (card) => { void this.service.offerCard(card).catch(() => undefined); },
    });
  }

  start(): void {
    const localPub = this.pair()?.pub;
    if (localPub && !this.stopKnocks) this.stopKnocks = this.knocks.listen(localPub, (knock) => { void this.gate.receive(knock); });
    this.service.start();
  }

  stop(): void {
    this.service.stop();
    this.board.stop();
    this.stopKnocks?.();
    this.stopKnocks = null;
  }

  /** The public point changed (moved, traveled, privacy setting). */
  refresh(): void {
    void this.service.refresh().catch(() => undefined);
  }

  /** Mesh hook: ask this peer to open their side of our link. */
  async knock(peer: { userId: string; pub: string }): Promise<void> {
    const local = this.pair();
    if (!local?.pub || !local.priv) return;
    await this.knocks.send({ fromUserId: this.deps.userId, pair: local, toPub: peer.pub, card: this.service.card() });
  }

  /** Mesh hook: a gossip message from a direct neighbor. */
  handleGossip(_fromUserId: string, fromPub: string, message: Record<string, unknown>): Promise<unknown> {
    return this.service.handleMessage(fromPub, message);
  }

  /** Mesh hook: this person's link could not be opened; a swap decides whether they left. */
  unreachable(pub: string): void {
    void this.service.probe(pub).catch(() => undefined);
  }

  diagnostics(): Record<string, unknown> {
    return {
      list: this.service.entries().map((entry) => ({ userId: entry.card.userId, distanceMeters: entry.key.distanceMeters })),
      card: this.service.card()?.issuedAt ?? null,
      stats: this.service.stats(),
      hubReachable: this.service.isHubReachable(),
    };
  }

  private pair(): SeaSigningPair | null {
    return this.deps.gunService.getStoredPair() as SeaSigningPair | null;
  }
}
