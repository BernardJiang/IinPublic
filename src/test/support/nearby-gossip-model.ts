/**
 * Model of the proposed Nearby v3 (docs/design/nearby-and-place-chatrooms.md §3.7): no shared rooms.
 * Every phone keeps its own list of at most C signed presence cards, ranked by distance between
 * privacy-floor cells and then by a per-viewer hash, and improves it by swapping a few cards with
 * one listed person per round. The hub only keeps headcounts per pyramid cell and a bounded sample
 * of recent cards per cell, which it uses to seed a newcomer; it never serves anyone's full list.
 *
 * Two ways to break distance ties:
 *   - 'public-hash': hash(viewer identity, member identity). A sender can rank its cards the way the
 *     receiver would, so swaps are targeted; but anyone can predict (and grind keys against) a
 *     victim's order.
 *   - 'secret-salt': hash(viewer's private salt, member identity). Nobody else can predict the
 *     order; a sender can only rank by distance and breaks ties at random.
 *
 * What it leaves out: signatures, network timing, NAT failures and per-connection cost. One round is
 * one gossip period (each live phone starts one swap). Card freshness is counted in rounds.
 */
import type { GPSCoordinate } from '../../shared/types';
import { seededRandom } from './nearby-capacity-model';

export type GossipVariant = 'public-hash' | 'secret-salt';

export type GossipOptions = {
  capacity: number;
  /** Cards each side sends in one swap. */
  swapCards: number;
  /** A card older than this many rounds is dropped (its owner stopped re-signing it). */
  ttlRounds: number;
  /**
   * A swap re-sends a card the receiver already holds only when the sender's copy is at least this
   * many rounds fresher (the receiver's request carries a compact digest of what it holds).
   */
  refreshRounds: number;
  /**
   * How the hub picks a newcomer's first cards:
   *   - 'region': a sample from the newcomer's own ~100 km region plus a worldwide sample;
   *   - 'pyramid': from the headcount pyramid, climbing from the finest level until the 3×3 block of
   *     cells around the newcomer holds at least C people, a bounded sample from the block's cells at
   *     every level on the way.
   */
  seeding: 'region' | 'pyramid';
  /** Finest pyramid level (the privacy-floor cell level). */
  pyramidLevels: number;
  /** Cards the hub keeps per pyramid cell (a rotating sample, not a member list). */
  cellSeeds: number;
  /** Cards the hub hands a newcomer from its own ~100 km region ('region' seeding). */
  regionSeeds: number;
  /** Cards the hub hands a newcomer from anywhere in the world. */
  globalSeeds: number;
  variant: GossipVariant;
  /** Privacy floor: cards carry the centre of this cell, never the exact point. */
  cellMeters: number;
  seed: number;
};

export const DEFAULT_GOSSIP_OPTIONS: Omit<GossipOptions, 'variant' | 'seed'> = {
  capacity: 498,
  swapCards: 32,
  ttlRounds: 30,
  refreshRounds: 10,
  seeding: 'pyramid',
  pyramidLevels: 15,
  cellSeeds: 64,
  regionSeeds: 64,
  globalSeeds: 64,
  cellMeters: 1_000,
};

const EARTH_RADIUS_METERS = 6_371_000;
const HASH_SPACE = 2_097_152; // 2^21: distance in metres × 2^21 + 21 hash bits stays below 2^53

export type GossipState = {
  options: GossipOptions;
  random: () => number;
  /** Allocated people (live, departed, and not yet joined). */
  size: number;
  joined: number;
  round: number;
  live: Uint8Array;
  sybil: Uint8Array;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  region: Int32Array;
  /** Equirectangular position in [0, 1) for the pyramid. */
  gx: Float64Array;
  gy: Float64Array;
  /** Per pyramid level: cell → live people (the model's stand-in for the hub's counts and samples). */
  levelMembers: Array<Map<number, number[]>>;
  identity: Uint32Array;
  salt: Uint32Array;
  viewIds: Int32Array;
  viewTs: Int32Array;
  viewLen: Int32Array;
  regionMembers: Map<number, number[]>;
  liveList: number[];
  cardsSent: number;
  swaps: number;
  failedContacts: number;
  // Scratch space.
  mark: Int32Array;
  markPos: Int32Array;
  stamp: number;
  sybilCache: number[];
  sybilCacheRound: number;
};

