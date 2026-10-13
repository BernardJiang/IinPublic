import type { RoomProtocolCheckpoint } from './active-exchange-room';
import {
  nearbyControlScopeId,
  type NearbyControlPresence,
  verifyNearbyControlPresence,
} from './nearby-control-presence';
import {
  nearbyBasePrecisionMeters,
  projectNearbyCoordinate,
  type NearbyPublicMode,
  type NearbyRoomAssignment,
} from './nearby-rooms';
import {
  maximumNearbyPartitionGeographicDepth,
  nearbyPartitionDisplayGeometry,
  nearbyPartitionProjectedPrivacyFloorMeters,
} from './nearby-partition-geometry';
import { canonicalSerialize } from './p2p-runtime';
import { portableSha256Hex } from './portable-sha256';
import type { GPSCoordinate } from './types';

/**
 * Flat adaptive Nearby partition control.
 *
 * A group is an immutable room instance covering one quadtree path. Repartitioning never mutates
 * that group or exposes a parent/child room hierarchy: it publishes a content-addressed transition
 * that replaces the old flat group(s) with new flat group(s). Unique room instances prevent a
 * cached split from looping after its four children later coalesce and split again.
 */
export const NEARBY_PARTITION_VERSION = 1;
export const NEARBY_PARTITION_MAX_DEPTH = 24;
export const NEARBY_PARTITION_MAX_CHAIN = 128;
export const NEARBY_PARTITION_MERGE_DWELL_MS = 3 * 60_000;

const EARTH_RADIUS_METERS = 6_378_137;
const WORLD_HALF_WIDTH_METERS = Math.PI * EARTH_RADIUS_METERS;
const PARTITION_DOMAIN = 'iinpublic:nearby-partition:v1';

export type NearbyPartitionGroup = {
  roomId: string;
  /** Quadtree address only in signed control. It is not shown as a room hierarchy. */
  path: string;
};

export type NearbyPartitionSplitEvidence = {
  kind: 'capacity-overflow';
  witnesses: NearbyControlPresence[];
};

export type NearbyPartitionCoalesceEvidence = {
  kind: 'stable-low-occupancy';
  dwellStartedAt: string;
  dwellEndedAt: string;
  startWitnesses: NearbyControlPresence[];
  endWitnesses: NearbyControlPresence[];
};

export type NearbyPartitionTransition = {
  version: 1;
  kind: 'replace-group-with-groups' | 'coalesce-adjacent-groups';
  checkpoint: RoomProtocolCheckpoint;
  rootRoomId: string;
  createdAt: string;
  replacementSeed: string;
  fromGroups: NearbyPartitionGroup[];
  toGroups: NearbyPartitionGroup[];
  evidence: NearbyPartitionSplitEvidence | NearbyPartitionCoalesceEvidence;
  /**
   * Balanced identity lanes (splits only). Below a member's privacy floor, location cannot divide the
   * group, so members split by a lane hash: below this threshold → child "0", otherwise → "1".
   * It is the median hash over the split's own witnesses, so the witnesses divide about half and half
   * and anyone can re-derive it from the evidence. Absent on older splits (legacy 1-in-4 lanes).
   */
  laneThreshold?: string;
  transitionId: string;
};

export type VerifiedNearbyPartitionTransition = NearbyPartitionTransition & {
  readonly __verifiedNearbyPartitionTransition: true;
};

function sameCheckpoint(left: RoomProtocolCheckpoint, right: RoomProtocolCheckpoint): boolean {
  return left.networkId === right.networkId
    && left.protocolEpoch === right.protocolEpoch
    && left.manifestSequence === right.manifestSequence
    && left.manifestHash === right.manifestHash
    && left.chatroomCapacity === right.chatroomCapacity;
}

function checkpointKey(checkpoint: RoomProtocolCheckpoint): string {
  return [
    checkpoint.networkId,
    checkpoint.protocolEpoch,
    checkpoint.manifestSequence,
    checkpoint.manifestHash,
    checkpoint.chatroomCapacity,
  ].join(':');
}

