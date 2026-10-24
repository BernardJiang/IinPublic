import SEA from 'gun/sea';
import { verifyLinkAttestation, type LinkCrypto } from '../../shared/identity-linking';
import { verifyNearbyCard, type NearbyCard } from '../../shared/nearby-v3-card';
import type { NearbyV3Config } from '../../shared/nearby-v3-config';
import {
  parsePyramidCellId,
  pyramidCell,
  pyramidCellBounds,
  pyramidCellId,
  pyramidCellIds,
  pyramidSearch,
  type PyramidPoint,
} from '../../shared/nearby-v3-pyramid';
import { publicLocationContains, type PublicLocation } from '../../shared/public-location';

type PresenceWriter = {
  card: NearbyCard;
  heartbeatAtMs: number;
  expiresAtMs: number;
};

/** The authoritative, single active presence for one countable identity. */
type PresenceLease = {
  countKey: string;
  scopeRevision: number;
  scope: NearbyCard['scope'];
  point: PublicLocation;
  writers: Map<string, PresenceWriter>;
  updatedAtMs: number;
};

export type NearbyHeartbeatResult = {
  accepted: true;
  online: number;
  nearby: number;
  activeHeadcount: number;
  countRevision: number;
  scopeRevision: number;
};

export type NearbyIntroductions = {
  cards: NearbyCard[];
  steps: Array<{ level: number; people: number }>;
  online: number;
  countRevision: number;
};

export type NearbyHeatCell = { latitude: number; longitude: number; count: number };

export type NearbyStats = {
  online: number;
  heat: NearbyHeatCell[];
  level: number | null;
  countRevision: number;
};

const MAX_HEAT_CELLS = 2_500;
const MAX_PRESENCES = 500_000;

/** A stale or conflicting writer must not silently restore an old scope. */
export class NearbyPresenceConflictError extends Error {
  readonly status = 409;

  constructor(
    message: string,
    readonly acceptedRevision: number,
    readonly countRevision: number,
    readonly acceptedScope: NearbyCard['scope'],
    readonly acceptedPoint: PublicLocation,
  ) {
    super(message);
    this.name = 'NearbyPresenceConflictError';
  }
}

/**
 * Nearby v3 hub presence foundation (§3.7, OPEN-85).
 *
 * A count key owns one revisioned lease. Counts, Places, heat and introductions all read that same
 * lease map; no rolling/add-only counter can leave a moved identity in two audiences. An unlinked
 * card uses its own pub as the count key. A directly linked device may use the smaller linked pub
 * only when it carries both existing mutual-link attestations.
 */
export class NearbyV3Hub {
  private config: NearbyV3Config;
  private readonly leases = new Map<string, PresenceLease>();
  /** Pyramid cell or `place:<id>` → live count keys. */
  private readonly members = new Map<string, Set<string>>();
  private revision = 0;

  constructor(
    config: NearbyV3Config,
    _nowMs = Date.now(),
    /** A member's card for a Place arrived: the Place is in use (§4.2 liveness). */
    private readonly onPlaceCard?: (placeId: string) => void,
  ) {
    this.config = config;
  }

  setConfig(config: NearbyV3Config): void {
    this.config = config;
  }

  clear(_nowMs = Date.now()): void {
    this.leases.clear();
    this.members.clear();
    this.revision = 0;
  }

  /** A phone's (re)issued card. Throws when the card or linked count identity does not verify. */
  async heartbeat(value: unknown, now = new Date()): Promise<NearbyHeartbeatResult> {
    const verification = await verifyNearbyCard(value, { maxLifetimeMs: this.config.cardLifetimeMs, now });
    if (!verification.ok) throw new Error(verification.reason);
    if (!await this.verifyCountIdentity(verification.card)) throw new Error('invalid Nearby count identity proof');
    return this.ingest(verification.card, now.getTime());
  }

