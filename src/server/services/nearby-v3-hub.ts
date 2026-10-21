import { randomBytes, createHash } from 'crypto';
import { verifyNearbyCard, type NearbyCard } from '../../shared/nearby-v3-card';
import type { NearbyV3Config } from '../../shared/nearby-v3-config';
import {
  parsePyramidCellId,
  pyramidCellBounds,
  pyramidCellIds,
  pyramidSearch,
  type PyramidPoint,
} from '../../shared/nearby-v3-pyramid';

/**
 * The hub's whole part in Nearby v3 (§3.7 "The hub: counts and introductions, not lists"):
 *
 * 1. statistics: people online, in total and per pyramid cell, counted from verified card
 *    heartbeats. A key is counted once per window through a salted hash set that is thrown away with
 *    the window, so counting keeps no identities;
 * 2. introductions: a bounded, rotating sample of recent cards per cell (and per Place), from which a
 *    newcomer gets its first cards.
 *
 * It never stores or serves anyone's nearby list.
 */
/** `seen` holds a person once (the total); `seenAt`, once per list and point (the cell counts). */
type CountWindow = {
  index: number;
  salt: Buffer;
  seen: Set<string>;
  seenAt: Set<string>;
  cells: Map<string, number>;
  total: number;
};

export type NearbyIntroductions = {
  cards: NearbyCard[];
  steps: Array<{ level: number; people: number }>;
  online: number;
};

export type NearbyHeatCell = { latitude: number; longitude: number; count: number };

export type NearbyStats = { online: number; heat: NearbyHeatCell[]; level: number | null };

/** Most cells one heat query returns. */
const MAX_HEAT_CELLS = 2_500;
/** Most distinct cell or Place samples the hub keeps; the least recently fed is dropped first. */
const MAX_SAMPLES = 500_000;

export class NearbyV3Hub {
  private config: NearbyV3Config;
  private current: CountWindow;
  private previous: CountWindow | null = null;
  private samples = new Map<string, Map<string, NearbyCard>>();
  /**
   * pub → when its last heartbeat arrived and which samples hold its card; only recent ones are
   * introduced, and a card that moves (into a Place, back to Nearby, to a new point) leaves the
   * samples it was in.
   */
  private lastHeartbeat = new Map<string, { atMs: number; cells: string[] }>();
  /** userId → pub while that user's card is live, so another key cannot speak for them. */
  private owners = new Map<string, { pub: string; expiresAtMs: number }>();

  constructor(
    config: NearbyV3Config,
    nowMs = Date.now(),
    /** A member's card for a Place arrived: the Place is in use (§4.2 liveness). */
    private readonly onPlaceCard?: (placeId: string) => void,
  ) {
    this.config = config;
    this.current = this.newWindow(this.windowIndex(nowMs));
  }

  setConfig(config: NearbyV3Config): void {
    this.config = config;
  }

  clear(nowMs = Date.now()): void {
    this.samples.clear();
    this.owners.clear();
    this.lastHeartbeat.clear();
    this.previous = null;
    this.current = this.newWindow(this.windowIndex(nowMs));
  }

  /** A phone's (re)issued card. Throws when the card does not verify. */
  async heartbeat(value: unknown, now = new Date()): Promise<{ accepted: true; online: number }> {
    const verification = await verifyNearbyCard(value, { maxLifetimeMs: this.config.cardLifetimeMs, now });
    if (!verification.ok) throw new Error(verification.reason);
    return this.ingest(verification.card, now.getTime());
  }

