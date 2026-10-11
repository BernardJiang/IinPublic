import type { RoomProtocolCheckpoint } from './active-exchange-room';
import {
  nearbyAreaBindingId,
  nearbyCohortRootGroup,
  type NearbyPartitionGroupV2,
} from './nearby-cohort-protocol';
import type { NearbyPublicMode } from './nearby-rooms';
import {
  canonicalSerialize,
  createSignedP2PEnvelopeProof,
  verifySignedP2PEnvelopeProof,
  type SeaSigningPair,
  type SignedP2PEnvelopeProof,
} from './p2p-runtime';
import { portableSha256Hex } from './portable-sha256';

export const NEARBY_COHORT_CLAIM_TTL_MS = 45_000;
export const NEARBY_COHORT_POLICY_MAX_LIFETIME_MS = 31 * 24 * 60 * 60_000;
export const NEARBY_COHORT_RESERVATION_MIN_TTL_MS = 5_000;
export const NEARBY_COHORT_RESERVATION_MAX_TTL_MS = 30_000;

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const ROOM_PATTERN = /^nearby_v3_e\d+_[a-f0-9]{24}$/;

export type NearbyCohortOccupancyPolicy = {
  version: 1;
  kind: 'nearby-cohort-occupancy-policy';
  checkpoint: RoomProtocolCheckpoint;
  sequence: number;
  targetOccupancy: number;
  maxAreaCohorts: number;
  reservationTtlMs: number;
  issuedAt: string;
  expiresAt: string;
  signerPub: string;
  proof: SignedP2PEnvelopeProof;
};

export type VerifiedNearbyCohortOccupancyPolicy = NearbyCohortOccupancyPolicy & {
  readonly __verifiedNearbyCohortOccupancyPolicy: true;
};

export type NearbyCohortSeatClaim = {
  version: 1;
  kind: 'nearby-cohort-seat-claim';
  checkpoint: RoomProtocolCheckpoint;
  rootRoomId: string;
  areaBindingId: string;
  privacyMode: NearbyPublicMode;
  group: NearbyPartitionGroupV2;
  userId: string;
  pub: string;
  generation: number;
  previousClaimHash: string | null;
  status: 'active' | 'released';
  enteredAt: string;
  observedAt: string;
  expiresAt: string;
  claimHash: string;
  proof: SignedP2PEnvelopeProof;
};

export type VerifiedNearbyCohortSeatClaim = NearbyCohortSeatClaim & {
  readonly __verifiedNearbyCohortSeatClaim: true;
};

function sameCheckpoint(left: RoomProtocolCheckpoint, right: RoomProtocolCheckpoint): boolean {
  return left.networkId === right.networkId
    && left.protocolEpoch === right.protocolEpoch
    && left.manifestSequence === right.manifestSequence
    && left.manifestHash === right.manifestHash
    && left.chatroomCapacity === right.chatroomCapacity;
}

function validCheckpoint(value: unknown): value is RoomProtocolCheckpoint {
  if (!value || typeof value !== 'object') return false;
  const checkpoint = value as Partial<RoomProtocolCheckpoint>;
  return typeof checkpoint.networkId === 'string'
    && checkpoint.networkId.length > 0
    && checkpoint.networkId.length <= 128
    && Number.isSafeInteger(checkpoint.protocolEpoch)
    && Number(checkpoint.protocolEpoch) > 0
    && Number.isSafeInteger(checkpoint.manifestSequence)
    && Number(checkpoint.manifestSequence) > 0
    && typeof checkpoint.manifestHash === 'string'
    && HASH_PATTERN.test(checkpoint.manifestHash)
    && Number.isSafeInteger(checkpoint.chatroomCapacity)
    && Number(checkpoint.chatroomCapacity) > 0
    && Number(checkpoint.chatroomCapacity) <= 1_000_000;
}

function validGroup(value: unknown): value is NearbyPartitionGroupV2 {
  if (!value || typeof value !== 'object') return false;
  const group = value as Partial<NearbyPartitionGroupV2>;
  return typeof group.roomId === 'string'
    && ROOM_PATTERN.test(group.roomId)
    && !!group.address
    && typeof group.address.geographicPath === 'string'
    && /^[0-3]{0,24}$/.test(group.address.geographicPath)
    && typeof group.address.cohortPath === 'string'
    && /^[01]{0,24}$/.test(group.address.cohortPath)
    && group.address.geographicPath.length + group.address.cohortPath.length <= 24;
}

