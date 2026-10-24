import type { NearbyCard, NearbyCardScope, NearbyCountIdentity } from '../../shared/nearby-v3-card';
import type { NearbyV3Config } from '../../shared/nearby-v3-config';
import type { NearbyAttestorKey } from '../../shared/nearby-v3-attestation';
import type { SeaSigningPair } from '../../shared/p2p-runtime';
import { isPublicLocation, type PublicLocation } from '../../shared/public-location';
import type { MapPresenceDot } from '../../shared/map-dots';
import type { NearbyListEntry } from '../../shared/nearby-v3-list';
import { nearbyKnockChannel, type NearbyKnock } from '../../shared/nearby-v3-knock';
import { GunNearbyKnockChannel, GunNearbyLocalBoard, NearbyKnockGate, NearbyV3MeshLink, type NearbyV3MeshPort } from './nearby-v3-link';
import {
  NearbyHubPresenceConflictError,
  NearbyV3Service,
  type NearbyHubHeartbeat,
  type NearbyIntroductionsAnswer,
  type NearbyV3Hub,
} from './nearby-v3-service';
import type { WebGunService } from './web-gun-service';

/**
 * Nearby on one device (§3.7): the personal list, knocks in and out, and the hub client. The app's
 * own mesh carries gossip and Talks; while Nearby is active it runs in personal mode with the list
 * as its roster (`NEARBY_V3_ROOM_ID`).
 */
/**
 * Knocks through the hub's mailbox (`/api/nearby/v3/knocks`). A phone reaches the hub over HTTP
 * only, so the Gun channel carries knocks between phones on one LAN, and this carries them
 * everywhere else. The receiver long-polls its own channel.
 */
/** How often the runtime checks whether my scope or point changed. */
const POSITION_WATCH_MS = 1_000;

export class HttpNearbyKnockChannel {
  constructor(private readonly apiBase: () => string) {}

