import type { RoomProtocolCheckpoint } from './active-exchange-room';
import {
  verifyNearbyCohortSeatClaim,
  type NearbyCohortSeatClaim,
  type VerifiedNearbyCohortSeatClaim,
} from './nearby-cohort-admission';
import {
  createNearbyPartitionTransitionV2,
  verifyNearbyPartitionTransitionV2,
  type NearbyPartitionGroupV2,
  type NearbyPartitionTransitionV2,
} from './nearby-cohort-protocol';
import { canonicalSerialize } from './p2p-runtime';
import { portableSha256Hex } from './portable-sha256';

export const NEARBY_COHORT_PEER_SYNC_MAX_CLAIMS = 512;
export const NEARBY_COHORT_PEER_SYNC_CHUNK_SIZE = 16;
export const NEARBY_COHORT_PEER_SYNC_MAX_ARTIFACTS = 2;
const NEARBY_COHORT_PEER_SYNC_MAX_BYTES = 768 * 1024;

export type NearbyCohortCapacityArtifact = {
  version: 1;
  kind: 'nearby-cohort-capacity-artifact';
  transition: NearbyPartitionTransitionV2;
  /** Exactly C+1 signed claims, making the decision independently reproducible. */
  evidenceClaims: NearbyCohortSeatClaim[];
};

export type NearbyCohortPeerSyncPayload = {
  version: 1;
  kind: 'nearby-cohort-peer-sync';
  checkpoint: RoomProtocolCheckpoint;
  claims: NearbyCohortSeatClaim[];
  artifacts: NearbyCohortCapacityArtifact[];
};

function sameCheckpoint(left: RoomProtocolCheckpoint, right: RoomProtocolCheckpoint): boolean {
  return left.networkId === right.networkId
    && left.protocolEpoch === right.protocolEpoch
    && left.manifestSequence === right.manifestSequence
    && left.manifestHash === right.manifestHash
    && left.chatroomCapacity === right.chatroomCapacity;
}

function sameGroup(left: NearbyPartitionGroupV2, right: NearbyPartitionGroupV2): boolean {
  return left.roomId === right.roomId
    && left.address.geographicPath === right.address.geographicPath
    && left.address.cohortPath === right.address.cohortPath;
}

function seatPriority(left: VerifiedNearbyCohortSeatClaim, right: VerifiedNearbyCohortSeatClaim): number {
  return Date.parse(left.enteredAt) - Date.parse(right.enteredAt)
    || left.claimHash.localeCompare(right.claimHash);
}

async function canonicalActiveClaims(input: {
  checkpoint: RoomProtocolCheckpoint;
  fromGroup: NearbyPartitionGroupV2;
  claims: readonly unknown[];
  now?: Date;
}): Promise<VerifiedNearbyCohortSeatClaim[]> {
  const byPub = new Map<string, VerifiedNearbyCohortSeatClaim>();
  for (const value of input.claims.slice(0, NEARBY_COHORT_PEER_SYNC_MAX_CLAIMS)) {
    const checked = await verifyNearbyCohortSeatClaim(value, {
      expectedCheckpoint: input.checkpoint,
      ...(input.now ? { now: input.now } : {}),
    });
    if (!checked.ok
      || checked.claim.status !== 'active'
      || !sameGroup(checked.claim.group, input.fromGroup)) continue;
    const prior = byPub.get(checked.claim.pub);
    // One signing key occupies at most one seat. Prefer its highest signed generation and use the
    // hash as a deterministic fork tie-breaker when disconnected devices produced equal versions.
    if (!prior
      || checked.claim.generation > prior.generation
      || (checked.claim.generation === prior.generation
        && checked.claim.claimHash.localeCompare(prior.claimHash) < 0)) {
      byPub.set(checked.claim.pub, checked.claim);
    }
  }
  return [...byPub.values()].sort(seatPriority);
}

function capacityEvidenceHash(input: {
  checkpoint: RoomProtocolCheckpoint;
  fromGroup: NearbyPartitionGroupV2;
  claims: readonly VerifiedNearbyCohortSeatClaim[];
}): string {
  return portableSha256Hex(canonicalSerialize({
    type: 'iinpublic-nearby-cohort-peer-capacity-evidence-v1',
    checkpoint: input.checkpoint,
    fromGroup: input.fromGroup,
    claims: input.claims.map((claim) => claim.claimHash).sort(),
  }));
}