/**
 * The root is a rendezvous point where compatible releases can exchange a newer signed manifest.
 * Binding it to manifestSequence/manifestHash creates a chicken-and-egg split: the old release
 * cannot meet the new release to learn the very manifest that would make their checkpoints equal.
 * Child transitions remain bound to the complete checkpoint through checkpointKey().
 */
function rootRendezvousKey(checkpoint: RoomProtocolCheckpoint): string {
  return [checkpoint.networkId, checkpoint.protocolEpoch].join(':');
}

export function nearbyPartitionRootGroup(checkpoint: RoomProtocolCheckpoint): NearbyPartitionGroup {
  const digest = portableSha256Hex(`${PARTITION_DOMAIN}:root:${rootRendezvousKey(checkpoint)}`).slice(0, 24);
  return {
    roomId: `nearby_v2_e${checkpoint.protocolEpoch}_${digest}`,
    path: '',
  };
}

function assertPath(path: string): void {
  if (!/^[0-3]{0,24}$/.test(path)) throw new Error('Nearby partition path is invalid');
}

function groupRoomId(checkpoint: RoomProtocolCheckpoint, path: string, seed: string): string {
  assertPath(path);
  const digest = portableSha256Hex([
    PARTITION_DOMAIN,
    checkpointKey(checkpoint),
    path || 'root',
    seed,
  ].join(':')).slice(0, 24);
  return `nearby_v2_e${checkpoint.protocolEpoch}_${digest}`;
}

function childPaths(path: string): string[] {
  if (path.length >= NEARBY_PARTITION_MAX_DEPTH) throw new Error('Nearby partition depth exhausted');
  return ['0', '1', '2', '3'].map((quadrant) => `${path}${quadrant}`);
}

/** A member's lane hash at one group: fresh per group path, so each lane split rebalances. */
export function nearbyPartitionLaneKey(identity: string, groupPath: string): string {
  return portableSha256Hex(`${PARTITION_DOMAIN}:balanced-lane:${groupPath}:${identity}`);
}

/** Median lane hash of the witnesses: the lower half goes to lane "0", the rest to lane "1". */
export function balancedLaneThreshold(witnessPubs: readonly string[], groupPath: string): string {
  const keys = [...new Set(witnessPubs)].map((pub) => nearbyPartitionLaneKey(pub, groupPath)).sort();
  return keys[Math.floor(keys.length / 2)] ?? 'f'.repeat(64);
}

function transitionPayload(transition: Omit<NearbyPartitionTransition, 'transitionId'>): unknown {
  return {
    ...(transition.laneThreshold ? { laneThreshold: transition.laneThreshold } : {}),
    type: 'iinpublic-nearby-partition-transition-v1',
    version: transition.version,
    kind: transition.kind,
    checkpoint: transition.checkpoint,
    rootRoomId: transition.rootRoomId,
    createdAt: transition.createdAt,
    replacementSeed: transition.replacementSeed,
    fromGroups: transition.fromGroups,
    toGroups: transition.toGroups,
    evidence: transition.evidence,
  };
}

function transitionIdFor(transition: Omit<NearbyPartitionTransition, 'transitionId'>): string {
  return portableSha256Hex(canonicalSerialize(transitionPayload(transition)));
}

function replacementSeedFor(input: {
  kind: NearbyPartitionTransition['kind'];
  checkpoint: RoomProtocolCheckpoint;
  createdAt: string;
  fromGroups: NearbyPartitionGroup[];
  evidence: NearbyPartitionTransition['evidence'];
}): string {
  return portableSha256Hex(canonicalSerialize({
    domain: `${PARTITION_DOMAIN}:replacement`,
    ...input,
  }));
}

