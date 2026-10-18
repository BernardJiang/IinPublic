/**
 * Capacity experiment model for adaptive Nearby (TODO OPEN-40 "Capacity experiment"). It follows
 * the production rules exactly where they decide who meets whom:
 *   - a member's child at each split is src/shared/nearby-partition.ts nextSplitPath (geographic
 *     quadrant above the privacy floor, balanced identity lane below it);
 *   - a group splits when C + 1 members are present (src/server/services/nearby-partition-store.ts),
 *     with the lane threshold taken from those C + 1 witnesses;
 *   - four sibling groups coalesce when together they hold at most C for the merge dwell;
 *   - direct links come from src/shared/direct-talk-scheduler.ts selectDirectTalkPeers.
 * What it leaves out: signatures, presence expiry and network timing. One "pass" is one merge dwell
 * (NEARBY_PARTITION_MERGE_DWELL_MS); splits happen within a pass, as soon as C + 1 are present.
 */
import { selectDirectTalkPeers } from '../../shared/direct-talk-scheduler';
import {
  balancedLaneThreshold,
  NEARBY_PARTITION_MAX_DEPTH,
  nextSplitPath,
  type NearbyPartitionTransition,
} from '../../shared/nearby-partition';
import { nearbyPartitionDisplayGeometry } from '../../shared/nearby-partition-geometry';
import type { NearbyPublicMode } from '../../shared/nearby-rooms';
import type { GPSCoordinate } from '../../shared/types';

export type ModelUser = { id: string; location: GPSCoordinate; path: string; moves: number };

export type ModelState = {
  capacity: number;
  mode: NearbyPublicMode;
  users: ModelUser[];
  /** Active (leaf) group paths → member indexes. */
  leaves: Map<string, Set<number>>;
  splits: number;
  coalesces: number;
  /** Groups that reached C + 1 at the maximum depth and could not split (a real overflow). */
  stuck: number;
};

const TIMESTAMP = new Date('2026-10-17T12:00:00.000Z');

/** A tiny deterministic PRNG (mulberry32), so every run of the experiment is identical. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function gaussian(random: () => number): number {
  const u = Math.max(random(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

export function pointNear(center: { latitude: number; longitude: number }, sigmaMeters: number, random: () => number): GPSCoordinate {
  const metersPerDegree = 111_320;
  const latitude = center.latitude + (gaussian(random) * sigmaMeters) / metersPerDegree;
  const longitude = center.longitude
    + (gaussian(random) * sigmaMeters) / (metersPerDegree * Math.cos((center.latitude * Math.PI) / 180));
  return {
    latitude: Math.max(-84, Math.min(84, latitude)),
    longitude: ((longitude + 540) % 360) - 180,
    accuracy: 10,
    timestamp: TIMESTAMP,
  };
}

export function newModel(locations: GPSCoordinate[], capacity: number, mode: NearbyPublicMode = 'neighborhood'): ModelState {
  const users = locations.map((location, index) => ({ id: `pub-${String(index).padStart(7, '0')}`, location, path: '', moves: 0 }));
  return { capacity, mode, users, leaves: new Map([['', new Set(users.map((_, index) => index))]]), splits: 0, coalesces: 0, stuck: 0 };
}

/** Split every group above C until none is (the C + 1 certificate fires on each arrival). */
export function settleSplits(state: ModelState): void {
  const queue = [...state.leaves.keys()].filter((path) => (state.leaves.get(path)?.size ?? 0) > state.capacity);
  while (queue.length) {
    const path = queue.pop()!;
    const members = state.leaves.get(path);
    if (!members || members.size <= state.capacity) continue;
    if (path.length >= NEARBY_PARTITION_MAX_DEPTH) {
      state.stuck += 1;
      continue;
    }
    // The certificate's witnesses are the C + 1 present members (here: the lowest pubs, deterministic).
    const witnesses = [...members].slice(0, state.capacity + 1).map((index) => state.users[index]!.id);
    const transition = { laneThreshold: balancedLaneThreshold(witnesses, path) } as NearbyPartitionTransition;
    state.leaves.delete(path);
    for (const quadrant of ['0', '1', '2', '3']) state.leaves.set(`${path}${quadrant}`, new Set());
    for (const index of members) {
      const user = state.users[index]!;
      const child = nextSplitPath(path, transition, { location: user.location, mode: state.mode, identity: user.id });
      user.path = child;
      user.moves += 1;
      state.leaves.get(child)!.add(index);
    }
    state.splits += 1;
    for (const quadrant of ['0', '1', '2', '3']) {
      if (state.leaves.get(`${path}${quadrant}`)!.size > state.capacity) queue.push(`${path}${quadrant}`);
    }
  }
}