  /** Immediately remove this device writer; another linked writer may keep the lease live. */
  async leave(value: unknown, now = new Date()): Promise<{ accepted: true; online: number; countRevision: number }> {
    const verification = await verifyNearbyCard(value, { maxLifetimeMs: this.config.cardLifetimeMs, now });
    if (!verification.ok) throw new Error(verification.reason);
    const card = verification.card;
    if (!await this.verifyCountIdentity(card)) throw new Error('invalid Nearby count identity proof');
    this.purgeExpired(now.getTime());
    const lease = this.leases.get(card.countKey);
    if (!lease) return { accepted: true, online: this.leases.size, countRevision: this.revision };
    if (card.scopeRevision !== lease.scopeRevision) {
      throw this.conflict('stale Nearby scope revision', lease);
    }
    lease.writers.delete(card.pub);
    if (!lease.writers.size) this.removeLease(lease);
    else {
      lease.updatedAtMs = now.getTime();
      this.touchLease(lease);
    }
    return { accepted: true, online: this.leases.size, countRevision: this.revision };
  }

  /** Count and index a card whose signatures were already checked. Used directly by unit models. */
  ingest(card: NearbyCard, nowMs: number): NearbyHeartbeatResult {
    this.purgeExpired(nowMs);
    let lease = this.leases.get(card.countKey);
    const fingerprint = this.scopeFingerprint(card.scope, card.point);
    if (lease && card.scopeRevision < lease.scopeRevision) {
      throw this.conflict('stale Nearby scope revision', lease);
    }
    if (lease && card.scopeRevision === lease.scopeRevision
      && fingerprint !== this.scopeFingerprint(lease.scope, lease.point)) {
      throw this.conflict('conflicting Nearby scope at accepted revision', lease);
    }

    if (!lease) {
      lease = {
        countKey: card.countKey,
        scopeRevision: card.scopeRevision,
        scope: card.scope,
        point: card.point,
        writers: new Map(),
        updatedAtMs: nowMs,
      };
      this.leases.set(card.countKey, lease);
      this.addToIndexes(lease);
      this.bumpRevision();
    } else if (card.scopeRevision > lease.scopeRevision) {
      this.removeFromIndexes(lease);
      lease.scopeRevision = card.scopeRevision;
      lease.scope = card.scope;
      lease.point = card.point;
      lease.writers.clear();
      this.addToIndexes(lease);
      this.bumpRevision();
    }

    const expiresAtMs = Math.min(Date.parse(card.expiresAt), nowMs + 2 * this.config.cardReissueMs);
    lease.writers.set(card.pub, { card, heartbeatAtMs: nowMs, expiresAtMs });
    lease.updatedAtMs = nowMs;
    this.touchLease(lease);
    if (card.scope !== 'nearby') this.onPlaceCard?.(card.scope.slice('place:'.length));
    this.enforcePresenceBound();

    const nearby = card.scope === 'nearby'
      ? this.nearbyHeadcount(card.countKey, card.point)
      : this.count(card.scope, nowMs);
    return {
      accepted: true,
      online: this.leases.size,
      nearby,
      activeHeadcount: nearby,
      countRevision: this.revision,
      scopeRevision: lease.scopeRevision,
    };
  }

  /** People online in one pyramid cell or Place scope, from the authoritative live leases. */
  count(cellId: string, nowMs = Date.now()): number {
    this.purgeExpired(nowMs);
    return this.members.get(cellId)?.size ?? 0;
  }

  /** Place headcounts include the viewer and every other distinct live count key there. */
  placeCounts(nowMs = Date.now()): Array<{ placeId: string; count: number }> {
    this.purgeExpired(nowMs);
    return [...this.members]
      .filter(([key, value]) => key.startsWith('place:') && value.size > 0)
      .map(([key, value]) => ({ placeId: key.slice('place:'.length), count: value.size }))
      .sort((a, b) => a.placeId.localeCompare(b.placeId));
  }

  /** Which requested user ids have at least one live device writer. */
  onlineUserIds(userIds: readonly string[], nowMs = Date.now()): string[] {
    this.purgeExpired(nowMs);
    const live = new Set<string>();
    for (const lease of this.leases.values()) {
      for (const writer of lease.writers.values()) live.add(writer.card.userId);
    }
    return userIds.filter((userId) => live.has(userId));
  }