export function createNearbyPartitionSplit(input: {
  checkpoint: RoomProtocolCheckpoint;
  fromGroup: NearbyPartitionGroup;
  witnesses: NearbyControlPresence[];
  createdAt?: string;
}): NearbyPartitionTransition {
  assertPath(input.fromGroup.path);
  const createdAt = input.createdAt ?? new Date().toISOString();
  const evidence: NearbyPartitionSplitEvidence = {
    kind: 'capacity-overflow',
    witnesses: [...input.witnesses],
  };
  const replacementSeed = replacementSeedFor({
    kind: 'replace-group-with-groups',
    checkpoint: input.checkpoint,
    createdAt,
    fromGroups: [input.fromGroup],
    evidence,
  });
  const unsigned: Omit<NearbyPartitionTransition, 'transitionId'> = {
    version: 1,
    kind: 'replace-group-with-groups',
    checkpoint: { ...input.checkpoint },
    rootRoomId: nearbyPartitionRootGroup(input.checkpoint).roomId,
    createdAt,
    replacementSeed,
    fromGroups: [{ ...input.fromGroup }],
    toGroups: childPaths(input.fromGroup.path).map((path) => ({
      path,
      roomId: groupRoomId(input.checkpoint, path, replacementSeed),
    })),
    evidence,
    laneThreshold: balancedLaneThreshold(input.witnesses.map((witness) => witness.pub), input.fromGroup.path),
  };
  return { ...unsigned, transitionId: transitionIdFor(unsigned) };
}

export function createNearbyPartitionCoalesce(input: {
  checkpoint: RoomProtocolCheckpoint;
  fromGroups: NearbyPartitionGroup[];
  startWitnesses: NearbyControlPresence[];
  endWitnesses: NearbyControlPresence[];
  dwellStartedAt: string;
  dwellEndedAt: string;
  createdAt?: string;
}): NearbyPartitionTransition {
  const fromGroups = [...input.fromGroups].sort((a, b) => a.path.localeCompare(b.path));
  if (fromGroups.length !== 4) throw new Error('Nearby coalescing requires four sibling groups');
  fromGroups.forEach((group) => assertPath(group.path));
  const parentPath = fromGroups[0]!.path.slice(0, -1);
  const createdAt = input.createdAt ?? input.dwellEndedAt;
  const evidence: NearbyPartitionCoalesceEvidence = {
    kind: 'stable-low-occupancy',
    dwellStartedAt: input.dwellStartedAt,
    dwellEndedAt: input.dwellEndedAt,
    startWitnesses: [...input.startWitnesses],
    endWitnesses: [...input.endWitnesses],
  };
  const replacementSeed = replacementSeedFor({
    kind: 'coalesce-adjacent-groups',
    checkpoint: input.checkpoint,
    createdAt,
    fromGroups,
    evidence,
  });
  const unsigned: Omit<NearbyPartitionTransition, 'transitionId'> = {
    version: 1,
    kind: 'coalesce-adjacent-groups',
    checkpoint: { ...input.checkpoint },
    rootRoomId: nearbyPartitionRootGroup(input.checkpoint).roomId,
    createdAt,
    replacementSeed,
    fromGroups,
    toGroups: [{
      path: parentPath,
      roomId: groupRoomId(input.checkpoint, parentPath, replacementSeed),
    }],
    evidence,
  };
  return { ...unsigned, transitionId: transitionIdFor(unsigned) };
}

function parseGroup(value: unknown): NearbyPartitionGroup | null {
  if (!value || typeof value !== 'object') return null;
  const group = value as Partial<NearbyPartitionGroup>;
  if (typeof group.roomId !== 'string'
    || !/^nearby_v2_e\d+_[a-f0-9]{24}$/.test(group.roomId)
    || typeof group.path !== 'string'
    || !/^[0-3]{0,24}$/.test(group.path)) return null;
  return group as NearbyPartitionGroup;
}