export function nearbyCohortOccupancyPolicySigningPayload(
  policy: Omit<NearbyCohortOccupancyPolicy, 'proof'>,
): unknown {
  return {
    type: 'iinpublic-nearby-cohort-occupancy-policy-v1',
    version: policy.version,
    kind: policy.kind,
    checkpoint: policy.checkpoint,
    sequence: policy.sequence,
    targetOccupancy: policy.targetOccupancy,
    maxAreaCohorts: policy.maxAreaCohorts,
    reservationTtlMs: policy.reservationTtlMs,
    issuedAt: policy.issuedAt,
    expiresAt: policy.expiresAt,
    signerPub: policy.signerPub,
  };
}

export async function createNearbyCohortOccupancyPolicy(input: {
  checkpoint: RoomProtocolCheckpoint;
  pair: SeaSigningPair;
  sequence: number;
  targetOccupancy: number;
  maxAreaCohorts: number;
  reservationTtlMs: number;
  now?: Date;
  expiresAt?: Date;
}): Promise<NearbyCohortOccupancyPolicy> {
  const now = input.now ?? new Date();
  const expiresAt = input.expiresAt ?? new Date(now.getTime() + 24 * 60 * 60_000);
  const unsigned: Omit<NearbyCohortOccupancyPolicy, 'proof'> = {
    version: 1,
    kind: 'nearby-cohort-occupancy-policy',
    checkpoint: { ...input.checkpoint },
    sequence: input.sequence,
    targetOccupancy: input.targetOccupancy,
    maxAreaCohorts: input.maxAreaCohorts,
    reservationTtlMs: input.reservationTtlMs,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    signerPub: String(input.pair.pub || ''),
  };
  const parsed = parseNearbyCohortOccupancyPolicy({ ...unsigned, proof: { pub: unsigned.signerPub } });
  if (!parsed) throw new Error('Nearby cohort occupancy policy is invalid');
  const proof = await createSignedP2PEnvelopeProof({
    pair: input.pair,
    payload: nearbyCohortOccupancyPolicySigningPayload(unsigned),
    timestamp: unsigned.issuedAt,
  });
  return { ...unsigned, proof };
}

export function parseNearbyCohortOccupancyPolicy(value: unknown): NearbyCohortOccupancyPolicy | null {
  if (!value || typeof value !== 'object') return null;
  const policy = value as Partial<NearbyCohortOccupancyPolicy>;
  if (policy.version !== 1
    || policy.kind !== 'nearby-cohort-occupancy-policy'
    || !validCheckpoint(policy.checkpoint)
    || !Number.isSafeInteger(policy.sequence)
    || Number(policy.sequence) < 1
    || !Number.isSafeInteger(policy.targetOccupancy)
    || Number(policy.targetOccupancy) < 1
    || Number(policy.targetOccupancy) > policy.checkpoint.chatroomCapacity
    || !Number.isSafeInteger(policy.maxAreaCohorts)
    || Number(policy.maxAreaCohorts) < 1
    || Number(policy.maxAreaCohorts) > 4_096
    || !Number.isSafeInteger(policy.reservationTtlMs)
    || Number(policy.reservationTtlMs) < NEARBY_COHORT_RESERVATION_MIN_TTL_MS
    || Number(policy.reservationTtlMs) > NEARBY_COHORT_RESERVATION_MAX_TTL_MS
    || typeof policy.issuedAt !== 'string'
    || !Number.isFinite(Date.parse(policy.issuedAt))
    || typeof policy.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(policy.expiresAt))
    || typeof policy.signerPub !== 'string'
    || !policy.signerPub
    || !policy.proof
    || policy.proof.pub !== policy.signerPub) return null;
  return policy as NearbyCohortOccupancyPolicy;
}

export async function verifyNearbyCohortOccupancyPolicy(
  value: unknown,
  input: {
    expectedCheckpoint: RoomProtocolCheckpoint;
    trustedSignerPubs: ReadonlySet<string>;
    now?: Date;
  },
): Promise<
  | { ok: true; policy: VerifiedNearbyCohortOccupancyPolicy }
  | { ok: false; reason: string }