  online(nowMs = Date.now()): number {
    this.purgeExpired(nowMs);
    return this.leases.size;
  }

  countRevision(nowMs = Date.now()): number {
    this.purgeExpired(nowMs);
    return this.revision;
  }

  /**
   * A newcomer's bounded introductions. OPEN-86 owns final paging; OPEN-85 supplies exact live
   * counts and removes the former fixed-50-km filter.
   */
  introductions(input: { point: PyramidPoint; scope?: string; excludePub?: string; now?: Date }): NearbyIntroductions {
    const nowMs = (input.now ?? new Date()).getTime();
    this.purgeExpired(nowMs);
    const scope = input.scope ?? 'nearby';
    const out = new Map<string, NearbyCard>();
    const excludedCountKey = input.excludePub ? this.countKeyForPub(input.excludePub) : undefined;
    const take = (indexKey: string) => {
      for (const [countKey, card] of this.liveSample(indexKey)) {
        if (countKey === excludedCountKey || card.pub === input.excludePub || card.scope !== scope) continue;
        out.set(countKey, card);
      }
    };
    if (scope !== 'nearby') {
      take(scope);
      return {
        cards: [...out.values()],
        steps: [],
        online: this.leases.size,
        countRevision: this.revision,
      };
    }
    const steps = pyramidSearch({
      point: input.point,
      finestLevel: this.config.pyramidFinestLevel,
      target: this.config.capacity,
      count: (cellId) => this.members.get(cellId)?.size ?? 0,
      ...(excludedCountKey ? { self: 1 } : {}),
    });
    for (const step of steps) for (const cellId of step.cells) take(cellId);
    return {
      cards: [...out.values()],
      steps: steps.map(({ level, people }) => ({ level, people })),
      online: this.leases.size,
      countRevision: this.revision,
    };
  }

  /** Online total plus exact live heat cells for a map view. */
  stats(bounds?: { west: number; south: number; east: number; north: number }, nowMs = Date.now()): NearbyStats {
    this.purgeExpired(nowMs);
    const online = this.leases.size;
    if (!bounds) return { online, heat: [], level: null, countRevision: this.revision };
    const width = bounds.west <= bounds.east ? bounds.east - bounds.west : 360 - bounds.west + bounds.east;
    const span = Math.max(width / 360, (bounds.north - bounds.south) / 180, 1e-9);
    const level = Math.max(0, Math.min(this.config.pyramidFinestLevel, Math.floor(Math.log2(48 / span))));
    const cells = new Map<string, number>();
    for (const lease of this.leases.values()) {
      if (lease.scope !== 'nearby') continue;
      const id = pyramidCellId(pyramidCell(lease.point, level));
      cells.set(id, (cells.get(id) ?? 0) + 1);
    }
    const heat: NearbyHeatCell[] = [];
    for (const [cellId, count] of cells) {
      const cell = parsePyramidCellId(cellId);
      if (!cell) continue;
      const box = pyramidCellBounds(cell);
      const point = { latitude: (box.south + box.north) / 2, longitude: (box.west + box.east) / 2 };
      if (!pointInBounds(point, bounds)) continue;
      heat.push({ ...point, count });
      if (heat.length >= MAX_HEAT_CELLS) break;
    }
    return { online, heat, level, countRevision: this.revision };
  }

  private nearbyHeadcount(viewerCountKey: string, viewerPoint: PublicLocation): number {
    let eligible = 0;
    let regional = 0;
    for (const lease of this.leases.values()) {
      if (lease.countKey === viewerCountKey || lease.scope !== 'nearby') continue;
      eligible += 1;
      if (publicLocationContains(viewerPoint, lease.point)) regional += 1;
    }
    return Math.min(eligible, Math.max(this.config.capacity, regional));
  }