export function parseNearbyPartitionTransition(value: unknown): NearbyPartitionTransition | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<NearbyPartitionTransition>;
  if (record.version !== 1
    || (record.kind !== 'replace-group-with-groups' && record.kind !== 'coalesce-adjacent-groups')
    || !record.checkpoint
    || typeof record.rootRoomId !== 'string'
    || typeof record.createdAt !== 'string'
    || !Number.isFinite(Date.parse(record.createdAt))
    || typeof record.replacementSeed !== 'string'
    || !/^[a-f0-9]{64}$/.test(record.replacementSeed)
    || !Array.isArray(record.fromGroups)
    || !Array.isArray(record.toGroups)
    || !record.evidence
    || typeof record.transitionId !== 'string'
    || !/^[a-f0-9]{64}$/.test(record.transitionId)
    || (record.laneThreshold !== undefined
      && (typeof record.laneThreshold !== 'string' || !/^[a-f0-9]{64}$/.test(record.laneThreshold)))) return null;
  const fromGroups = record.fromGroups.map(parseGroup);
  const toGroups = record.toGroups.map(parseGroup);
  if (fromGroups.some((group) => !group) || toGroups.some((group) => !group)) return null;
  return record as NearbyPartitionTransition;
}

async function verifyPresenceSet(input: {
  witnesses: NearbyControlPresence[];
  checkpoint: RoomProtocolCheckpoint;
  rootRoomId: string;
  allowedRoomIds: Set<string>;
  at?: Date;
}): Promise<{ ok: true; pubs: Set<string> } | { ok: false; reason: string }> {
  const pubs = new Set<string>();
  for (const witness of input.witnesses) {
    const at = input.at ?? new Date(Date.parse(witness.observedAt) + 1);
    const verification = await verifyNearbyControlPresence(witness, {
      expectedCheckpoint: input.checkpoint,
      at,
    });
    if (!verification.ok) return { ok: false, reason: verification.reason };
    const record = verification.record;
    if (record.rootRoomId !== input.rootRoomId
      || record.controlScopeId !== nearbyControlScopeId(input.rootRoomId)
      || !input.allowedRoomIds.has(record.roomId)) {
      return { ok: false, reason: 'partition witness belongs to another group' };
    }
    if (pubs.has(record.pub)) return { ok: false, reason: 'duplicate partition witness identity' };
    pubs.add(record.pub);
  }
  return { ok: true, pubs };
}

export async function verifyNearbyPartitionTransition(
  value: unknown,
  expectedCheckpoint: RoomProtocolCheckpoint,
): Promise<
  | { ok: true; transition: VerifiedNearbyPartitionTransition }
  | { ok: false; reason: string }
