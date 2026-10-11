import type { RoomProtocolCheckpoint } from './active-exchange-room';
import {
  NEARBY_PARTITION_MAX_DEPTH,
  parseNearbyPartitionTransition,
  verifyNearbyPartitionTransition,
  type NearbyPartitionTransition,
  type VerifiedNearbyPartitionTransition,
} from './nearby-partition';
import {
  type NearbyPublicMode,
} from './nearby-rooms';
import { maximumNearbyPartitionGeographicDepth } from './nearby-partition-geometry';
import {
  canonicalSerialize,
  createSignedP2PEnvelopeProof,
  ROOM_MEMBERSHIP_TTL_SECONDS,
  verifySignedP2PEnvelopeProof,
  type SeaSigningPair,
  type SignedP2PEnvelopeProof,
} from './p2p-runtime';
import { portableSha256Hex } from './portable-sha256';
import type { GPSCoordinate } from './types';

/**
 * Contract for visitable Nearby cohorts. Group 1 defines and verifies this wire shape; Group 2
 * owns persistence, admission, runtime switching, and migration from the existing v1 transition.
 */
export const NEARBY_COHORT_PROTOCOL_VERSION = 2;
export const NEARBY_COHORT_ROOM_SCHEMA_VERSION = 3;
export const NEARBY_MANUAL_SELECTION_TTL_MS = ROOM_MEMBERSHIP_TTL_SECONDS * 1_000;

const COHORT_DOMAIN = 'iinpublic:nearby-cohort-protocol:v2';
const ROOM_ID_PATTERN = /^nearby_v3_e\d+_[a-f0-9]{24}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

export type NearbyPartitionAddressV2 = {
  /** Spatial quadtree decisions. These must stop at the member's selected privacy floor. */
  geographicPath: string;
  /** Capacity-only binary decisions. These never claim a smaller geographic area. */
  cohortPath: string;
};

export type NearbyPartitionGroupV2 = {
  roomId: string;
  address: NearbyPartitionAddressV2;
};

export type NearbyPartitionAxisV2 = 'geographic' | 'cohort';

export type NearbyPartitionTransitionV2 = {
  version: 2;
  kind: 'nearby-partition-transition';
  axis: NearbyPartitionAxisV2;
  checkpoint: RoomProtocolCheckpoint;
  rootRoomId: string;
  createdAt: string;
  /** Digest of the signed C+1 evidence owned and checked by the Group 2 index. */
  evidenceHash: string;
  transitionSeed: string;
  fromGroup: NearbyPartitionGroupV2;
  toGroups: NearbyPartitionGroupV2[];
  transitionId: string;
};

export type VerifiedNearbyPartitionTransitionV2 = NearbyPartitionTransitionV2 & {
  readonly __verifiedNearbyPartitionTransitionV2: true;
};

export type NearbyPartitionTransitionAny = NearbyPartitionTransition | NearbyPartitionTransitionV2;
export type VerifiedNearbyPartitionTransitionAny =
  | VerifiedNearbyPartitionTransition
  | VerifiedNearbyPartitionTransitionV2;

export type NearbyMemberRouteV2 = {
  address: NearbyPartitionAddressV2;
  privacyGeographicDepth: number;
  geographicDepth: number;
  cohortDepth: number;
};

export type NearbyManualCohortSelection = {
  version: 2;
  kind: 'nearby-manual-cohort-selection';
  checkpoint: RoomProtocolCheckpoint;
  rootRoomId: string;
  userId: string;
  pub: string;
  privacyMode: NearbyPublicMode;
  /** Opaque binding to the unchanged disclosed area; contains no latitude or longitude. */
  areaBindingId: string;
  fromGroup: NearbyPartitionGroupV2;
  targetGroup: NearbyPartitionGroupV2;
  visitOrdinal: number;
  issuedAt: string;
  expiresAt: string;
  proof: SignedP2PEnvelopeProof;
};