/** One merge dwell: every set of four sibling leaves holding at most C together coalesces. */
export function coalescePass(state: ModelState): number {
  const parents = new Set<string>();
  for (const path of state.leaves.keys()) if (path.length > 0) parents.add(path.slice(0, -1));
  // Only sibling sets that were all leaves when the dwell began: a group formed by coalescing in
  // this pass starts its own dwell (a new merge window on the server), so each level takes a pass.
  const leavesAtStart = new Set(state.leaves.keys());
  let merged = 0;
  for (const parent of [...parents].sort((a, b) => b.length - a.length)) {
    const siblings = ['0', '1', '2', '3'].map((quadrant) => `${parent}${quadrant}`);
    if (!siblings.every((path) => leavesAtStart.has(path) && state.leaves.has(path))) continue;
    const total = siblings.reduce((sum, path) => sum + state.leaves.get(path)!.size, 0);
    if (total > state.capacity) continue;
    const members = new Set<number>();
    for (const path of siblings) {
      for (const index of state.leaves.get(path)!) {
        members.add(index);
        state.users[index]!.path = parent;
        state.users[index]!.moves += 1;
      }
      state.leaves.delete(path);
    }
    state.leaves.set(parent, members);
    state.coalesces += 1;
    merged += 1;
  }
  return merged;
}

/** Remove members (they went offline); their groups stay until coalescing. */
export function removeUsers(state: ModelState, keep: (index: number) => boolean): void {
  for (const members of state.leaves.values()) {
    for (const index of [...members]) if (!keep(index)) members.delete(index);
  }
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

export type ModelMetrics = {
  users: number;
  rooms: number;
  emptyGroups: number;
  occupancy: { min: number; p50: number; p95: number; max: number };
  /** Share of users in rooms holding fewer than C / 4 people (fragmentation). */
  usersInSmallRoomsPct: number;
  /** Lineage depth = transitions a member reads to find its room. */
  controlReadsPerUser: { p50: number; p95: number; max: number };
  diameterMeters: { p50: number; p95: number; max: number };
  movesPerUser: { mean: number; max: number };
  controlWrites: { splits: number; coalesces: number };
  stuckOverflows: number;
};

export function measure(state: ModelState): ModelMetrics {
  const rooms = [...state.leaves.entries()].filter(([, members]) => members.size > 0);
  const occupancies = rooms.map(([, members]) => members.size).sort((a, b) => a - b);
  const depths: number[] = [];
  const moves: number[] = [];
  let users = 0;
  let inSmall = 0;
  for (const [, members] of rooms) {
    for (const index of members) {
      users += 1;
      depths.push(state.users[index]!.path.length);
      moves.push(state.users[index]!.moves);
      if (members.size < state.capacity / 4) inSmall += 1;
    }
  }
  depths.sort((a, b) => a - b);
  const diameters = rooms.map(([path, members]) => {
    const first = state.users[members.values().next().value as number]!;
    return nearbyPartitionDisplayGeometry({ path, location: first.location, mode: state.mode, maximumDepth: NEARBY_PARTITION_MAX_DEPTH }).approximateDiameterMeters;
  }).sort((a, b) => a - b);
  return {
    users,
    rooms: rooms.length,
    emptyGroups: state.leaves.size - rooms.length,
    occupancy: { min: occupancies[0] ?? 0, p50: quantile(occupancies, 0.5), p95: quantile(occupancies, 0.95), max: occupancies[occupancies.length - 1] ?? 0 },
    usersInSmallRoomsPct: users ? Math.round((1000 * inSmall) / users) / 10 : 0,
    controlReadsPerUser: { p50: quantile(depths, 0.5), p95: quantile(depths, 0.95), max: depths[depths.length - 1] ?? 0 },
    diameterMeters: { p50: Math.round(quantile(diameters, 0.5)), p95: Math.round(quantile(diameters, 0.95)), max: Math.round(diameters[diameters.length - 1] ?? 0) },
    movesPerUser: { mean: users ? Math.round((100 * moves.reduce((a, b) => a + b, 0)) / users) / 100 : 0, max: moves.reduce((a, b) => Math.max(a, b), 0) },
    controlWrites: { splits: state.splits, coalesces: state.coalesces },
    stuckOverflows: state.stuck,
  };
}

/** Direct links inside the given rooms: every choice reciprocated, none above K. */
export function checkDirectLinks(state: ModelState, k: number, sampleRooms: number): { rooms: number; maxLinks: number; asymmetric: number } {
  const rooms = [...state.leaves.values()].filter((members) => members.size > 1)
    .sort((a, b) => b.size - a.size).slice(0, sampleRooms);
  let maxLinks = 0;
  let asymmetric = 0;
  for (const members of rooms) {
    const ids = [...members].map((index) => state.users[index]!.id);
    const chosen = new Map(ids.map((id) => [id, new Set(selectDirectTalkPeers(ids, id, k, 0))]));
    for (const [id, peers] of chosen) {
      maxLinks = Math.max(maxLinks, peers.size);
      for (const peer of peers) if (!chosen.get(peer)?.has(id)) asymmetric += 1;
    }
  }
  return { rooms: rooms.length, maxLinks, asymmetric };
}