> {
  const transition = parseNearbyPartitionTransition(value);
  if (!transition) return { ok: false, reason: 'malformed Nearby partition transition' };
  if (!sameCheckpoint(transition.checkpoint, expectedCheckpoint)) {
    return { ok: false, reason: 'Nearby partition checkpoint mismatch' };
  }
  if (transition.rootRoomId !== nearbyPartitionRootGroup(expectedCheckpoint).roomId) {
    return { ok: false, reason: 'wrong Nearby partition root' };
  }
  const unsigned: Omit<NearbyPartitionTransition, 'transitionId'> = {
    version: transition.version,
    kind: transition.kind,
    checkpoint: transition.checkpoint,
    rootRoomId: transition.rootRoomId,
    createdAt: transition.createdAt,
    replacementSeed: transition.replacementSeed,
    fromGroups: transition.fromGroups,
    toGroups: transition.toGroups,
    evidence: transition.evidence,
    ...(transition.laneThreshold ? { laneThreshold: transition.laneThreshold } : {}),
  };
  if (transition.transitionId !== transitionIdFor(unsigned)) {
    return { ok: false, reason: 'Nearby partition transition hash mismatch' };
  }
  const expectedSeed = replacementSeedFor({
    kind: transition.kind,
    checkpoint: transition.checkpoint,
    createdAt: transition.createdAt,
    fromGroups: transition.fromGroups,
    evidence: transition.evidence,
  });
  if (transition.replacementSeed !== expectedSeed) {
    return { ok: false, reason: 'Nearby partition replacement seed mismatch' };
  }

  if (transition.kind === 'replace-group-with-groups') {
    if (transition.evidence.kind !== 'capacity-overflow'
      || transition.fromGroups.length !== 1
      || transition.toGroups.length !== 4) {
      return { ok: false, reason: 'invalid Nearby split shape' };
    }
    if (transition.laneThreshold !== undefined
      && transition.laneThreshold !== balancedLaneThreshold(
        transition.evidence.witnesses.map((witness) => witness.pub),
        transition.fromGroups[0]!.path,
      )) {
      return { ok: false, reason: 'Nearby split lane threshold does not match its witnesses' };
    }
    const from = transition.fromGroups[0]!;
    const expectedPaths = childPaths(from.path);
    for (let index = 0; index < expectedPaths.length; index += 1) {
      const path = expectedPaths[index]!;
      const group = transition.toGroups[index];
      if (!group || group.path !== path
        || group.roomId !== groupRoomId(expectedCheckpoint, path, transition.replacementSeed)) {
        return { ok: false, reason: 'invalid Nearby split replacement group' };
      }
    }
    if (transition.evidence.witnesses.length !== expectedCheckpoint.chatroomCapacity + 1) {
      return { ok: false, reason: 'Nearby split requires capacity plus one witnesses' };
    }
    const verified = await verifyPresenceSet({
      witnesses: transition.evidence.witnesses,
      checkpoint: expectedCheckpoint,
      rootRoomId: transition.rootRoomId,
      allowedRoomIds: new Set([from.roomId]),
      at: new Date(transition.createdAt),
    });
    if (!verified.ok) return verified;
    if (transition.evidence.witnesses.some((witness) =>
      witness.requestedSplitGeneration !== from.path.length)) {
      return { ok: false, reason: 'Nearby split witness has the wrong partition depth' };
    }
  } else {
    if (transition.evidence.kind !== 'stable-low-occupancy'
      || transition.fromGroups.length !== 4
      || transition.toGroups.length !== 1) {
      return { ok: false, reason: 'invalid Nearby coalescing shape' };
    }
    const sorted = [...transition.fromGroups].sort((a, b) => a.path.localeCompare(b.path));
    const parentPath = sorted[0]!.path.slice(0, -1);
    const expectedPaths = childPaths(parentPath);
    if (sorted.some((group, index) => group.path !== expectedPaths[index])) {
      return { ok: false, reason: 'Nearby coalescing groups are not siblings' };
    }
    const target = transition.toGroups[0]!;
    if (target.path !== parentPath
      || target.roomId !== groupRoomId(expectedCheckpoint, parentPath, transition.replacementSeed)) {
      return { ok: false, reason: 'invalid Nearby coalesced replacement group' };
    }
    const started = Date.parse(transition.evidence.dwellStartedAt);
    const ended = Date.parse(transition.evidence.dwellEndedAt);
    if (!Number.isFinite(started) || !Number.isFinite(ended)
      || ended - started < NEARBY_PARTITION_MERGE_DWELL_MS) {
      return { ok: false, reason: 'Nearby coalescing dwell is too short' };
    }
    const allowedRoomIds = new Set(sorted.map((group) => group.roomId));
    const start = await verifyPresenceSet({
      witnesses: transition.evidence.startWitnesses,
      checkpoint: expectedCheckpoint,
      rootRoomId: transition.rootRoomId,
      allowedRoomIds,
      at: new Date(started),
    });
    if (!start.ok) return start;
    const end = await verifyPresenceSet({
      witnesses: transition.evidence.endWitnesses,
      checkpoint: expectedCheckpoint,
      rootRoomId: transition.rootRoomId,
      allowedRoomIds,
      at: new Date(ended),
    });
    if (!end.ok) return end;
    if (start.pubs.size < 1
      || start.pubs.size > expectedCheckpoint.chatroomCapacity
      || start.pubs.size !== end.pubs.size
      || [...start.pubs].some((pub) => !end.pubs.has(pub))) {
      return { ok: false, reason: 'Nearby coalescing roster changed during dwell' };
    }
  }
  return {
    ok: true,
    transition: { ...transition, __verifiedNearbyPartitionTransition: true },
  };
}