function mix(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ b;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** The privacy-floor cell centre (what a card publishes) and the hub's ~100 km seed region. */
function snap(location: GPSCoordinate, cellMeters: number): { lat: number; lng: number; region: number } {
  const perDegree = 111_320 / cellMeters;
  const latIndex = Math.floor(location.latitude * perDegree);
  const lat = (latIndex + 0.5) / perDegree;
  const lngPerDegree = perDegree * Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const lngIndex = Math.floor(location.longitude * lngPerDegree);
  const lng = (lngIndex + 0.5) / lngPerDegree;
  const region = (Math.floor(lat) + 90) * 360 + (Math.floor(lng) + 180);
  return { lat, lng, region };
}

export function newGossipModel(
  locations: GPSCoordinate[],
  options: GossipOptions,
  extra: { reserve?: number; sybil?: (index: number) => boolean } = {},
): GossipState {
  const size = locations.length + (extra.reserve ?? 0);
  const random = seededRandom(options.seed);
  const state: GossipState = {
    options,
    random,
    size,
    joined: 0,
    round: 0,
    live: new Uint8Array(size),
    sybil: new Uint8Array(size),
    x: new Float64Array(size),
    y: new Float64Array(size),
    z: new Float64Array(size),
    region: new Int32Array(size),
    gx: new Float64Array(size),
    gy: new Float64Array(size),
    levelMembers: Array.from({ length: options.pyramidLevels + 1 }, () => new Map<number, number[]>()),
    identity: new Uint32Array(size),
    salt: new Uint32Array(size),
    viewIds: new Int32Array(size * options.capacity),
    viewTs: new Int32Array(size * options.capacity),
    viewLen: new Int32Array(size),
    regionMembers: new Map(),
    liveList: [],
    cardsSent: 0,
    swaps: 0,
    failedContacts: 0,
    mark: new Int32Array(size),
    markPos: new Int32Array(size),
    stamp: 0,
    sybilCache: [],
    sybilCacheRound: -1,
  };
  for (let index = 0; index < size; index += 1) {
    state.identity[index] = Math.floor(random() * 4_294_967_296) >>> 0;
    state.salt[index] = Math.floor(random() * 4_294_967_296) >>> 0;
  }
  for (const location of locations) addPerson(state, location, extra.sybil?.(state.joined) ?? false, false);
  for (let index = 0; index < state.joined; index += 1) bootstrap(state, index);
  return state;
}

function place(state: GossipState, index: number, location: GPSCoordinate): void {
  const { lat, lng, region } = snap(location, state.options.cellMeters);
  const phi = (lat * Math.PI) / 180;
  const lambda = (lng * Math.PI) / 180;
  state.x[index] = Math.cos(phi) * Math.cos(lambda);
  state.y[index] = Math.cos(phi) * Math.sin(lambda);
  state.z[index] = Math.sin(phi);
  state.region[index] = region;
  state.gx[index] = (lng + 180) / 360 - Math.floor((lng + 180) / 360);
  state.gy[index] = Math.min(0.999999, Math.max(0, (lat + 90) / 180));
}

function pyramidCell(state: GossipState, index: number, level: number): [number, number] {
  const n = 2 ** level;
  return [Math.floor(state.gx[index]! * n), Math.floor(state.gy[index]! * n)];
}

function cellKey(level: number, ix: number, iy: number): number {
  const n = 2 ** level;
  return (((ix % n) + n) % n) * n + iy;
}

/** The nine cells around a person at one pyramid level (longitude wraps; latitude stops at the poles). */
function window3x3(state: GossipState, index: number, level: number): number[][] {
  const n = 2 ** level;
  const [ix, iy] = pyramidCell(state, index, level);
  const cells: number[][] = [];
  const seen = new Set<number>();
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      if (iy + dy < 0 || iy + dy >= n) continue;
      const key = cellKey(level, ix + dx, iy + dy);
      if (seen.has(key)) continue;
      seen.add(key);
      const members = state.levelMembers[level]!.get(key);
      if (members) cells.push(members);
    }
  }
  return cells;
}