> {
  const policy = parseNearbyCohortOccupancyPolicy(value);
  if (!policy) return { ok: false, reason: 'malformed Nearby cohort occupancy policy' };
  const now = input.now ?? new Date();
  const issuedAt = Date.parse(policy.issuedAt);
  const expiresAt = Date.parse(policy.expiresAt);
  if (!sameCheckpoint(policy.checkpoint, input.expectedCheckpoint)) {
    return { ok: false, reason: 'Nearby cohort occupancy policy checkpoint mismatch' };
  }
  if (!input.trustedSignerPubs.has(policy.signerPub)) {
    return { ok: false, reason: 'Nearby cohort occupancy policy signer is not trusted' };
  }
  if (expiresAt <= now.getTime()
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > NEARBY_COHORT_POLICY_MAX_LIFETIME_MS) {
    return { ok: false, reason: 'Nearby cohort occupancy policy lifetime is invalid' };
  }
  const proof = await verifySignedP2PEnvelopeProof({
    proof: policy.proof,
    payload: nearbyCohortOccupancyPolicySigningPayload(policy),
    now,
    maxSkewMs: NEARBY_COHORT_POLICY_MAX_LIFETIME_MS,
  });
  return proof.ok
    ? { ok: true, policy: { ...policy, __verifiedNearbyCohortOccupancyPolicy: true } }
    : proof;
}

function claimUnsigned(
  claim: Omit<NearbyCohortSeatClaim, 'claimHash' | 'proof'>,
): Omit<NearbyCohortSeatClaim, 'claimHash' | 'proof'> {
  return claim;
}

export function nearbyCohortSeatClaimSigningPayload(
  claim: Omit<NearbyCohortSeatClaim, 'proof'> | NearbyCohortSeatClaim,
): unknown {
  const {
    claimHash: _claimHash,
    proof: _proof,
    __verifiedNearbyCohortSeatClaim: _verified,
    ...unsigned
  } = claim as NearbyCohortSeatClaim & Partial<VerifiedNearbyCohortSeatClaim>;
  return { type: 'iinpublic-nearby-cohort-seat-claim-v1', ...unsigned };
}

function claimHashFor(claim: Omit<NearbyCohortSeatClaim, 'claimHash' | 'proof'>): string {
  return portableSha256Hex(canonicalSerialize({
    type: 'iinpublic-nearby-cohort-seat-claim-v1',
    ...claimUnsigned(claim),
  }));
}

export async function createNearbyCohortSeatClaim(input: {
  checkpoint: RoomProtocolCheckpoint;
  pair: SeaSigningPair;
  userId: string;
  privacyMode: NearbyPublicMode;
  group: NearbyPartitionGroupV2;
  generation: number;
  previousClaimHash?: string | null;
  status?: 'active' | 'released';
  enteredAt?: Date;
  now?: Date;
}): Promise<NearbyCohortSeatClaim> {
  const now = input.now ?? new Date();
  const enteredAt = input.enteredAt ?? now;
  const rootRoomId = nearbyCohortRootGroup(input.checkpoint).roomId;
  const unsigned: Omit<NearbyCohortSeatClaim, 'claimHash' | 'proof'> = {
    version: 1,
    kind: 'nearby-cohort-seat-claim',
    checkpoint: { ...input.checkpoint },
    rootRoomId,
    areaBindingId: nearbyAreaBindingId({
      checkpoint: input.checkpoint,
      privacyMode: input.privacyMode,
      geographicPath: input.group.address.geographicPath,
    }),
    privacyMode: input.privacyMode,
    group: input.group,
    userId: String(input.userId || '').trim(),
    pub: String(input.pair.pub || '').trim(),
    generation: input.generation,
    previousClaimHash: input.previousClaimHash ?? null,
    status: input.status ?? 'active',
    enteredAt: enteredAt.toISOString(),
    observedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + NEARBY_COHORT_CLAIM_TTL_MS).toISOString(),
  };
  const claimHash = claimHashFor(unsigned);
  const withHash: Omit<NearbyCohortSeatClaim, 'proof'> = { ...unsigned, claimHash };
  if (!parseNearbyCohortSeatClaim({ ...withHash, proof: { pub: unsigned.pub } })) {
    throw new Error('Nearby cohort seat claim is invalid');
  }
  const proof = await createSignedP2PEnvelopeProof({
    pair: input.pair,
    payload: nearbyCohortSeatClaimSigningPayload(withHash),
    timestamp: unsigned.observedAt,
  });
  return { ...withHash, proof };
}