export type VerifiedNearbyManualCohortSelection = NearbyManualCohortSelection & {
  readonly __verifiedNearbyManualCohortSelection: true;
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

function validCheckpoint(checkpoint: RoomProtocolCheckpoint | undefined): checkpoint is RoomProtocolCheckpoint {
  return !!checkpoint
    && typeof checkpoint.networkId === 'string'
    && checkpoint.networkId.length > 0
    && checkpoint.networkId.length <= 128
    && Number.isSafeInteger(checkpoint.protocolEpoch)
    && checkpoint.protocolEpoch > 0
    && Number.isSafeInteger(checkpoint.manifestSequence)
    && checkpoint.manifestSequence > 0
    && HASH_PATTERN.test(checkpoint.manifestHash)
    && Number.isSafeInteger(checkpoint.chatroomCapacity)
    && checkpoint.chatroomCapacity > 0
    && checkpoint.chatroomCapacity <= 1_000_000;
}

function validAddress(value: unknown): value is NearbyPartitionAddressV2 {
  if (!value || typeof value !== 'object') return false;
  const address = value as Partial<NearbyPartitionAddressV2> & { path?: unknown };
  return address.path == null
    && typeof address.geographicPath === 'string'
    && /^[0-3]{0,24}$/.test(address.geographicPath)
    && typeof address.cohortPath === 'string'
    && /^[01]{0,24}$/.test(address.cohortPath)
    && address.geographicPath.length + address.cohortPath.length <= NEARBY_PARTITION_MAX_DEPTH;
}

function parseGroup(value: unknown): NearbyPartitionGroupV2 | null {
  if (!value || typeof value !== 'object') return null;
  const group = value as Partial<NearbyPartitionGroupV2> & { path?: unknown };
  if (group.path != null
    || typeof group.roomId !== 'string'
    || !ROOM_ID_PATTERN.test(group.roomId)
    || !validAddress(group.address)) return null;
  return group as NearbyPartitionGroupV2;
}

function roomIdFor(
  checkpoint: RoomProtocolCheckpoint,
  address: NearbyPartitionAddressV2,
  transitionSeed: string,
): string {
  const digest = portableSha256Hex(canonicalSerialize({
    domain: `${COHORT_DOMAIN}:room`,
    checkpoint: checkpointKey(checkpoint),
    address,
    transitionSeed,
  })).slice(0, 24);
  return `nearby_v${NEARBY_COHORT_ROOM_SCHEMA_VERSION}_e${checkpoint.protocolEpoch}_${digest}`;
}

export function nearbyCohortRootGroup(
  checkpoint: RoomProtocolCheckpoint,
): NearbyPartitionGroupV2 {
  const address = { geographicPath: '', cohortPath: '' };
  return {
    address,
    roomId: roomIdFor(
      checkpoint,
      address,
      portableSha256Hex(`${COHORT_DOMAIN}:root:${checkpointKey(checkpoint)}`),
    ),
  };
}

function transitionSeedFor(input: {
  axis: NearbyPartitionAxisV2;
  checkpoint: RoomProtocolCheckpoint;
  rootRoomId: string;
  createdAt: string;
  evidenceHash: string;
  fromGroup: NearbyPartitionGroupV2;
}): string {
  return portableSha256Hex(canonicalSerialize({
    domain: `${COHORT_DOMAIN}:transition-seed`,
    ...input,
  }));
}

function transitionPayload(
  transition: Omit<NearbyPartitionTransitionV2, 'transitionId'>,
): unknown {
  return {
    type: 'iinpublic-nearby-partition-transition-v2',
    version: transition.version,
    kind: transition.kind,
    axis: transition.axis,
    checkpoint: transition.checkpoint,
    rootRoomId: transition.rootRoomId,
    createdAt: transition.createdAt,
    evidenceHash: transition.evidenceHash,
    transitionSeed: transition.transitionSeed,
    fromGroup: transition.fromGroup,
    toGroups: transition.toGroups,
  };
}

export function nearbyPartitionTransitionV2SigningPayload(
  transition: Omit<NearbyPartitionTransitionV2, 'transitionId'>,
): unknown {
  return transitionPayload(transition);
}

function transitionIdFor(transition: Omit<NearbyPartitionTransitionV2, 'transitionId'>): string {
  return portableSha256Hex(canonicalSerialize(transitionPayload(transition)));
}

function replacementAddresses(
  address: NearbyPartitionAddressV2,
  axis: NearbyPartitionAxisV2,
): NearbyPartitionAddressV2[] {
  const totalDepth = address.geographicPath.length + address.cohortPath.length;
  if (totalDepth >= NEARBY_PARTITION_MAX_DEPTH) {
    throw new Error('Nearby partition depth exhausted');
  }
  if (axis === 'geographic') {
    return ['0', '1', '2', '3'].map((quadrant) => ({
      geographicPath: `${address.geographicPath}${quadrant}`,
      cohortPath: address.cohortPath,
    }));
  }
  return ['0', '1'].map((lane) => ({
    geographicPath: address.geographicPath,
    cohortPath: `${address.cohortPath}${lane}`,
  }));
}

export function createNearbyPartitionTransitionV2(input: {
  axis: NearbyPartitionAxisV2;
  checkpoint: RoomProtocolCheckpoint;
  fromGroup: NearbyPartitionGroupV2;
  evidenceHash: string;
  createdAt?: string;
}): NearbyPartitionTransitionV2 {
  if (!validCheckpoint(input.checkpoint)) throw new Error('Nearby checkpoint is invalid');
  if (!parseGroup(input.fromGroup)) throw new Error('Nearby source group is invalid');
  if (!HASH_PATTERN.test(input.evidenceHash)) throw new Error('Nearby evidence hash is invalid');
  const createdAt = input.createdAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error('Nearby transition time is invalid');
  const rootRoomId = nearbyCohortRootGroup(input.checkpoint).roomId;
  const transitionSeed = transitionSeedFor({
    axis: input.axis,
    checkpoint: input.checkpoint,
    rootRoomId,
    createdAt,
    evidenceHash: input.evidenceHash,
    fromGroup: input.fromGroup,
  });
  const unsigned: Omit<NearbyPartitionTransitionV2, 'transitionId'> = {
    version: NEARBY_COHORT_PROTOCOL_VERSION,
    kind: 'nearby-partition-transition',
    axis: input.axis,
    checkpoint: { ...input.checkpoint },
    rootRoomId,
    createdAt,
    evidenceHash: input.evidenceHash,
    transitionSeed,
    fromGroup: input.fromGroup,
    toGroups: replacementAddresses(input.fromGroup.address, input.axis).map((address) => ({
      address,
      roomId: roomIdFor(input.checkpoint, address, transitionSeed),
    })),
  };
  return { ...unsigned, transitionId: transitionIdFor(unsigned) };
}

export function parseNearbyPartitionTransitionV2(
  value: unknown,
): NearbyPartitionTransitionV2 | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<NearbyPartitionTransitionV2> & {
    fromGroups?: unknown;
    replacementSeed?: unknown;
  };
  if (record.version !== NEARBY_COHORT_PROTOCOL_VERSION
    || record.kind !== 'nearby-partition-transition'
    || (record.axis !== 'geographic' && record.axis !== 'cohort')
    || record.fromGroups != null
    || record.replacementSeed != null
    || !validCheckpoint(record.checkpoint)
    || typeof record.rootRoomId !== 'string'
    || !ROOM_ID_PATTERN.test(record.rootRoomId)
    || typeof record.createdAt !== 'string'
    || !Number.isFinite(Date.parse(record.createdAt))
    || typeof record.evidenceHash !== 'string'
    || !HASH_PATTERN.test(record.evidenceHash)
    || typeof record.transitionSeed !== 'string'
    || !HASH_PATTERN.test(record.transitionSeed)
    || !parseGroup(record.fromGroup)
    || !Array.isArray(record.toGroups)
    || record.toGroups.some((group) => !parseGroup(group))
    || typeof record.transitionId !== 'string'
    || !HASH_PATTERN.test(record.transitionId)) return null;
  return record as NearbyPartitionTransitionV2;
}