/** Ground distance between two people's published cells (chord metres: same order as the arc). */
export function cellDistance(state: GossipState, a: number, b: number): number {
  const dx = state.x[a]! - state.x[b]!;
  const dy = state.y[a]! - state.y[b]!;
  const dz = state.z[a]! - state.z[b]!;
  return Math.round(Math.sqrt(dx * dx + dy * dy + dz * dz) * EARTH_RADIUS_METERS);
}

/** The viewer's ranking of a member: nearer first, then the viewer's own hash order. */
export function rankKey(state: GossipState, viewer: number, member: number): number {
  const tie = state.options.variant === 'public-hash'
    ? mix(state.identity[viewer]!, state.identity[member]!)
    : mix(state.salt[viewer]!, state.identity[member]!);
  return cellDistance(state, viewer, member) * HASH_SPACE + (tie >>> 11);
}

/** Adds a person; with `join`, they arrive now and bootstrap from the hub's samples. */
export function addPerson(state: GossipState, location: GPSCoordinate, sybil = false, join = true): number {
  if (state.joined >= state.size) throw new Error('gossip model has no reserved slot left');
  const index = state.joined;
  state.joined += 1;
  place(state, index, location);
  state.live[index] = 1;
  state.sybil[index] = sybil ? 1 : 0;
  const members = state.regionMembers.get(state.region[index]!) ?? [];
  members.push(index);
  state.regionMembers.set(state.region[index]!, members);
  for (let level = 0; level <= state.options.pyramidLevels; level += 1) {
    const [ix, iy] = pyramidCell(state, index, level);
    const key = cellKey(level, ix, iy);
    const cell = state.levelMembers[level]!.get(key) ?? [];
    cell.push(index);
    state.levelMembers[level]!.set(key, cell);
  }
  state.liveList.push(index);
  if (join) bootstrap(state, index);
  return index;
}

/** People leave without saying goodbye: their cards simply stop being re-signed. */
export function removePeople(state: GossipState, leave: (index: number) => boolean): void {
  for (let index = 0; index < state.joined; index += 1) if (state.live[index] && leave(index)) state.live[index] = 0;
  state.liveList = state.liveList.filter((index) => state.live[index]);
  for (const [region, members] of state.regionMembers) {
    const kept = members.filter((index) => state.live[index]);
    if (kept.length) state.regionMembers.set(region, kept);
    else state.regionMembers.delete(region);
  }
  for (const cells of state.levelMembers) {
    for (const [key, members] of cells) {
      const kept = members.filter((index) => state.live[index]);
      if (kept.length) cells.set(key, kept);
      else cells.delete(key);
    }
  }
}

function sample(list: number[], count: number, random: () => number): number[] {
  if (list.length <= count) return list.slice();
  const out = new Set<number>();
  while (out.size < count) out.add(list[Math.floor(random() * list.length)]!);
  return [...out];
}

/** The hub's only role in discovery: a bounded sample of recent heartbeats, regional + worldwide. */
function bootstrap(state: GossipState, index: number): void {
  if (state.options.seeding === 'pyramid') {
    // Climb until the 3×3 block around the newcomer holds C people, taking a sample from the block
    // at every level on the way: the nearest few from fine levels, the crowd from the last one.
    const { capacity, cellSeeds, pyramidLevels } = state.options;
    const seeds: number[] = [];
    for (let level = pyramidLevels; level >= 0; level -= 1) {
      const cells = window3x3(state, index, level);
      for (const members of cells) seeds.push(...sample(members, cellSeeds, state.random));
      const people = cells.reduce((sum, members) => sum + members.length, 0) - 1;
      if (people >= capacity) break;
    }
    merge(state, index, Int32Array.from(seeds), new Int32Array(seeds.length).fill(state.round), seeds.length);
    return;
  }
  const seeds = [
    ...sample(state.regionMembers.get(state.region[index]!) ?? [], state.options.regionSeeds, state.random),
    ...sample(state.liveList, state.options.globalSeeds, state.random),
  ];
  const ts = new Int32Array(seeds.length).fill(state.round);
  merge(state, index, Int32Array.from(seeds), ts, seeds.length);
}

