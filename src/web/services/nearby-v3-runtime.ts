import type { NearbyCard } from '../../shared/nearby-v3-card';
import type { NearbyV3Config } from '../../shared/nearby-v3-config';
import type { SeaSigningPair } from '../../shared/p2p-runtime';
import type { PublicLocation } from '../../shared/public-location';
import { GunNearbyKnockChannel, NearbyKnockGate, NearbyV3MeshLink } from './nearby-v3-link';
import { NearbyV3Service, type NearbyV3Hub } from './nearby-v3-service';
import { PeerMeshService } from './peer-mesh-service';
import type { WebGunService } from './web-gun-service';
import type { ProtocolManifestController } from '../../shared/protocol-manifest-controller';
import type { NearbyListEntry } from '../../shared/nearby-v3-list';

/**
 * Nearby v3 on one device (§3.7): the personal list, its own mesh (room id `nearby-v3`, links only
 * to pinned peers), knocks in and out, and the hub client. Phase 2 runs it next to the v2 room so
 * gossip can be measured on phones; Talks still go through the v2 room until phase 3.
 *
 * Switched on with `?nearby_v3=1` or localStorage `iinpublic_nearby_v3 = "1"`.
 */
export const NEARBY_V3_ROOM_ID = 'nearby-v3';
export const NEARBY_V3_FLAG_KEY = 'iinpublic_nearby_v3';

export function isNearbyV3Enabled(): boolean {
  try {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('nearby_v3') === '1') return true;
    return typeof localStorage !== 'undefined' && localStorage.getItem(NEARBY_V3_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

export class FetchNearbyV3Hub implements NearbyV3Hub {
  constructor(private readonly apiBase: () => string) {}

  async heartbeat(card: NearbyCard): Promise<void> {
    const response = await fetch(`${this.apiBase()}/api/nearby/v3/card`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card }),
    });
    if (!response.ok) throw new Error(`hub refused the card (${response.status})`);
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

export type NearbyV3RuntimeDeps = {
  gunService: WebGunService;
  apiBase: () => string;
  userId: string;
  stageName: string;
  config: () => NearbyV3Config;
  position: () => { point: PublicLocation; traveler: boolean } | null;
  isBlocked: (userId: string) => boolean;
  isPaused?: () => boolean;
  protocolManifestController?: ProtocolManifestController;
  onChange?: (entries: readonly NearbyListEntry[]) => void;
};

export class NearbyV3Runtime {
  readonly mesh: PeerMeshService;
  readonly service: NearbyV3Service;
  readonly hub: FetchNearbyV3Hub;
  private stopKnocks: (() => void) | null = null;

  constructor(deps: NearbyV3RuntimeDeps) {
    this.hub = new FetchNearbyV3Hub(deps.apiBase);
    const knocks = new GunNearbyKnockChannel(deps.gunService.getGun() as never);
    const pair = () => deps.gunService.getStoredPair() as SeaSigningPair | null;
    this.mesh = new PeerMeshService(deps.gunService, {
      apiBase: deps.apiBase(),
      localUserId: deps.userId,
      localStageName: deps.stageName,
      personalRoster: true,
      maxNeighbors: 16,
      ...(deps.protocolManifestController ? { protocolManifestController: deps.protocolManifestController } : {}),
      isPeerExchangeAllowed: (userId) => !deps.isBlocked(userId),
      knockPeer: async (peer) => {
        const local = pair();
        if (!local?.pub || !local.priv || deps.isBlocked(peer.userId)) return;
        await knocks.send({ fromUserId: deps.userId, pair: local, toPub: peer.pub, card: this.service.card() });
      },
      onNearbyGossip: (fromUserId, fromPub, message) =>
        (deps.isBlocked(fromUserId) ? Promise.resolve(null) : this.service.handleMessage(fromPub, message)),
    });
    this.service = new NearbyV3Service({
      config: deps.config,
      identity: () => {
        const local = pair();
        return local?.pub && local.priv ? { userId: deps.userId, pair: local } : null;
      },
      position: () => {
        const position = deps.position();
        return position ? { ...position, scope: 'nearby' } : null;
      },
      hub: this.hub,
      link: new NearbyV3MeshLink(this.mesh),
      storage: typeof localStorage !== 'undefined' ? localStorage : null,
      ...(deps.isPaused ? { isPaused: deps.isPaused } : {}),
      onChange: (entries) => {
        // The mesh roster is the list itself; links still open only on demand.
        void this.mesh.joinRoom(NEARBY_V3_ROOM_ID, entries.map((entry) => ({
          userId: entry.card.userId,
          stageName: entry.card.userId,
          pub: entry.card.pub,
        })), { replace: true });
        deps.onChange?.(entries);
      },
    });
    const gate = new NearbyKnockGate({
      localPub: () => pair()?.pub ?? null,
      mesh: this.mesh,
      incomingLimit: () => deps.config().incomingConnections,
      isBlocked: deps.isBlocked,
    });
    const localPub = pair()?.pub;
    if (localPub) this.stopKnocks = knocks.listen(localPub, (knock) => { void gate.receive(knock); });
  }

  async start(): Promise<void> {
    await this.mesh.joinRoom(NEARBY_V3_ROOM_ID, [], { replace: true });
    this.service.start();
  }

  stop(): void {
    this.service.stop();
    this.stopKnocks?.();
    this.stopKnocks = null;
    this.mesh.leaveRoom();
  }

  /** The public point changed (moved, traveled, privacy setting). */
  refresh(): void {
    void this.service.refresh().catch(() => undefined);
  }

  diagnostics(): Record<string, unknown> {
    return {
      list: this.service.entries().map((entry) => ({ userId: entry.card.userId, distanceMeters: entry.key.distanceMeters })),
      card: this.service.card()?.issuedAt ?? null,
      stats: this.service.stats(),
      mesh: this.mesh.getDiagnostics(),
    };
  }
}