/** Derive the one portable split decision from the earliest C+1 independently signed seats. */
export async function deriveNearbyCohortCapacityArtifact(input: {
  checkpoint: RoomProtocolCheckpoint;
  fromGroup: NearbyPartitionGroupV2;
  claims: readonly unknown[];
  now?: Date;
}): Promise<NearbyCohortCapacityArtifact | null> {
  const claims = (await canonicalActiveClaims(input))
    .slice(0, input.checkpoint.chatroomCapacity + 1);
  if (claims.length <= input.checkpoint.chatroomCapacity) return null;
  const createdAt = new Date(Math.max(...claims.map((claim) => Date.parse(claim.observedAt)))).toISOString();
  const transition = createNearbyPartitionTransitionV2({
    axis: 'cohort',
    checkpoint: input.checkpoint,
    fromGroup: input.fromGroup,
    evidenceHash: capacityEvidenceHash({
      checkpoint: input.checkpoint,
      fromGroup: input.fromGroup,
      claims,
    }),
    createdAt,
  });
  return {
    version: 1,
    kind: 'nearby-cohort-capacity-artifact',
    transition,
    evidenceClaims: claims,
  };
}

export async function verifyNearbyCohortCapacityArtifact(
  value: unknown,
  expectedCheckpoint: RoomProtocolCheckpoint,
  now?: Date,
): Promise<{ ok: true; artifact: NearbyCohortCapacityArtifact } | { ok: false; reason: string }> {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'malformed capacity artifact' };
  const artifact = value as Partial<NearbyCohortCapacityArtifact>;
  if (artifact.version !== 1
    || artifact.kind !== 'nearby-cohort-capacity-artifact'
    || !artifact.transition
    || !Array.isArray(artifact.evidenceClaims)
    || artifact.evidenceClaims.length !== expectedCheckpoint.chatroomCapacity + 1
    || artifact.evidenceClaims.length > NEARBY_COHORT_PEER_SYNC_MAX_CLAIMS) {
    return { ok: false, reason: 'malformed capacity artifact' };
  }
  const checkedTransition = await verifyNearbyPartitionTransitionV2(
    artifact.transition,
    expectedCheckpoint,
  );
  if (!checkedTransition.ok || checkedTransition.transition.axis !== 'cohort') {
    return { ok: false, reason: checkedTransition.ok ? 'capacity artifact is not a cohort split' : checkedTransition.reason };
  }
  const decisionTime = new Date(checkedTransition.transition.createdAt);
  if (now && decisionTime.getTime() > now.getTime() + 5 * 60_000) {
    return { ok: false, reason: 'capacity artifact decision is from the future' };
  }
  const expected = await deriveNearbyCohortCapacityArtifact({
    checkpoint: expectedCheckpoint,
    fromGroup: checkedTransition.transition.fromGroup,
    claims: artifact.evidenceClaims,
    // Evidence is historical: prove that all C+1 seats were live at the transition time. Requiring
    // them to remain live at receipt would make a valid offline split unverifiable after 45 s.
    now: decisionTime,
  });
  if (!expected || canonicalSerialize(expected.transition) !== canonicalSerialize(artifact.transition)) {
    return { ok: false, reason: 'capacity artifact evidence does not reproduce its transition' };
  }
  return {
    ok: true,
    artifact: {
      version: 1,
      kind: 'nearby-cohort-capacity-artifact',
      transition: checkedTransition.transition,
      evidenceClaims: expected.evidenceClaims,
    },
  };
}

export function parseNearbyCohortPeerSyncPayload(
  value: unknown,
  expectedCheckpoint?: RoomProtocolCheckpoint,
): NearbyCohortPeerSyncPayload | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as Partial<NearbyCohortPeerSyncPayload>;
  if (payload.version !== 1
    || payload.kind !== 'nearby-cohort-peer-sync'
    || !payload.checkpoint
    || typeof payload.checkpoint.networkId !== 'string'
    || payload.checkpoint.networkId.length < 1
    || payload.checkpoint.networkId.length > 128
    || !Number.isSafeInteger(payload.checkpoint.protocolEpoch)
    || payload.checkpoint.protocolEpoch < 1
    || !Number.isSafeInteger(payload.checkpoint.manifestSequence)
    || payload.checkpoint.manifestSequence < 1
    || !/^[a-f0-9]{64}$/.test(payload.checkpoint.manifestHash)
    || !Number.isSafeInteger(payload.checkpoint.chatroomCapacity)
    || payload.checkpoint.chatroomCapacity < 1
    || payload.checkpoint.chatroomCapacity > 1_000_000
    || (expectedCheckpoint && !sameCheckpoint(payload.checkpoint, expectedCheckpoint))
    || !Array.isArray(payload.claims)
    || payload.claims.length > NEARBY_COHORT_PEER_SYNC_CHUNK_SIZE
    || !Array.isArray(payload.artifacts)
    || payload.artifacts.length > NEARBY_COHORT_PEER_SYNC_MAX_ARTIFACTS
    || payload.artifacts.some((artifact) => !artifact
      || !Array.isArray(artifact.evidenceClaims)
      || artifact.evidenceClaims.length > NEARBY_COHORT_PEER_SYNC_MAX_CLAIMS)) return null;
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > NEARBY_COHORT_PEER_SYNC_MAX_BYTES) return null;
  } catch {
    return null;
  }
  return payload as NearbyCohortPeerSyncPayload;
}