export function parseNearbyPartitionTransitionAny(
  value: unknown,
): NearbyPartitionTransitionAny | null {
  if (!value || typeof value !== 'object') return null;
  const version = (value as { version?: unknown }).version;
  if (version === 1) return parseNearbyPartitionTransition(value);
  if (version === NEARBY_COHORT_PROTOCOL_VERSION) return parseNearbyPartitionTransitionV2(value);
  return null;
}

export async function verifyNearbyPartitionTransitionV2(
  value: unknown,
  expectedCheckpoint: RoomProtocolCheckpoint,
): Promise<
  | { ok: true; transition: VerifiedNearbyPartitionTransitionV2 }
  | { ok: false; reason: string }
> {
  const transition = parseNearbyPartitionTransitionV2(value);
  if (!transition) return { ok: false, reason: 'malformed Nearby v2 partition transition' };
  if (!sameCheckpoint(transition.checkpoint, expectedCheckpoint)) {
    return { ok: false, reason: 'Nearby partition checkpoint mismatch' };
  }
  if (transition.rootRoomId !== nearbyCohortRootGroup(expectedCheckpoint).roomId) {
    return { ok: false, reason: 'Nearby partition world root mismatch' };
  }
  const expectedSeed = transitionSeedFor({
    axis: transition.axis,
    checkpoint: transition.checkpoint,
    rootRoomId: transition.rootRoomId,
    createdAt: transition.createdAt,
    evidenceHash: transition.evidenceHash,
    fromGroup: transition.fromGroup,
  });
  if (transition.transitionSeed !== expectedSeed) {
    return { ok: false, reason: 'Nearby partition transition seed mismatch' };
  }
  const addresses = replacementAddresses(transition.fromGroup.address, transition.axis);
  if (transition.toGroups.length !== addresses.length
    || transition.toGroups.some((group, index) =>
      canonicalSerialize(group.address) !== canonicalSerialize(addresses[index])
      || group.roomId !== roomIdFor(expectedCheckpoint, addresses[index]!, transition.transitionSeed))) {
    return { ok: false, reason: 'Nearby partition replacement groups are invalid' };
  }
  const { transitionId: _transitionId, ...unsigned } = transition;
  if (transition.transitionId !== transitionIdFor(unsigned)) {
    return { ok: false, reason: 'Nearby partition transition hash mismatch' };
  }
  return {
    ok: true,
    transition: { ...transition, __verifiedNearbyPartitionTransitionV2: true },
  };
}