  private liveSample(indexKey: string): Array<[string, NearbyCard]> {
    const keys = this.members.get(indexKey);
    if (!keys) return [];
    return [...keys]
      .map((countKey) => this.leases.get(countKey))
      .filter((lease): lease is PresenceLease => !!lease)
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs || a.countKey.localeCompare(b.countKey))
      .slice(0, this.config.hubCellSample)
      .map((lease) => [lease.countKey, this.representativeCard(lease)]);
  }

  private representativeCard(lease: PresenceLease): NearbyCard {
    const preferred = lease.writers.get(lease.countKey);
    if (preferred) return preferred.card;
    return [...lease.writers.values()]
      .sort((a, b) => a.card.pub.localeCompare(b.card.pub))[0]!.card;
  }

  private countKeyForPub(pub: string): string | undefined {
    for (const lease of this.leases.values()) if (lease.writers.has(pub)) return lease.countKey;
    return undefined;
  }

  private addToIndexes(lease: PresenceLease): void {
    for (const key of this.indexKeys(lease)) {
      let set = this.members.get(key);
      if (!set) {
        set = new Set();
        this.members.set(key, set);
      }
      set.add(lease.countKey);
    }
  }

  private removeFromIndexes(lease: PresenceLease): void {
    for (const key of this.indexKeys(lease)) {
      const set = this.members.get(key);
      set?.delete(lease.countKey);
      if (!set?.size) this.members.delete(key);
    }
  }

  private indexKeys(lease: Pick<PresenceLease, 'scope' | 'point'>): string[] {
    return lease.scope === 'nearby'
      ? pyramidCellIds(lease.point, this.config.pyramidFinestLevel)
      : [lease.scope];
  }

  private removeLease(lease: PresenceLease): void {
    this.removeFromIndexes(lease);
    this.leases.delete(lease.countKey);
    this.bumpRevision();
  }

  private purgeExpired(nowMs: number): void {
    for (const lease of [...this.leases.values()]) {
      for (const [pub, writer] of lease.writers) {
        if (writer.expiresAtMs <= nowMs) lease.writers.delete(pub);
      }
      if (!lease.writers.size) this.removeLease(lease);
    }
  }

  private touchLease(lease: PresenceLease): void {
    this.leases.delete(lease.countKey);
    this.leases.set(lease.countKey, lease);
  }

  private enforcePresenceBound(): void {
    while (this.leases.size > MAX_PRESENCES) {
      const oldest = this.leases.values().next().value as PresenceLease | undefined;
      if (!oldest) break;
      this.removeLease(oldest);
    }
  }

  private bumpRevision(): void {
    this.revision = this.revision >= Number.MAX_SAFE_INTEGER ? 1 : this.revision + 1;
  }

  private scopeFingerprint(scope: NearbyCard['scope'], point: PublicLocation): string {
    return `${scope}|${point.latitude}|${point.longitude}|${point.precisionMeters}`;
  }

  private conflict(message: string, lease: PresenceLease): NearbyPresenceConflictError {
    return new NearbyPresenceConflictError(
      message,
      lease.scopeRevision,
      this.revision,
      lease.scope,
      { ...lease.point },
    );
  }

  private async verifyCountIdentity(card: NearbyCard): Promise<boolean> {
    if (card.countKey === card.pub) return card.countProof === undefined;
    const proof = card.countProof;
    if (!proof || proof.anchorPub !== card.countKey) return false;
    const crypto: LinkCrypto = {
      sign: async () => '',
      verify: async (data, signature, pub) => {
        try {
          return await SEA.verify(signature, pub) === data;
        } catch {
          return false;
        }
      },
      hash: async () => '',
      randomSecret: () => '',
    };
    const [forward, reverse] = await Promise.all([
      verifyLinkAttestation(proof.memberToAnchor, crypto),
      verifyLinkAttestation(proof.anchorToMember, crypto),
    ]);
    return forward && reverse;
  }
}

function pointInBounds(
  point: PyramidPoint,
  bounds: { west: number; south: number; east: number; north: number },
): boolean {
  if (point.latitude < bounds.south || point.latitude > bounds.north) return false;
  return bounds.west <= bounds.east
    ? point.longitude >= bounds.west && point.longitude <= bounds.east
    : point.longitude >= bounds.west || point.longitude <= bounds.east;
}