  async send(knock: NearbyKnock): Promise<void> {
    await fetch(`${this.apiBase()}/api/nearby/v3/knocks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ knock }),
    });
  }

  listen(localPub: string, onKnock: (knock: unknown) => void): () => void {
    let stopped = false;
    let controller: AbortController | null = null;
    let cursor = 0;
    const channel = nearbyKnockChannel(localPub);
    const loop = async () => {
      while (!stopped) {
        controller = new AbortController();
        try {
          const response = await fetch(
            `${this.apiBase()}/api/nearby/v3/knocks/${channel}?after=${cursor}&waitMs=20000`,
            { cache: 'no-store', signal: controller.signal },
          );
          if (!response.ok) throw new Error(`knocks failed (${response.status})`);
          const body = await response.json() as { knocks?: unknown[]; cursor?: unknown };
          if (Number.isFinite(Number(body.cursor))) cursor = Number(body.cursor);
          for (const knock of body.knocks ?? []) onKnock(knock);
        } catch {
          // Hub unreachable (or stopped): try again shortly; offline, the Gun channel still works.
          if (!stopped) await new Promise((resolve) => setTimeout(resolve, 5_000));
        }
      }
    };
    void loop();
    return () => {
      stopped = true;
      controller?.abort();
    };
  }
}

export class FetchNearbyV3Hub implements NearbyV3Hub {
  constructor(
    private readonly apiBase: () => string,
    private readonly onCounts?: (counts: { nearby: number; online: number; scope: NearbyCardScope }) => void,
    /** My page size `C`: the hub counts and pages my audience with it (OPEN-86). */
    private readonly capacity?: () => number,
  ) {}

  async heartbeat(card: NearbyCard): Promise<NearbyHubHeartbeat> {
    const response = await fetch(`${this.apiBase()}/api/nearby/v3/card`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card, ...(this.capacity ? { capacity: this.capacity() } : {}) }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as {
        error?: unknown;
        acceptedRevision?: unknown;
        acceptedScope?: unknown;
        acceptedPoint?: unknown;
      } | null;
      const acceptedPoint = body?.acceptedPoint;
      if (response.status === 409
        && Number.isSafeInteger(body?.acceptedRevision)
        && (body?.acceptedScope === 'nearby'
          || (typeof body?.acceptedScope === 'string' && body.acceptedScope.startsWith('place:')))
        && isPublicLocation(acceptedPoint)) {
        throw new NearbyHubPresenceConflictError(
          Number(body.acceptedRevision),
          body.acceptedScope as NearbyCardScope,
          acceptedPoint,
          typeof body.error === 'string' ? body.error : undefined,
        );
      }
      throw new Error(`hub refused the card (${response.status}${body?.error ? `: ${String(body.error)}` : ''})`);
    }
    const answer = await response.json().catch(() => ({})) as NearbyHubHeartbeat;
    const nearby = Number(answer.nearby);
    const online = Number(answer.online);
    if (Number.isFinite(nearby) && nearby >= 0 && Number.isFinite(online) && online >= 0) {
      this.onCounts?.({ nearby: Math.floor(nearby), online: Math.floor(online), scope: card.scope });
    }
    return answer;
  }

  async leave(card: NearbyCard): Promise<void> {
    const response = await fetch(`${this.apiBase()}/api/nearby/v3/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card }),
      keepalive: true,
    });
    if (!response.ok && response.status !== 409) throw new Error(`leave failed (${response.status})`);
  }

  async introductions(input: Parameters<NearbyV3Hub['introductions']>[0]): Promise<NearbyIntroductionsAnswer> {
    const response = await fetch(`${this.apiBase()}/api/nearby/v3/introductions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, ...(this.capacity ? { capacity: this.capacity() } : {}) }),
    });
    if (!response.ok) throw new Error(`introductions failed (${response.status})`);
    const body = await response.json() as { cards?: unknown; audience?: unknown };
    return {
      cards: Array.isArray(body.cards) ? body.cards as NearbyCard[] : [],
      ...(body.audience !== undefined ? { audience: body.audience } : {}),
    };
  }

  /** Which of these users are online now (§3.7 "Contacts online"), 500 ids per hub call. */
  async online(userIds: readonly string[]): Promise<Set<string>> {
    const online = new Set<string>();
    for (let start = 0; start < userIds.length; start += 500) {
      const response = await fetch(`${this.apiBase()}/api/nearby/v3/online`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: userIds.slice(start, start + 500) }),
      });
      if (!response.ok) throw new Error(`online query failed (${response.status})`);
      const body = await response.json() as { online?: unknown };
      for (const id of Array.isArray(body.online) ? body.online : []) if (typeof id === 'string') online.add(id);
    }
    return online;
  }

  async stats(bounds?: { west: number; south: number; east: number; north: number }): Promise<{
    online: number;
    heat: Array<{ latitude: number; longitude: number; count: number }>;
    /** Live Nearby identities in a city-sized view: public points only (OPEN-86 E3). */
    dots?: MapPresenceDot[];
    countRevision?: number;
  }> {
    const query = bounds ? `?${new URLSearchParams(Object.entries(bounds).map(([key, value]) => [key, String(value)]))}` : '';
    const response = await fetch(`${this.apiBase()}/api/nearby/v3/stats${query}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`stats failed (${response.status})`);
    const body = await response.json() as {
      online: number;
      heat: Array<{ latitude: number; longitude: number; count: number }>;
      dots?: unknown;
      countRevision?: number;
    };
    // A dot is drawn only from a valid public grid point; anything else from the wire is dropped.
    const dots = Array.isArray(body.dots)
      ? body.dots.filter((dot): dot is MapPresenceDot => isPublicLocation(dot)
        && typeof (dot as MapPresenceDot).userId === 'string' && typeof (dot as MapPresenceDot).traveler === 'boolean')
        .map((dot) => ({
          latitude: dot.latitude, longitude: dot.longitude, precisionMeters: dot.precisionMeters, userId: dot.userId, traveler: dot.traveler,
        }))
      : undefined;
    const { dots: _wire, ...rest } = body;
    return dots ? { ...rest, dots } : rest;
  }
}

export type NearbyV3RosterMember = { userId: string; stageName: string; pub: string; isTraveler: boolean };