export async function verifyNearbyPartitionTransitionAny(
  value: unknown,
  expectedCheckpoint: RoomProtocolCheckpoint,
): Promise<
  | { ok: true; transition: VerifiedNearbyPartitionTransitionAny }
  | { ok: false; reason: string }
> {
  const parsed = parseNearbyPartitionTransitionAny(value);
  if (!parsed) return { ok: false, reason: 'unknown Nearby partition transition version' };
  return parsed.version === 1
    ? verifyNearbyPartitionTransition(parsed, expectedCheckpoint)
    : verifyNearbyPartitionTransitionV2(parsed, expectedCheckpoint);
}

export function nearbyPrivacyGeographicDepth(
  location: GPSCoordinate,
  mode: NearbyPublicMode,
): number {
  return maximumNearbyPartitionGeographicDepth({
    location,
    mode,
    maximumDepth: NEARBY_PARTITION_MAX_DEPTH,
  });
}

function hashBits(value: unknown, length: number): string {
  let material = '';
  let round = 0;
  while (material.length < length) {
    material += [...portableSha256Hex(canonicalSerialize({ value, round }))]
      .map((hex) => Number.parseInt(hex, 16).toString(2).padStart(4, '0'))
      .join('');
    round += 1;
  }
  return material.slice(0, length);
}

/**
 * Convert requested spatial decisions beyond this member's privacy floor into opaque cohort bits.
 * The result exposes no coordinate below the selected floor and is stable across reconnects.
 */
export function deriveNearbyMemberRouteV2(input: {
  geographicSelectorPath: string;
  requestedGeographicDepth: number;
  requestedCohortDepth: number;
  privacyMode: NearbyPublicMode;
  /** Exact coordinates remain local function input and never enter the returned wire address. */
  location: GPSCoordinate;
  identity: string;
  checkpoint: RoomProtocolCheckpoint;
  transitionSeed: string;
}): NearbyMemberRouteV2 {
  if (!/^[0-3]{0,24}$/.test(input.geographicSelectorPath)
    || !Number.isSafeInteger(input.requestedGeographicDepth)
    || input.requestedGeographicDepth < 0
    || input.requestedGeographicDepth > input.geographicSelectorPath.length
    || !Number.isSafeInteger(input.requestedCohortDepth)
    || input.requestedCohortDepth < 0
    || !input.identity
    || !validCheckpoint(input.checkpoint)
    || !HASH_PATTERN.test(input.transitionSeed)) {
    throw new Error('Nearby member route input is invalid');
  }
  const privacyGeographicDepth = nearbyPrivacyGeographicDepth(input.location, input.privacyMode);
  const geographicDepth = Math.min(input.requestedGeographicDepth, privacyGeographicDepth);
  const privacyFallbackDepth = input.requestedGeographicDepth - geographicDepth;
  const cohortDepth = input.requestedCohortDepth + privacyFallbackDepth;
  if (geographicDepth + cohortDepth > NEARBY_PARTITION_MAX_DEPTH) {
    throw new Error('Nearby member route exceeds the bounded partition depth');
  }
  const geographicPath = input.geographicSelectorPath.slice(0, geographicDepth);
  const cohortPath = hashBits({
    domain: `${COHORT_DOMAIN}:default-route`,
    checkpoint: checkpointKey(input.checkpoint),
    transitionSeed: input.transitionSeed,
    identity: input.identity,
    geographicPath,
  }, cohortDepth);
  return {
    address: { geographicPath, cohortPath },
    privacyGeographicDepth,
    geographicDepth,
    cohortDepth,
  };
}