/**
 * Merge incoming cards into a viewer's sorted list: freshest copy wins, expired cards drop, and only
 * the top C by the viewer's own ranking stay.
 */
function merge(state: GossipState, viewer: number, ids: Int32Array, ts: Int32Array, count: number): void {
  const { capacity, ttlRounds } = state.options;
  const base = viewer * capacity;
  const length = state.viewLen[viewer]!;
  state.stamp += 1;
  const stamp = state.stamp;
  for (let i = 0; i < length; i += 1) {
    const id = state.viewIds[base + i]!;
    state.mark[id] = stamp;
    state.markPos[id] = i;
  }
  const freshIds: number[] = [];
  const freshTs: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = ids[i]!;
    const at = ts[i]!;
    if (id === viewer || state.round - at > ttlRounds) continue;
    if (state.mark[id] === stamp) {
      const position = base + state.markPos[id]!;
      if (state.viewTs[position]! < at) state.viewTs[position] = at;
      continue;
    }
    if (state.mark[id] === -stamp) continue;
    state.mark[id] = -stamp;
    freshIds.push(id);
    freshTs.push(at);
  }
  const incoming = freshIds.map((id, i) => ({ id, ts: freshTs[i]!, key: rankKey(state, viewer, id) }))
    .sort((a, b) => a.key - b.key);
  const outIds = new Int32Array(capacity);
  const outTs = new Int32Array(capacity);
  let out = 0;
  let next = 0;
  let pendingKey = -1;
  let pendingIndex = 0;
  const advanceExisting = () => {
    while (pendingIndex < length) {
      const position = base + pendingIndex;
      if (state.round - state.viewTs[position]! <= ttlRounds) {
        pendingKey = rankKey(state, viewer, state.viewIds[position]!);
        return;
      }
      pendingIndex += 1;
    }
    pendingKey = -1;
  };
  advanceExisting();
  while (out < capacity && (pendingKey >= 0 || next < incoming.length)) {
    if (pendingKey >= 0 && (next >= incoming.length || pendingKey <= incoming[next]!.key)) {
      outIds[out] = state.viewIds[base + pendingIndex]!;
      outTs[out] = state.viewTs[base + pendingIndex]!;
      out += 1;
      pendingIndex += 1;
      advanceExisting();
    } else {
      outIds[out] = incoming[next]!.id;
      outTs[out] = incoming[next]!.ts;
      out += 1;
      next += 1;
    }
  }
  state.viewIds.set(outIds.subarray(0, out), base);
  state.viewTs.set(outTs.subarray(0, out), base);
  state.viewLen[viewer] = out;
}

function removeFromView(state: GossipState, viewer: number, member: number): void {
  const base = viewer * state.options.capacity;
  const length = state.viewLen[viewer]!;
  for (let i = 0; i < length; i += 1) {
    if (state.viewIds[base + i] !== member) continue;
    state.viewIds.copyWithin(base + i, base + i + 1, base + length);
    state.viewTs.copyWithin(base + i, base + i + 1, base + length);
    state.viewLen[viewer] = length - 1;
    return;
  }
}

/**
 * The cards `sender` offers `receiver`: its own fresh card plus the best of what the receiver is
 * missing (or holds a much older copy of), by the receiver's ranking when the sender can compute
 * it ('public-hash') and by distance with a random tie-break when it cannot ('secret-salt').
 */