export function parseNearbyCohortSeatClaim(value: unknown): NearbyCohortSeatClaim | null {
  if (!value || typeof value !== 'object') return null;
  const claim = value as Partial<NearbyCohortSeatClaim>;
  if (claim.version !== 1
    || claim.kind !== 'nearby-cohort-seat-claim'
    || !validCheckpoint(claim.checkpoint)
    || typeof claim.rootRoomId !== 'string'
    || !ROOM_PATTERN.test(claim.rootRoomId)
    || typeof claim.areaBindingId !== 'string'
    || !/^nearby_area_[a-f0-9]{24}$/.test(claim.areaBindingId)
    || !['regional', 'citywide', 'neighborhood', 'close-nearby'].includes(String(claim.privacyMode))
    || !validGroup(claim.group)
    || typeof claim.userId !== 'string'
    || !claim.userId
    || claim.userId.length > 256
    || typeof claim.pub !== 'string'
    || !claim.pub
    || claim.pub.length > 2_048
    || !Number.isSafeInteger(claim.generation)
    || Number(claim.generation) < 1
    || (claim.previousClaimHash !== null
      && (typeof claim.previousClaimHash !== 'string' || !HASH_PATTERN.test(claim.previousClaimHash)))
    || (claim.status !== 'active' && claim.status !== 'released')
    || typeof claim.enteredAt !== 'string'
    || !Number.isFinite(Date.parse(claim.enteredAt))
    || typeof claim.observedAt !== 'string'
    || !Number.isFinite(Date.parse(claim.observedAt))
    || typeof claim.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(claim.expiresAt))
    || typeof claim.claimHash !== 'string'
    || !HASH_PATTERN.test(claim.claimHash)
    || !claim.proof
    || claim.proof.pub !== claim.pub) return null;
  return claim as NearbyCohortSeatClaim;
}

export async function verifyNearbyCohortSeatClaim(
  value: unknown,
  input: { expectedCheckpoint: RoomProtocolCheckpoint; now?: Date },
): Promise<
  | { ok: true; claim: VerifiedNearbyCohortSeatClaim }
  | { ok: false; reason: string }
> {
  const claim = parseNearbyCohortSeatClaim(value);
  if (!claim) return { ok: false, reason: 'malformed Nearby cohort seat claim' };
  const now = input.now ?? new Date();
  const observedAt = Date.parse(claim.observedAt);
  const expiresAt = Date.parse(claim.expiresAt);
  if (!sameCheckpoint(claim.checkpoint, input.expectedCheckpoint)
    || claim.rootRoomId !== nearbyCohortRootGroup(input.expectedCheckpoint).roomId) {
    return { ok: false, reason: 'Nearby cohort seat claim scope mismatch' };
  }
  if (claim.areaBindingId !== nearbyAreaBindingId({
    checkpoint: claim.checkpoint,
    privacyMode: claim.privacyMode,
    geographicPath: claim.group.address.geographicPath,
  })) {
    return { ok: false, reason: 'Nearby cohort seat claim area mismatch' };
  }
  if (expiresAt !== observedAt + NEARBY_COHORT_CLAIM_TTL_MS || expiresAt <= now.getTime()) {
    return { ok: false, reason: 'Nearby cohort seat claim is expired or has invalid lifetime' };
  }
  if (claim.generation === 1 ? claim.previousClaimHash !== null : claim.previousClaimHash === null) {
    return { ok: false, reason: 'Nearby cohort seat claim link is invalid' };
  }
  const {
    claimHash: _claimHash,
    proof: _proof,
    __verifiedNearbyCohortSeatClaim: _verified,
    ...unsigned
  } = claim as NearbyCohortSeatClaim & Partial<VerifiedNearbyCohortSeatClaim>;
  if (claim.claimHash !== claimHashFor(unsigned)) {
    return { ok: false, reason: 'Nearby cohort seat claim hash mismatch' };
  }
  const proof = await verifySignedP2PEnvelopeProof({
    proof: claim.proof,
    payload: nearbyCohortSeatClaimSigningPayload(claim),
    now,
    maxSkewMs: NEARBY_COHORT_CLAIM_TTL_MS,
  });
  return proof.ok
    ? { ok: true, claim: { ...claim, __verifiedNearbyCohortSeatClaim: true } }
    : proof;
}