  /** Count and sample a card whose signature was already checked. */
  ingest(card: NearbyCard, nowMs: number): { accepted: true; online: number } {
    const owner = this.owners.get(card.userId);
    if (owner && owner.pub !== card.pub && owner.expiresAtMs > nowMs) throw new Error('userId is held by another key');
    this.owners.set(card.userId, { pub: card.pub, expiresAtMs: Date.parse(card.expiresAt) });

    this.roll(nowMs);
    const cells = card.scope === 'nearby'
      ? pyramidCellIds(card.point, this.config.pyramidFinestLevel)
      : [card.scope];
    const hashed = createHash('sha256').update(this.current.salt).update(card.pub).digest('base64');
    if (!this.current.seen.has(hashed)) {
      this.current.seen.add(hashed);
      // Everyone online, in Nearby or in a Place ("M online", §3.7).
      this.current.total += 1;
    }
    const at = `${card.scope}|${card.point.latitude},${card.point.longitude}`;
    const hashedAt = createHash('sha256').update(this.current.salt).update(card.pub).update('\n').update(at).digest('base64');
    if (!this.current.seenAt.has(hashedAt)) {
      // Someone entering a Place counts there in this window, not only from the next one.
      this.current.seenAt.add(hashedAt);
      for (const cell of cells) this.current.cells.set(cell, (this.current.cells.get(cell) ?? 0) + 1);
    }
    const previous = this.lastHeartbeat.get(card.pub);
    for (const cell of previous?.cells ?? []) {
      const sample = cells.includes(cell) ? undefined : this.samples.get(cell);
      if (sample?.delete(card.pub) && !sample.size) this.samples.delete(cell);
    }
    this.lastHeartbeat.delete(card.pub);
    this.lastHeartbeat.set(card.pub, { atMs: nowMs, cells });
    while (this.lastHeartbeat.size > MAX_SAMPLES) this.lastHeartbeat.delete(this.lastHeartbeat.keys().next().value as string);
    for (const cell of cells) this.addSample(cell, card);
    if (card.scope !== 'nearby') this.onPlaceCard?.(card.scope.slice('place:'.length));
    return { accepted: true, online: this.online(nowMs) };
  }

  /** People online in a cell (or Place scope): the larger of this window and the last full one. */
  count(cellId: string, nowMs = Date.now()): number {
    this.roll(nowMs);
    return Math.max(this.current.cells.get(cellId) ?? 0, this.previous?.cells.get(cellId) ?? 0);
  }

  /**
   * People in each Place with anyone in it (the room list, §3.7 "Places in v3"): those whose card
   * is live there now, so a Place empties the moment its people leave. Only a crowd larger than the
   * sample falls back to the window count.
   */
  placeCounts(nowMs = Date.now()): Array<{ placeId: string; count: number }> {
    this.roll(nowMs);
    const ids = new Set<string>();
    for (const window of [this.current, this.previous]) {
      for (const key of window?.cells.keys() ?? []) if (key.startsWith('place:')) ids.add(key);
    }
    return [...ids].map((key) => {
      const live = this.liveSample(key, nowMs).length;
      const count = live < this.config.hubCellSample ? live : Math.max(live, this.count(key, nowMs));
      return { placeId: key.slice('place:'.length), count };
    }).filter((row) => row.count > 0);
  }

  /**
   * Which of these users are online (§3.7 "Contacts online"): their card's key heartbeated within
   * two reissue periods. Answers only yes or no per id, never where.
   */
  onlineUserIds(userIds: readonly string[], nowMs = Date.now()): string[] {
    const window = 2 * this.config.cardReissueMs;
    return userIds.filter((userId) => {
      const owner = this.owners.get(userId);
      if (!owner || owner.expiresAtMs <= nowMs) return false;
      const last = this.lastHeartbeat.get(owner.pub);
      return !!last && nowMs - last.atMs <= window;
    });
  }

  online(nowMs = Date.now()): number {
    this.roll(nowMs);
    return Math.max(this.current.total, this.previous?.total ?? 0);
  }

  /**
   * A newcomer's first cards (§3.7 "Finding how far to look"): climb the pyramid until the 3×3 block
   * around `point` holds C people, sampling every block on the way. For a Place, its own sample.
   */
  introductions(input: { point: PyramidPoint; scope?: string; excludePub?: string; now?: Date }): NearbyIntroductions {
    const nowMs = (input.now ?? new Date()).getTime();
    const scope = input.scope ?? 'nearby';
    const out = new Map<string, NearbyCard>();
    const take = (cellId: string) => {
      for (const card of this.liveSample(cellId, nowMs)) {
        if (card.pub !== input.excludePub && card.scope === scope) out.set(card.pub, card);
      }
    };
    if (scope !== 'nearby') {
      take(scope);
      return { cards: [...out.values()], steps: [], online: this.count(scope, nowMs) };
    }
    const steps = pyramidSearch({
      point: input.point,
      finestLevel: this.config.pyramidFinestLevel,
      target: this.config.capacity,
      count: (cellId) => this.count(cellId, nowMs),
    });
    for (const step of steps) for (const cellId of step.cells) take(cellId);
    return {
      cards: [...out.values()],
      steps: steps.map(({ level, people }) => ({ level, people })),
      online: this.online(nowMs),
    };
  }