function offer(state: GossipState, sender: number, receiver: number): { ids: Int32Array; ts: Int32Array; count: number } {
  const { swapCards: k, capacity, refreshRounds } = state.options;
  const ids = new Int32Array(k);
  const ts = new Int32Array(k);
  ids[0] = sender;
  ts[0] = state.round;
  let count = 1;

  // The receiver's digest: which cards it holds and how fresh they are.
  state.stamp += 1;
  const stamp = state.stamp;
  const receiverBase = receiver * capacity;
  for (let i = 0; i < state.viewLen[receiver]!; i += 1) {
    const id = state.viewIds[receiverBase + i]!;
    state.mark[id] = stamp;
    state.markPos[id] = state.viewTs[receiverBase + i]!;
  }
  const wanted = (id: number, at: number) => id !== receiver && id !== sender
    && (state.mark[id] !== stamp || at - state.markPos[id]! >= refreshRounds);

  // A hostile sender withholds every honest card and pushes only fellow fake accounts, freshly
  // signed, ranked the way the victim would rank them whenever it can compute that.
  const hostile = state.sybil[sender] === 1;
  const pool = hostile ? sybilList(state) : null;
  const poolLength = pool ? pool.length : state.viewLen[sender]!;
  const senderBase = sender * capacity;
  const swapSalt = Math.floor(state.random() * 4_294_967_296) >>> 0;
  const bestKey = new Float64Array(k - 1).fill(Number.POSITIVE_INFINITY);
  const bestId = new Int32Array(k - 1).fill(-1);
  const bestTs = new Int32Array(k - 1);
  let filled = 0;
  for (let i = 0; i < poolLength; i += 1) {
    const id = pool ? pool[i]! : state.viewIds[senderBase + i]!;
    const at = pool ? state.round : state.viewTs[senderBase + i]!;
    if (!wanted(id, at)) continue;
    const key = state.options.variant === 'public-hash'
      ? rankKey(state, receiver, id)
      : cellDistance(state, receiver, id) * HASH_SPACE + (mix(swapSalt, state.identity[id]!) >>> 11);
    if (filled === k - 1 && key >= bestKey[k - 2]!) continue;
    let slot = filled < k - 1 ? filled : k - 2;
    while (slot > 0 && bestKey[slot - 1]! > key) {
      bestKey[slot] = bestKey[slot - 1]!;
      bestId[slot] = bestId[slot - 1]!;
      bestTs[slot] = bestTs[slot - 1]!;
      slot -= 1;
    }
    bestKey[slot] = key;
    bestId[slot] = id;
    bestTs[slot] = at;
    if (filled < k - 1) filled += 1;
  }
  for (let i = 0; i < filled; i += 1) {
    ids[count] = bestId[i]!;
    ts[count] = bestTs[i]!;
    count += 1;
  }
  return { ids, ts, count };
}

function sybilList(state: GossipState): number[] {
  if (state.sybilCacheRound !== state.round) {
    state.sybilCache = state.liveList.filter((index) => state.sybil[index]);
    state.sybilCacheRound = state.round;
  }
  return state.sybilCache;
}