export function nearbyAreaBindingId(input: {
  checkpoint: RoomProtocolCheckpoint;
  privacyMode: NearbyPublicMode;
  geographicPath: string;
}): string {
  if (!validCheckpoint(input.checkpoint) || !/^[0-3]{0,24}$/.test(input.geographicPath)) {
    throw new Error('Nearby area binding input is invalid');
  }
  return `nearby_area_${portableSha256Hex(canonicalSerialize({
    domain: `${COHORT_DOMAIN}:area-binding`,
    checkpoint: checkpointKey(input.checkpoint),
    privacyMode: input.privacyMode,
    geographicPath: input.geographicPath,
  })).slice(0, 24)}`;
}

export function nearbyManualCohortSelectionSigningPayload(
  selection: Omit<NearbyManualCohortSelection, 'proof'>,
): unknown {
  return {
    type: 'iinpublic-nearby-manual-cohort-selection-v2',
    version: selection.version,
    kind: selection.kind,
    checkpoint: selection.checkpoint,
    rootRoomId: selection.rootRoomId,
    userId: selection.userId,
    pub: selection.pub,
    privacyMode: selection.privacyMode,
    areaBindingId: selection.areaBindingId,
    fromGroup: selection.fromGroup,
    targetGroup: selection.targetGroup,
    visitOrdinal: selection.visitOrdinal,
    issuedAt: selection.issuedAt,
    expiresAt: selection.expiresAt,
  };
}

export async function createNearbyManualCohortSelection(input: {
  checkpoint: RoomProtocolCheckpoint;
  rootRoomId: string;
  userId: string;
  pair: SeaSigningPair;
  privacyMode: NearbyPublicMode;
  fromGroup: NearbyPartitionGroupV2;
  targetGroup: NearbyPartitionGroupV2;
  visitOrdinal: number;
  now?: Date;
}): Promise<NearbyManualCohortSelection> {
  if (!validCheckpoint(input.checkpoint)
    || input.rootRoomId !== nearbyCohortRootGroup(input.checkpoint).roomId
    || !parseGroup(input.fromGroup)
    || !parseGroup(input.targetGroup)
    || input.fromGroup.address.geographicPath !== input.targetGroup.address.geographicPath
    || input.fromGroup.address.cohortPath === input.targetGroup.address.cohortPath
    || input.fromGroup.address.cohortPath.length !== input.targetGroup.address.cohortPath.length
    || !Number.isSafeInteger(input.visitOrdinal)
    || input.visitOrdinal < 1) {
    throw new Error('Nearby manual cohort selection is invalid');
  }
  const now = input.now ?? new Date();
  const unsigned: Omit<NearbyManualCohortSelection, 'proof'> = {
    version: NEARBY_COHORT_PROTOCOL_VERSION,
    kind: 'nearby-manual-cohort-selection',
    checkpoint: { ...input.checkpoint },
    rootRoomId: input.rootRoomId,
    userId: String(input.userId || '').trim(),
    pub: String(input.pair.pub || '').trim(),
    privacyMode: input.privacyMode,
    areaBindingId: nearbyAreaBindingId({
      checkpoint: input.checkpoint,
      privacyMode: input.privacyMode,
      geographicPath: input.fromGroup.address.geographicPath,
    }),
    fromGroup: input.fromGroup,
    targetGroup: input.targetGroup,
    visitOrdinal: input.visitOrdinal,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + NEARBY_MANUAL_SELECTION_TTL_MS).toISOString(),
  };
  if (!unsigned.userId || !unsigned.pub) {
    throw new Error('Nearby manual cohort selection requires user id and public key');
  }
  const proof = await createSignedP2PEnvelopeProof({
    pair: input.pair,
    payload: nearbyManualCohortSelectionSigningPayload(unsigned),
    timestamp: unsigned.issuedAt,
  });
  return { ...unsigned, proof };
}