  /**
   * Online total plus heat cells for a map view: the level whose cells are about 1/48 of the view's
   * larger side, never finer than the pyramid's finest level.
   */
  stats(bounds?: { west: number; south: number; east: number; north: number }, nowMs = Date.now()): NearbyStats {
    const online = this.online(nowMs);
    if (!bounds) return { online, heat: [], level: null };
    const width = bounds.west <= bounds.east ? bounds.east - bounds.west : 360 - bounds.west + bounds.east;
    const span = Math.max(width / 360, (bounds.north - bounds.south) / 180, 1e-9);
    const level = Math.max(0, Math.min(this.config.pyramidFinestLevel, Math.floor(Math.log2(48 / span))));
    const heat: NearbyHeatCell[] = [];
    const cells = new Map<string, number>();
    for (const window of [this.previous, this.current]) {
      if (!window) continue;
      for (const [cellId, count] of window.cells) {
        if (!cellId.startsWith(`${level}/`)) continue;
        cells.set(cellId, Math.max(cells.get(cellId) ?? 0, count));
      }
    }
    for (const [cellId, count] of cells) {
      const cell = parsePyramidCellId(cellId);
      if (!cell) continue;
      const box = pyramidCellBounds(cell);
      const latitude = (box.south + box.north) / 2;
      const longitude = (box.west + box.east) / 2;
      if (!pointInBounds({ latitude, longitude }, bounds)) continue;
      heat.push({ latitude, longitude, count });
      if (heat.length >= MAX_HEAT_CELLS) break;
    }
    return { online, heat, level };
  }

  private liveSample(cellId: string, nowMs: number): NearbyCard[] {
    const sample = this.samples.get(cellId);
    if (!sample) return [];
    const live: NearbyCard[] = [];
    // A phone heartbeats once per reissue period; one that missed two has left, whatever its
    // card's lifetime says, so it is no longer introduced.
    const recent = nowMs - 2 * this.config.cardReissueMs;
    for (const [pub, card] of sample) {
      if (Date.parse(card.expiresAt) <= nowMs) sample.delete(pub);
      else if ((this.lastHeartbeat.get(pub)?.atMs ?? 0) >= recent) live.push(card);
    }
    if (!sample.size) this.samples.delete(cellId);
    return live;
  }

  private addSample(cellId: string, card: NearbyCard): void {
    let sample = this.samples.get(cellId);
    if (sample) this.samples.delete(cellId);
    else sample = new Map();
    this.samples.set(cellId, sample);
    sample.delete(card.pub);
    sample.set(card.pub, card);
    while (sample.size > this.config.hubCellSample) sample.delete(sample.keys().next().value as string);
    while (this.samples.size > MAX_SAMPLES) this.samples.delete(this.samples.keys().next().value as string);
  }

  private windowIndex(nowMs: number): number {
    return Math.floor(nowMs / this.config.cardReissueMs);
  }

  private newWindow(index: number): CountWindow {
    return { index, salt: randomBytes(16), seen: new Set(), seenAt: new Set(), cells: new Map(), total: 0 };
  }

  private roll(nowMs: number): void {
    const index = this.windowIndex(nowMs);
    if (index === this.current.index) return;
    this.previous = index === this.current.index + 1 ? this.current : null;
    this.current = this.newWindow(index);
    for (const [userId, owner] of this.owners) if (owner.expiresAtMs <= nowMs) this.owners.delete(userId);
  }
}

function pointInBounds(point: PyramidPoint, bounds: { west: number; south: number; east: number; north: number }): boolean {
  if (point.latitude < bounds.south || point.latitude > bounds.north) return false;
  return bounds.west <= bounds.east
    ? point.longitude >= bounds.west && point.longitude <= bounds.east
    : point.longitude >= bounds.west || point.longitude <= bounds.east;
}