/** One gossip period: every live person starts one swap with a random person from their list. */
export function gossipRound(state: GossipState): void {
  state.round += 1;
  const order = state.liveList.slice();
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(state.random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  for (const initiator of order) {
    let length = state.viewLen[initiator]!;
    if (length === 0) {
      bootstrap(state, initiator);
      length = state.viewLen[initiator]!;
      if (length === 0) continue;
    }
    const partner = state.viewIds[initiator * state.options.capacity + Math.floor(state.random() * length)]!;
    if (!state.live[partner]) {
      // A swap with someone who left times out; they drop off this list at once.
      state.failedContacts += 1;
      removeFromView(state, initiator, partner);
      merge(state, initiator, new Int32Array(0), new Int32Array(0), 0); // also drops expired cards
      continue;
    }
    const toPartner = offer(state, initiator, partner);
    const toInitiator = offer(state, partner, initiator);
    merge(state, partner, toPartner.ids, toPartner.ts, toPartner.count);
    merge(state, initiator, toInitiator.ids, toInitiator.ts, toInitiator.count);
    state.cardsSent += toPartner.count + toInitiator.count;
    state.swaps += 1;
  }
}

function quantile(sorted: ArrayLike<number>, q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

export type GossipViewMetrics = {
  viewers: number;
  /** View size / min(C, people − 1). */
  fill: number;
  /** Share of the true nearest-C distance band the list already covers (order-independent). */
  distanceQuality: number;
  /** Share of the viewer's exact first page (their own order) the list holds. */
  recall: number;
  /** Share of list entries whose owner has left. */
  stale: number;
  /** Share of honest lists taken by fake accounts. */
  sybilShare: number;
};

/** Pick viewers to score (honest, live), deterministically. */
export function sampleViewers(state: GossipState, count: number, filter: (index: number) => boolean = () => true): number[] {
  const random = seededRandom(state.options.seed + 99);
  const candidates = state.liveList.filter((index) => !state.sybil[index] && filter(index));
  return sample(candidates, count, random);
}

export function measureViews(state: GossipState, viewers: number[]): GossipViewMetrics {
  const { capacity } = state.options;
  const live = state.liveList;
  let fill = 0;
  let quality = 0;
  let recall = 0;
  let stale = 0;
  let sybil = 0;
  let scored = 0;
  const keys = new Float64Array(live.length);
  for (const viewer of viewers) {
    if (!state.live[viewer]) continue;
    let n = 0;
    for (const member of live) if (member !== viewer) keys[n++] = rankKey(state, viewer, member);
    const truthSize = Math.min(capacity, n);
    if (truthSize === 0) continue;
    const sorted = keys.subarray(0, n).slice().sort();
    const cutoffKey = sorted[truthSize - 1]!;
    const cutoffDistance = Math.floor(cutoffKey / HASH_SPACE);
    const base = viewer * capacity;
    const length = state.viewLen[viewer]!;
    let inBand = 0;
    let inTruth = 0;
    let gone = 0;
    let fake = 0;
    for (let i = 0; i < length; i += 1) {
      const member = state.viewIds[base + i]!;
      if (!state.live[member]) {
        gone += 1;
        continue;
      }
      if (state.sybil[member]) fake += 1;
      if (cellDistance(state, viewer, member) <= cutoffDistance) inBand += 1;
      if (rankKey(state, viewer, member) <= cutoffKey) inTruth += 1;
    }
    fill += Math.min(1, length / truthSize);
    quality += Math.min(1, inBand / truthSize);
    recall += Math.min(1, inTruth / truthSize);
    stale += length ? gone / length : 0;
    sybil += length ? fake / length : 0;
    scored += 1;
  }
  const mean = (value: number) => (scored ? Math.round((1000 * value) / scored) / 1000 : 0);
  return {
    viewers: scored,
    fill: mean(fill),
    distanceQuality: mean(quality),
    recall: mean(recall),
    stale: mean(stale),
    sybilShare: mean(sybil),
  };
}

/**
 * How many lists each live person is on: the number of people whose broadcast loop will reach
 * them. A list's size bounds what a person sends; this bounds what they receive.
 */
export function measureAudience(state: GossipState): { mean: number; p50: number; p99: number; max: number } {
  const { capacity } = state.options;
  const counts = new Int32Array(state.joined);
  for (const viewer of state.liveList) {
    const base = viewer * capacity;
    for (let i = 0; i < state.viewLen[viewer]!; i += 1) counts[state.viewIds[base + i]!]! += 1;
  }
  const liveCounts = Int32Array.from(state.liveList.filter((index) => !state.sybil[index]), (index) => counts[index]!).sort();
  const total = liveCounts.reduce((sum, value) => sum + value, 0);
  return {
    mean: liveCounts.length ? Math.round(total / liveCounts.length) : 0,
    p50: quantile(liveCounts, 0.5),
    p99: quantile(liveCounts, 0.99),
    max: liveCounts.length ? liveCounts[liveCounts.length - 1]! : 0,
  };
}