export function parseNearbyManualCohortSelection(
  value: unknown,
): NearbyManualCohortSelection | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<NearbyManualCohortSelection> & { path?: unknown };
  if (record.version !== NEARBY_COHORT_PROTOCOL_VERSION
    || record.kind !== 'nearby-manual-cohort-selection'
    || record.path != null
    || !validCheckpoint(record.checkpoint)
    || typeof record.rootRoomId !== 'string'
    || !ROOM_ID_PATTERN.test(record.rootRoomId)
    || typeof record.userId !== 'string'
    || !record.userId
    || record.userId.length > 256
    || typeof record.pub !== 'string'
    || !record.pub
    || record.pub.length > 2_048
    || !['regional', 'citywide', 'neighborhood', 'close-nearby'].includes(String(record.privacyMode))
    || typeof record.areaBindingId !== 'string'
    || !/^nearby_area_[a-f0-9]{24}$/.test(record.areaBindingId)
    || !parseGroup(record.fromGroup)
    || !parseGroup(record.targetGroup)
    || !Number.isSafeInteger(record.visitOrdinal)
    || Number(record.visitOrdinal) < 1
    || typeof record.issuedAt !== 'string'
    || !Number.isFinite(Date.parse(record.issuedAt))
    || typeof record.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(record.expiresAt))
    || !record.proof
    || record.proof.pub !== record.pub) return null;
  return record as NearbyManualCohortSelection;
}

export async function verifyNearbyManualCohortSelection(
  value: unknown,
  input: {
    expectedCheckpoint: RoomProtocolCheckpoint;
    expectedRootRoomId: string;
    allowedTargetRoomIds?: ReadonlySet<string>;
    now?: Date;
  },
): Promise<
  | { ok: true; selection: VerifiedNearbyManualCohortSelection }
  | { ok: false; reason: string }
> {
  const selection = parseNearbyManualCohortSelection(value);
  if (!selection) return { ok: false, reason: 'malformed Nearby manual cohort selection' };
  const now = input.now ?? new Date();
  if (!sameCheckpoint(selection.checkpoint, input.expectedCheckpoint)
    || selection.rootRoomId !== input.expectedRootRoomId
    || selection.rootRoomId !== nearbyCohortRootGroup(input.expectedCheckpoint).roomId) {
    return { ok: false, reason: 'Nearby manual cohort selection scope mismatch' };
  }
  if (selection.fromGroup.address.geographicPath
      !== selection.targetGroup.address.geographicPath
    || selection.fromGroup.address.cohortPath
      === selection.targetGroup.address.cohortPath
    || selection.fromGroup.address.cohortPath.length
      !== selection.targetGroup.address.cohortPath.length) {
    return { ok: false, reason: 'Nearby manual selection changes its area or cohort depth' };
  }
  const expectedArea = nearbyAreaBindingId({
    checkpoint: selection.checkpoint,
    privacyMode: selection.privacyMode,
    geographicPath: selection.fromGroup.address.geographicPath,
  });
  if (selection.areaBindingId !== expectedArea) {
    return { ok: false, reason: 'Nearby manual selection area binding mismatch' };
  }
  if (input.allowedTargetRoomIds
    && !input.allowedTargetRoomIds.has(selection.targetGroup.roomId)) {
    return { ok: false, reason: 'Nearby manual selection target is not eligible' };
  }
  const issuedAt = Date.parse(selection.issuedAt);
  const expiresAt = Date.parse(selection.expiresAt);
  if (expiresAt !== issuedAt + NEARBY_MANUAL_SELECTION_TTL_MS
    || expiresAt <= now.getTime()) {
    return { ok: false, reason: 'Nearby manual cohort selection is expired or has invalid lifetime' };
  }
  const proof = await verifySignedP2PEnvelopeProof({
    proof: selection.proof,
    payload: nearbyManualCohortSelectionSigningPayload(selection),
    now,
    maxSkewMs: NEARBY_MANUAL_SELECTION_TTL_MS,
  });
  return proof.ok
    ? { ok: true, selection: { ...selection, __verifiedNearbyManualCohortSelection: true } }
    : proof;
}