export type NearbyV3RuntimeDeps = {
  gunService: WebGunService;
  mesh: NearbyV3MeshPort;
  apiBase: () => string;
  userId: string;
  stageName: () => string;
  countIdentity?: () => NearbyCountIdentity | null;
  config: () => NearbyV3Config;
  /** Hub attestor keys the signed manifest pins (empty: trust the hub's announced key). */
  pinnedAttestorKeys?: () => readonly NearbyAttestorKey[];
  /** Where my card says I am, and in which scope: Nearby, or a Place (`place:<id>`, at its pin). */
  position: () => { point: PublicLocation; traveler: boolean; scope?: NearbyCardScope } | null;
  isPaused?: () => boolean;
  /** The list changed: it is the roster of the current scope (Nearby or the Place). */
  onRoster: (members: NearbyV3RosterMember[], entries: readonly NearbyListEntry[]) => void;
  /** Fresh hub headcounts from this identity's own heartbeat, for the scope its card was in. */
  onCounts?: (counts: { nearby: number; online: number; scope: NearbyCardScope }) => void;
};

export class NearbyV3Runtime {
  readonly service: NearbyV3Service;
  readonly hub: FetchNearbyV3Hub;
  private readonly knocks: GunNearbyKnockChannel;
  private readonly hubKnocks: HttpNearbyKnockChannel;
  /** Offline Nearby: cards posted by phones that cannot reach the hub, read around my point. */
  private readonly board: GunNearbyLocalBoard;
  private readonly gate: NearbyKnockGate;
  private stopKnocks: (() => void) | null = null;
  private stopHubKnocks: (() => void) | null = null;
  private positionWatch: ReturnType<typeof setInterval> | null = null;
  private refreshing = false;

  constructor(private readonly deps: NearbyV3RuntimeDeps) {
    this.hub = new FetchNearbyV3Hub(deps.apiBase, deps.onCounts, () => deps.config().capacity);
    this.knocks = new GunNearbyKnockChannel(deps.gunService.getGun() as never);
    this.hubKnocks = new HttpNearbyKnockChannel(deps.apiBase);
    this.board = new GunNearbyLocalBoard(deps.gunService.getGun() as never, (card) => {
      void this.service.localCard(card).catch(() => undefined);
    });
    this.service = new NearbyV3Service({
      config: deps.config,
      ...(deps.pinnedAttestorKeys ? { pinnedAttestorKeys: deps.pinnedAttestorKeys } : {}),
      identity: () => {
        const local = this.pair();
        return local?.pub && local.priv ? {
          userId: deps.userId,
          pair: local,
          stageName: deps.stageName(),
          ...(deps.countIdentity?.() ? { countIdentity: deps.countIdentity()! } : {}),
        } : null;
      },
      position: () => {
        const position = deps.position();
        return position ? { ...position, scope: position.scope ?? 'nearby' } : null;
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
    // The gate drops a knock seen before, so one that comes both ways counts once.
    const receive = (knock: unknown) => { void this.gate.receive(knock); };
    if (localPub && !this.stopKnocks) this.stopKnocks = this.knocks.listen(localPub, receive);
    if (localPub && !this.stopHubKnocks) this.stopHubKnocks = this.hubKnocks.listen(localPub, receive);
    this.service.start();
    // My card must say where I am now: entering or leaving a Place, or moving, reissues it at once,
    // whichever path changed it. Compared with the card itself, not with the last position seen: a
    // visit shorter than one check still left a Place card at the hub (phone-path J-PLACE-11).
    this.positionWatch ??= setInterval(() => {
      if (this.refreshing || !this.service.cardIsOutOfPlace()) return;
      this.refreshing = true;
      void this.service.refresh().catch(() => undefined).finally(() => { this.refreshing = false; });
    }, POSITION_WATCH_MS);
  }

  stop(): void {
    this.service.stop();
    this.board.stop();
    this.stopKnocks?.();
    this.stopKnocks = null;
    this.stopHubKnocks?.();
    this.stopHubKnocks = null;
    if (this.positionWatch) clearInterval(this.positionWatch);
    this.positionWatch = null;
  }

  /** The public point changed (moved, traveled, privacy setting). */
  refresh(): void {
    void this.service.refresh().catch(() => undefined);
  }

  /** Mesh hook: ask this peer to open their side of our link. */
  async knock(peer: { userId: string; pub: string }): Promise<void> {
    const local = this.pair();
    if (!local?.pub || !local.priv) return;
    const knock = await this.knocks.send({ fromUserId: this.deps.userId, pair: local, toPub: peer.pub, card: this.service.card() });
    await this.hubKnocks.send(knock).catch(() => undefined);
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