function snappedProjectedPoint(location: GPSCoordinate, mode: NearbyPublicMode): { x: number; y: number } {
  const projected = projectNearbyCoordinate(location);
  const precision = nearbyPartitionProjectedPrivacyFloorMeters(location, mode);
  const snap = (value: number) => (Math.floor(value / precision) + 0.5) * precision;
  const limit = WORLD_HALF_WIDTH_METERS - 1;
  return {
    x: Math.max(-limit, Math.min(limit, snap(projected.x))),
    y: Math.max(-limit, Math.min(limit, snap(projected.y))),
  };
}

export function nearbyPartitionSelectorPath(
  location: GPSCoordinate,
  mode: NearbyPublicMode,
  depth: number,
  identity: string,
): string {
  const point = snappedProjectedPoint(location, mode);
  const precision = nearbyBasePrecisionMeters(mode);
  const geographicDepth = maximumNearbyPartitionGeographicDepth({
    location,
    mode,
    maximumDepth: NEARBY_PARTITION_MAX_DEPTH,
  });
  let minX = -WORLD_HALF_WIDTH_METERS;
  let maxX = WORLD_HALF_WIDTH_METERS;
  let minY = -WORLD_HALF_WIDTH_METERS;
  let maxY = WORLD_HALF_WIDTH_METERS;
  let path = '';
  const geographicDecisionCount = Math.min(depth, geographicDepth);
  for (let index = 0; index < geographicDecisionCount; index += 1) {
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const east = point.x >= midX;
    const north = point.y >= midY;
    path += north ? (east ? '3' : '2') : (east ? '1' : '0');
    if (east) minX = midX;
    else maxX = midX;
    if (north) minY = midY;
    else maxY = midY;
  }
  if (path.length < depth) {
    // Capacity-only choices bind to the already disclosed area, never to a finer snapped point.
    const identityDigest = portableSha256Hex(canonicalSerialize({
      domain: `${PARTITION_DOMAIN}:privacy-lane`,
      mode,
      precision,
      geographicPath: path,
      identity,
    }));
    while (path.length < depth) {
      const digestIndex = (path.length - geographicDecisionCount) % identityDigest.length;
      path += String(Number.parseInt(identityDigest[digestIndex]!, 16) % 4);
    }
  }
  return path;
}

/**
 * Which child of a split this member follows. Above the privacy floor: the geographic quadrant of
 * the declared location. Below it: the balanced lane (hash vs the split's threshold); a legacy split
 * without a threshold keeps the old 1-in-4 identity digit.
 */
function nextSplitPath(
  parentPath: string,
  transition: NearbyPartitionTransition,
  input: { location: GPSCoordinate; mode: NearbyPublicMode; identity?: string },
): string {
  const identity = String(input.identity || '');
  const geographicDepth = maximumNearbyPartitionGeographicDepth({
    location: input.location,
    mode: input.mode,
    maximumDepth: NEARBY_PARTITION_MAX_DEPTH,
  });
  if (parentPath.length >= geographicDepth && transition.laneThreshold) {
    return `${parentPath}${nearbyPartitionLaneKey(identity, parentPath) < transition.laneThreshold ? '0' : '1'}`;
  }
  return nearbyPartitionSelectorPath(input.location, input.mode, parentPath.length + 1, identity);
}

export function nearbyPartitionAssignment(input: {
  group: NearbyPartitionGroup;
  location: GPSCoordinate;
  mode: NearbyPublicMode;
  checkpoint: RoomProtocolCheckpoint;
}): NearbyRoomAssignment {
  const geometry = nearbyPartitionDisplayGeometry({
    path: input.group.path,
    location: input.location,
    mode: input.mode,
    maximumDepth: NEARBY_PARTITION_MAX_DEPTH,
  });
  const identityDepth = geometry.cohortDepth;
  const identityLaneCount = Math.min(1_048_576, 4 ** identityDepth);
  const identityLaneIndex = identityDepth > 0
    ? Number.parseInt(portableSha256Hex(`${PARTITION_DOMAIN}:room-lane:${input.group.roomId}`).slice(0, 12), 16)
      % identityLaneCount
    : 0;
  return {
    version: 1,
    kind: 'nearby',
    roomId: input.group.roomId,
    mode: input.mode,
    protocolEpoch: input.checkpoint.protocolEpoch,
    basePrecisionMeters: nearbyBasePrecisionMeters(input.mode),
    wideningLevel: 0,
    widenedPrecisionMeters: nearbyBasePrecisionMeters(input.mode),
    splitGeneration: geometry.geographicDepth,
    requestedSplitGeneration: input.group.path.length,
    cellSizeMeters: geometry.cellSizeMeters,
    approximateDiameterMeters: geometry.approximateDiameterMeters,
    identityLaneCount,
    identityLaneIndex,
    localCell: geometry.localCell,
  };
}

/** Resolve only the transition lineage needed by this point; unrelated groups are never read. */
export async function applyNearbyPartitionTransitions(input: {
  location: GPSCoordinate;
  mode: NearbyPublicMode;
  /** Stable SEA public identity; used only for final load shedding below the privacy floor. */
  identity?: string;
  checkpoint: RoomProtocolCheckpoint;
  transitions: unknown[];
  /** Optional per-client cache; verified immutable transitions never need repeated SEA checks. */
  verificationCache?: Map<string, VerifiedNearbyPartitionTransition>;
}): Promise<{
  assignment: NearbyRoomAssignment;
  group: NearbyPartitionGroup;
  accepted: VerifiedNearbyPartitionTransition[];
}> {
  let group = nearbyPartitionRootGroup(input.checkpoint);
  const accepted: VerifiedNearbyPartitionTransition[] = [];
  const candidates = input.transitions.slice(0, NEARBY_PARTITION_MAX_CHAIN);
  const verifiedCandidates: VerifiedNearbyPartitionTransition[] = [];
  for (const candidate of candidates) {
    const parsed = parseNearbyPartitionTransition(candidate);
    if (!parsed) continue;
    const cacheKey = `${input.checkpoint.manifestHash}:${parsed.transitionId}`;
    const cached = input.verificationCache?.get(cacheKey);
    if (cached) {
      verifiedCandidates.push(cached);
      continue;
    }
    const verification = await verifyNearbyPartitionTransition(parsed, input.checkpoint);
    if (verification.ok) {
      verifiedCandidates.push(verification.transition);
      if (input.verificationCache) {
        if (input.verificationCache.size >= NEARBY_PARTITION_MAX_CHAIN * 2) {
          const oldest = input.verificationCache.keys().next().value as string | undefined;
          if (oldest) input.verificationCache.delete(oldest);
        }
        input.verificationCache.set(cacheKey, verification.transition);
      }
    }
  }
  verifiedCandidates.sort((left, right) =>
    Date.parse(left.createdAt) - Date.parse(right.createdAt)
    || left.transitionId.localeCompare(right.transitionId));
  const canonicalByFromRoom = new Map<string, VerifiedNearbyPartitionTransition>();
  for (const transition of verifiedCandidates) {
    for (const from of transition.fromGroups) {
      if (!canonicalByFromRoom.has(from.roomId)) canonicalByFromRoom.set(from.roomId, transition);
    }
  }
  const seen = new Set<string>();
  for (let step = 0; step < NEARBY_PARTITION_MAX_CHAIN; step += 1) {
    const next = verifiedCandidates.find((transition) =>
      !seen.has(transition.transitionId)
      && transition.fromGroups.some((from) => from.roomId === group.roomId)
      && transition.fromGroups.every((from) =>
        canonicalByFromRoom.get(from.roomId)?.transitionId === transition.transitionId)) ?? null;
    if (!next) break;
    seen.add(next.transitionId);
    accepted.push(next);
    if (next.kind === 'coalesce-adjacent-groups') {
      group = next.toGroups[0]!;
    } else {
      const wantedPath = nextSplitPath(group.path, next, input);
      const replacement = next.toGroups.find((candidate) => candidate.path === wantedPath);
      if (!replacement) throw new Error('Nearby split does not cover the declared location');
      group = replacement;
    }
  }
  return {
    group,
    assignment: nearbyPartitionAssignment({
      group,
      location: input.location,
      mode: input.mode,
      checkpoint: input.checkpoint,
    }),
    accepted,
  };
}
