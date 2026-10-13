import { randomUUID } from 'crypto';
import type { RoomProtocolCheckpoint } from '../../shared/active-exchange-room';
import {
  NEARBY_COHORT_RESERVATION_MAX_TTL_MS,
  createNearbyCohortOccupancyPolicy,
  parseNearbyCohortOccupancyPolicy,
  verifyNearbyCohortOccupancyPolicy,
  verifyNearbyCohortSeatClaim,
  type NearbyCohortOccupancyPolicy,
  type NearbyCohortSeatClaim,
  type VerifiedNearbyCohortOccupancyPolicy,
  type VerifiedNearbyCohortSeatClaim,
} from '../../shared/nearby-cohort-admission';
import {
  createNearbyPartitionTransitionV2,
  nearbyCohortRootGroup,
  verifyNearbyManualCohortSelection,
  verifyNearbyPartitionTransitionV2,
  type NearbyManualCohortSelection,
  type NearbyPartitionGroupV2,
  type NearbyPartitionTransitionV2,
  type VerifiedNearbyPartitionTransitionV2,
} from '../../shared/nearby-cohort-protocol';
import { canonicalSerialize } from '../../shared/p2p-runtime';
import { portableSha256Hex } from '../../shared/portable-sha256';
import {
  verifyNearbyCohortCapacityArtifact,
  type NearbyCohortCapacityArtifact,
} from '../../shared/nearby-cohort-peer-sync';

const MAX_STATES = 16;
const MAX_TRANSITIONS = 16_384;
const MAX_ACTIVE_GROUPS = 8_192;
const MAX_CLAIMS = 65_536;
const MAX_RESERVATIONS = 4_096;
const MAX_RECONCILE_CLAIMS = 512;
const MAX_SUMMARIES = 64;
const DEFAULT_MAX_AREA_COHORTS = 128;
const DEFAULT_RESERVATION_TTL_MS = 15_000;

type Reservation = {
  token: string;
  claim: VerifiedNearbyCohortSeatClaim;
  selection?: NearbyManualCohortSelection;
  expiresAtMs: number;
};

type CohortState = {
  checkpoint: RoomProtocolCheckpoint;
  root: NearbyPartitionGroupV2;
  touchedAt: number;
  policy: VerifiedNearbyCohortOccupancyPolicy | null;
  transitionsById: Map<string, VerifiedNearbyPartitionTransitionV2>;
  transitionByFromRoom: Map<string, VerifiedNearbyPartitionTransitionV2>;
  activeByRoom: Map<string, NearbyPartitionGroupV2>;
  claimsByHash: Map<string, VerifiedNearbyCohortSeatClaim>;
  canonicalByPub: Map<string, VerifiedNearbyCohortSeatClaim>;
  winnersByRoom: Map<string, VerifiedNearbyCohortSeatClaim[]>;
  reconciliationLosers: Set<string>;
  reservationsByToken: Map<string, Reservation>;
  reservationTokenByPub: Map<string, string>;
};

export type NearbyCohortSummary = {
  group: NearbyPartitionGroupV2;
  activeCount: number;
  reservedCount: number;
  available: number;
  preferred: boolean;
  isCurrent: boolean;
};

export class NearbyCohortStoreError extends Error {
  constructor(
    public readonly code:
      | 'target-full'
      | 'target-inactive'
      | 'active-conflict'
      | 'reservation-missing'
      | 'reservation-expired'
      | 'claim-conflict'
      | 'reconciliation-lost'
      | 'policy-unavailable',
    message: string,
    public readonly status = 409,
  ) {
    super(message);
  }
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

function assertCheckpoint(checkpoint: RoomProtocolCheckpoint): void {
  if (!checkpoint
    || typeof checkpoint.networkId !== 'string'
    || checkpoint.networkId.length < 1
    || checkpoint.networkId.length > 128
    || !Number.isSafeInteger(checkpoint.protocolEpoch)
    || checkpoint.protocolEpoch < 1
    || !Number.isSafeInteger(checkpoint.manifestSequence)
    || checkpoint.manifestSequence < 1
    || !/^[a-f0-9]{64}$/.test(checkpoint.manifestHash)
    || !Number.isSafeInteger(checkpoint.chatroomCapacity)
    || checkpoint.chatroomCapacity < 1
    || checkpoint.chatroomCapacity > 1_000_000) {
    throw new Error('Nearby cohort checkpoint is invalid');
  }
}

function transitionPriority(
  left: VerifiedNearbyPartitionTransitionV2,
  right: VerifiedNearbyPartitionTransitionV2,
): number {
  return Date.parse(left.createdAt) - Date.parse(right.createdAt)
    || left.transitionId.localeCompare(right.transitionId);
}

function claimPriority(
  left: VerifiedNearbyCohortSeatClaim,
  right: VerifiedNearbyCohortSeatClaim,
): number {
  return right.generation - left.generation || left.claimHash.localeCompare(right.claimHash);
}

function seatPriority(
  left: VerifiedNearbyCohortSeatClaim,
  right: VerifiedNearbyCohortSeatClaim,
): number {
  return Date.parse(left.enteredAt) - Date.parse(right.enteredAt)
    || left.claimHash.localeCompare(right.claimHash);
}

/**
 * Relay-local, bounded materialization of portable signed cohort control. It serializes local
 * reservations but treats every committed seat as signed evidence so disconnected indexes can
 * later merge in any order and deterministically recover one active claim per signing key.
 */
export class NearbyCohortStore {
  private readonly states = new Map<string, CohortState>();
  private readonly tails = new Map<string, Promise<void>>();

  constructor(private readonly trustedPolicySignerPubs: ReadonlySet<string> = new Set()) {}

  clear(): void {
    this.states.clear();
    this.tails.clear();
  }

  async publishPolicy(
    checkpoint: RoomProtocolCheckpoint,
    value: unknown,
    now = new Date(),
  ): Promise<NearbyCohortOccupancyPolicy> {
    const state = this.getOrCreateState(checkpoint, now.getTime());
    const verification = await verifyNearbyCohortOccupancyPolicy(value, {
      expectedCheckpoint: checkpoint,
      trustedSignerPubs: this.trustedPolicySignerPubs,
      now,
    });
    if (!verification.ok) throw new Error(verification.reason);
    if (state.policy && verification.policy.sequence < state.policy.sequence) {
      throw new Error('Nearby cohort occupancy policy rolls back sequence');
    }
    if (state.policy
      && verification.policy.sequence === state.policy.sequence
      && canonicalSerialize(verification.policy) !== canonicalSerialize(state.policy)) {
      throw new Error('Nearby cohort occupancy policy sequence conflicts');
    }
    state.policy = verification.policy;
    state.touchedAt = now.getTime();
    return verification.policy;
  }

  async publishTransitions(
    checkpoint: RoomProtocolCheckpoint,
    values: unknown[],
    now = new Date(),
  ): Promise<NearbyPartitionTransitionV2[]> {
    const state = this.getOrCreateState(checkpoint, now.getTime());
    const accepted: NearbyPartitionTransitionV2[] = [];
    for (const value of values.slice(0, 128)) {
      if (state.transitionsById.size >= MAX_TRANSITIONS) break;
      const verification = await verifyNearbyPartitionTransitionV2(value, checkpoint);
      if (!verification.ok || state.transitionsById.has(verification.transition.transitionId)) continue;
      state.transitionsById.set(verification.transition.transitionId, verification.transition);
      accepted.push(verification.transition);
    }
    this.rebuildActiveGroups(state);
    this.rebuildClaims(state, now.getTime());
    state.touchedAt = now.getTime();
    return accepted;
  }

  async summaries(input: {
    checkpoint: RoomProtocolCheckpoint;
    areaBindingId: string;
    currentRoomId: string;
    now?: Date;
  }): Promise<{
    policy: NearbyCohortOccupancyPolicy | null;
    cohorts: NearbyCohortSummary[];
    truncated: boolean;
    transitions: NearbyPartitionTransitionV2[];
  }> {
    const now = input.now ?? new Date();
    const state = this.getOrCreateState(input.checkpoint, now.getTime());
    this.prune(state, now.getTime());
    const currentClaim = [...state.canonicalByPub.values()].find((claim) =>
      claim.areaBindingId === input.areaBindingId && claim.group.roomId === input.currentRoomId);
    const currentGroup = state.activeByRoom.get(input.currentRoomId) ?? currentClaim?.group;
    if (currentGroup) await this.maybeExpandArea(state, input.areaBindingId, currentGroup, now);
    const geographicPath = currentGroup?.address.geographicPath;
    const cohortDepth = currentGroup?.address.cohortPath.length;
    const eligible = [...state.activeByRoom.values()]
      .filter((group) => geographicPath != null
        && group.address.geographicPath === geographicPath
        && group.address.cohortPath.length === cohortDepth)
      .sort((a, b) => a.address.cohortPath.localeCompare(b.address.cohortPath));
    const total = eligible.length;
    const limit = state.checkpoint.chatroomCapacity;
    const target = state.policy?.targetOccupancy ?? limit;
    const cohorts = eligible.slice(0, MAX_SUMMARIES).map((group) => {
      const activeCount = state.winnersByRoom.get(group.roomId)?.length ?? 0;
      const reservedCount = this.reservedCount(state, group.roomId, now.getTime());
      return {
        group,
        activeCount,
        reservedCount,
        available: Math.max(0, limit - activeCount - reservedCount),
        preferred: activeCount + reservedCount < target,
        isCurrent: group.roomId === input.currentRoomId,
      };
    });
    return {
      policy: state.policy,
      cohorts,
      truncated: total > cohorts.length,
      transitions: this.transitionsFrom(state, input.currentRoomId),
    };
  }

  async reserve(input: {
    claim: unknown;
    selection?: unknown;
    now?: Date;
  }): Promise<{ reservationToken: string; expiresAt: string; targetRoomId: string }> {
    const now = input.now ?? new Date();
    const parsedPolicyClaim = input.claim as { checkpoint?: RoomProtocolCheckpoint } | null;
    if (!parsedPolicyClaim?.checkpoint) throw new Error('Nearby cohort reservation claim is required');
    const key = checkpointKey(parsedPolicyClaim.checkpoint);
    return this.serialized(key, async () => {
      const state = this.getOrCreateState(parsedPolicyClaim.checkpoint!, now.getTime());
      this.prune(state, now.getTime());
      const verification = await verifyNearbyCohortSeatClaim(input.claim, {
        expectedCheckpoint: state.checkpoint,
        now,
      });
      if (!verification.ok) throw new Error(verification.reason);
      const claim = verification.claim;
      if (claim.status !== 'active') throw new Error('Nearby cohort reservation requires an active claim');
      const target = state.activeByRoom.get(claim.group.roomId);
      if (!target || canonicalSerialize(target) !== canonicalSerialize(claim.group)) {
        throw new NearbyCohortStoreError('target-inactive', 'Nearby target cohort is inactive');
      }
      const current = state.canonicalByPub.get(claim.pub);
      this.assertNextClaim(current, claim);
      let selection: NearbyManualCohortSelection | undefined;
      if (input.selection != null) {
        const allowed = new Set([...state.activeByRoom.values()]
          .filter((group) => group.address.geographicPath === claim.group.address.geographicPath
            && group.address.cohortPath.length === claim.group.address.cohortPath.length)
          .map((group) => group.roomId));
        const checked = await verifyNearbyManualCohortSelection(input.selection, {
          expectedCheckpoint: state.checkpoint,
          expectedRootRoomId: state.root.roomId,
          allowedTargetRoomIds: allowed,
          now,
        });
        if (!checked.ok) throw new Error(checked.reason);
        selection = checked.selection;
        if (selection.pub !== claim.pub
          || selection.userId !== claim.userId
          || selection.targetGroup.roomId !== claim.group.roomId
          || selection.areaBindingId !== claim.areaBindingId
          || current?.group.roomId !== selection.fromGroup.roomId) {
          throw new NearbyCohortStoreError('active-conflict', 'Nearby manual selection does not match active claim');
        }
      } else if (current && current.status === 'active' && current.group.roomId !== claim.group.roomId) {
        const replacement = state.transitionByFromRoom.get(current.group.roomId);
        const isAutomaticReplacement = replacement?.toGroups.some((group) =>
          group.roomId === claim.group.roomId
          && canonicalSerialize(group) === canonicalSerialize(claim.group)) === true;
        if (!isAutomaticReplacement) {
          throw new NearbyCohortStoreError('active-conflict', 'Nearby cohort switch requires signed manual selection');
        }
      }
      const oldToken = state.reservationTokenByPub.get(claim.pub);
      if (oldToken) this.deleteReservation(state, oldToken);
      const capacityUsed = (state.winnersByRoom.get(target.roomId)?.length ?? 0)
        + this.reservedCount(state, target.roomId, now.getTime(), claim.pub);
      const alreadyInTarget = current?.status === 'active' && current.group.roomId === target.roomId;
      if (!alreadyInTarget && capacityUsed >= state.checkpoint.chatroomCapacity) {
        await this.maybeExpandArea(state, claim.areaBindingId, target, now, true);
        throw new NearbyCohortStoreError('target-full', 'Nearby target cohort is full');
      }
      if (state.reservationsByToken.size >= MAX_RESERVATIONS) {
        throw new NearbyCohortStoreError('policy-unavailable', 'Nearby reservation index is at its bounded limit', 503);
      }
      const ttlMs = state.policy?.reservationTtlMs ?? DEFAULT_RESERVATION_TTL_MS;
      const token = portableSha256Hex(`${randomUUID()}:${claim.claimHash}:${now.getTime()}`);
      const reservation: Reservation = {
        token,
        claim,
        ...(selection ? { selection } : {}),
        expiresAtMs: now.getTime() + Math.min(ttlMs, NEARBY_COHORT_RESERVATION_MAX_TTL_MS),
      };
      state.reservationsByToken.set(token, reservation);
      state.reservationTokenByPub.set(claim.pub, token);
      state.touchedAt = now.getTime();
      return {
        reservationToken: token,
        expiresAt: new Date(reservation.expiresAtMs).toISOString(),
        targetRoomId: target.roomId,
      };
    });
  }

  async commit(input: {
    reservationToken: string;
    claim: unknown;
    now?: Date;
  }): Promise<{
    claim: NearbyCohortSeatClaim;
    activeRoomId: string;
    reconciled: boolean;
    transitions: NearbyPartitionTransitionV2[];
  }> {
    const now = input.now ?? new Date();
    const parsed = input.claim as { checkpoint?: RoomProtocolCheckpoint } | null;
    if (!parsed?.checkpoint) throw new Error('Nearby cohort commit claim is required');
    return this.serialized(checkpointKey(parsed.checkpoint), async () => {
      const state = this.getOrCreateState(parsed.checkpoint!, now.getTime());
      this.prune(state, now.getTime());
      const reservation = state.reservationsByToken.get(input.reservationToken);
      if (!reservation) {
        throw new NearbyCohortStoreError('reservation-missing', 'Nearby cohort reservation is missing');
      }
      if (reservation.expiresAtMs <= now.getTime()) {
        this.deleteReservation(state, reservation.token);
        throw new NearbyCohortStoreError('reservation-expired', 'Nearby cohort reservation expired');
      }
      const verification = await verifyNearbyCohortSeatClaim(input.claim, {
        expectedCheckpoint: state.checkpoint,
        now,
      });
      if (!verification.ok) throw new Error(verification.reason);
      if (verification.claim.claimHash !== reservation.claim.claimHash) {
        throw new NearbyCohortStoreError('claim-conflict', 'Nearby commit does not match its reservation');
      }
      if (!state.activeByRoom.has(verification.claim.group.roomId)) {
        throw new NearbyCohortStoreError('target-inactive', 'Nearby target cohort became inactive');
      }
      this.acceptClaim(state, verification.claim);
      this.deleteReservation(state, reservation.token);
      this.rebuildClaims(state, now.getTime());
      const winner = state.canonicalByPub.get(verification.claim.pub);
      const active = winner?.status === 'active' && winner.claimHash === verification.claim.claimHash
        && !state.reconciliationLosers.has(verification.claim.claimHash);
      if (!active) {
        throw new NearbyCohortStoreError('reconciliation-lost', 'Nearby claim lost deterministic reconciliation');
      }
      const transitions = await this.maybeExpandArea(
        state,
        verification.claim.areaBindingId,
        verification.claim.group,
        now,
      );
      state.touchedAt = now.getTime();
      return {
        claim: verification.claim,
        activeRoomId: verification.claim.group.roomId,
        reconciled: true,
        transitions,
      };
    });
  }

  async release(value: unknown, now = new Date()): Promise<{
    claim: NearbyCohortSeatClaim;
    activeRoomId: string | null;
  }> {
    const parsed = value as { checkpoint?: RoomProtocolCheckpoint } | null;
    if (!parsed?.checkpoint) throw new Error('Nearby cohort release claim is required');
    return this.serialized(checkpointKey(parsed.checkpoint), async () => {
      const state = this.getOrCreateState(parsed.checkpoint!, now.getTime());
      this.prune(state, now.getTime());
      const verification = await verifyNearbyCohortSeatClaim(value, {
        expectedCheckpoint: state.checkpoint,
        now,
      });
      if (!verification.ok) throw new Error(verification.reason);
      if (verification.claim.status !== 'released') throw new Error('Nearby cohort release requires released status');
      this.assertNextClaim(state.canonicalByPub.get(verification.claim.pub), verification.claim);
      this.acceptClaim(state, verification.claim);
      this.rebuildClaims(state, now.getTime());
      const active = state.canonicalByPub.get(verification.claim.pub);
      return {
        claim: verification.claim,
        activeRoomId: active?.status === 'active' ? active.group.roomId : null,
      };
    });
  }

  cancelReservation(token: string): void {
    for (const state of this.states.values()) {
      if (state.reservationsByToken.has(token)) {
        this.deleteReservation(state, token);
        return;
      }
    }
  }

  activeClaim(
    checkpoint: RoomProtocolCheckpoint,
    pub: string,
    now = new Date(),
  ): NearbyCohortSeatClaim | null {
    const state = this.states.get(checkpointKey(checkpoint));
    if (!state) return null;
    this.prune(state, now.getTime());
    const claim = state.canonicalByPub.get(pub);
    return claim?.status === 'active' && !state.reconciliationLosers.has(claim.claimHash) ? claim : null;
  }

  async reconcile(input: {
    checkpoint: RoomProtocolCheckpoint;
    claims: unknown[];
    now?: Date;
  }): Promise<{
    accepted: number;
    rejected: number;
    losers: string[];
    active: NearbyCohortSeatClaim[];
    transitions: NearbyPartitionTransitionV2[];
  }> {
    const now = input.now ?? new Date();
    return this.serialized(checkpointKey(input.checkpoint), async () => {
      const state = this.getOrCreateState(input.checkpoint, now.getTime());
      this.prune(state, now.getTime());
      let accepted = 0;
      let rejected = Math.max(0, input.claims.length - MAX_RECONCILE_CLAIMS);
      const verified: VerifiedNearbyCohortSeatClaim[] = [];
      for (const value of input.claims.slice(0, MAX_RECONCILE_CLAIMS)) {
        const result = await verifyNearbyCohortSeatClaim(value, {
          expectedCheckpoint: state.checkpoint,
          now,
        });
        if (result.ok) verified.push(result.claim);
        else rejected += 1;
      }
      verified.sort((a, b) => a.generation - b.generation || a.claimHash.localeCompare(b.claimHash));
      for (const claim of verified) {
        if (state.claimsByHash.has(claim.claimHash)) continue;
        if (!this.hasValidLink(state, claim)) {
          rejected += 1;
          continue;
        }
        if (state.claimsByHash.size >= MAX_CLAIMS) break;
        this.acceptClaim(state, claim);
        accepted += 1;
      }
      this.rebuildClaims(state, now.getTime());
      const transitions: NearbyPartitionTransitionV2[] = [];
      for (const group of [...state.activeByRoom.values()]) {
        const representative = [...state.canonicalByPub.values()].find((claim) =>
          claim.status === 'active'
          && claim.group.roomId === group.roomId
          && !state.reconciliationLosers.has(claim.claimHash));
        if (!representative) continue;
        transitions.push(...await this.maybeExpandArea(
          state,
          representative.areaBindingId,
          group,
          now,
        ));
      }
      state.touchedAt = now.getTime();
      return {
        accepted,
        rejected,
        losers: [...state.reconciliationLosers].slice(0, MAX_RECONCILE_CLAIMS),
        active: [...state.canonicalByPub.values()]
          .filter((claim) => claim.status === 'active'
          && !state.reconciliationLosers.has(claim.claimHash))
          .slice(0, MAX_RECONCILE_CLAIMS),
        transitions,
      };
    });
  }

  /**
   * Import a portable phone-to-phone split. Unlike the deliberately absent bare-transition route,
   * every artifact includes the C+1 signed claims needed to reproduce its content-addressed split.
   */
  async reconcilePeer(input: {
    checkpoint: RoomProtocolCheckpoint;
    artifacts: unknown[];
    claims: unknown[];
    now?: Date;
  }): Promise<{
    acceptedArtifacts: number;
    rejectedArtifacts: number;
    acceptedClaims: number;
    rejectedClaims: number;
    active: NearbyCohortSeatClaim[];
    transitions: NearbyPartitionTransitionV2[];
  }> {
    const now = input.now ?? new Date();
    return this.serialized(checkpointKey(input.checkpoint), async () => {
      const state = this.getOrCreateState(input.checkpoint, now.getTime());
      this.prune(state, now.getTime());
      let acceptedArtifacts = 0;
      let rejectedArtifacts = 0;
      const acceptedArtifactValues: NearbyCohortCapacityArtifact[] = [];
      for (const value of input.artifacts.slice(0, 32)) {
        const checked = await verifyNearbyCohortCapacityArtifact(value, state.checkpoint, now);
        if (!checked.ok) {
          rejectedArtifacts += 1;
          continue;
        }
        acceptedArtifactValues.push(checked.artifact);
        if (!state.transitionsById.has(checked.artifact.transition.transitionId)) {
          state.transitionsById.set(
            checked.artifact.transition.transitionId,
            { ...checked.artifact.transition, __verifiedNearbyPartitionTransitionV2: true },
          );
          acceptedArtifacts += 1;
        }
      }

      // Import proof claims while their source group is active, apply the verified transitions,
      // then accept only descendants that name one of the resulting active groups.
      const evidenceValues = acceptedArtifactValues.flatMap((artifact) => artifact.evidenceClaims);
      const verifiedEvidence: VerifiedNearbyCohortSeatClaim[] = [];
      let rejectedClaims = 0;
      for (const value of evidenceValues) {
        const parsed = value as { observedAt?: unknown } | null;
        const observedAt = typeof parsed?.observedAt === 'string' ? new Date(parsed.observedAt) : now;
        const checked = await verifyNearbyCohortSeatClaim(value, {
          expectedCheckpoint: state.checkpoint,
          // Historical artifact claims are checked at their signed observation; ordinary current
          // claims are subsequently bounded by prune(now).
          now: observedAt,
        });
        if (checked.ok) verifiedEvidence.push(checked.claim);
        else rejectedClaims += 1;
      }
      verifiedEvidence.sort((left, right) => left.generation - right.generation
        || left.claimHash.localeCompare(right.claimHash));
      let acceptedClaims = 0;
      for (const claim of verifiedEvidence) {
        if (state.claimsByHash.has(claim.claimHash)) continue;
        const activeSource = state.activeByRoom.get(claim.group.roomId);
        if (!activeSource
          || canonicalSerialize(activeSource) !== canonicalSerialize(claim.group)
          || state.claimsByHash.size >= MAX_CLAIMS) {
          rejectedClaims += 1;
          continue;
        }
        this.acceptClaim(state, claim);
        acceptedClaims += 1;
      }
      this.rebuildActiveGroups(state);

      const verifiedDescendants: VerifiedNearbyCohortSeatClaim[] = [];
      for (const value of input.claims.slice(0, MAX_RECONCILE_CLAIMS)) {
        const checked = await verifyNearbyCohortSeatClaim(value, {
          expectedCheckpoint: state.checkpoint,
          now,
        });
        if (checked.ok) verifiedDescendants.push(checked.claim);
        else rejectedClaims += 1;
      }
      verifiedDescendants.sort((left, right) => left.generation - right.generation
        || left.claimHash.localeCompare(right.claimHash));
      for (const claim of verifiedDescendants) {
        if (state.claimsByHash.has(claim.claimHash)) continue;
        const activeTarget = state.activeByRoom.get(claim.group.roomId);
        if ((claim.status === 'active'
            && (!activeTarget || canonicalSerialize(activeTarget) !== canonicalSerialize(claim.group)))
          || !this.hasValidLink(state, claim)
          || state.claimsByHash.size >= MAX_CLAIMS) {
          rejectedClaims += 1;
          continue;
        }
        this.acceptClaim(state, claim);
        acceptedClaims += 1;
      }
      this.rebuildClaims(state, now.getTime());
      state.touchedAt = now.getTime();
      return {
        acceptedArtifacts,
        rejectedArtifacts: rejectedArtifacts + Math.max(0, input.artifacts.length - 32),
        acceptedClaims,
        rejectedClaims: rejectedClaims + Math.max(0, input.claims.length - MAX_RECONCILE_CLAIMS),
        active: [...state.canonicalByPub.values()]
          .filter((claim) => claim.status === 'active'
            && !state.reconciliationLosers.has(claim.claimHash))
          .slice(0, MAX_RECONCILE_CLAIMS),
        transitions: [...state.transitionsById.values()].slice(-MAX_RECONCILE_CLAIMS),
      };
    });
  }

  private getOrCreateState(checkpoint: RoomProtocolCheckpoint, nowMs: number): CohortState {
    assertCheckpoint(checkpoint);
    const key = checkpointKey(checkpoint);
    let state = this.states.get(key);
    if (state) return state;
    if (this.states.size >= MAX_STATES) {
      const oldest = [...this.states.entries()].sort((a, b) => a[1].touchedAt - b[1].touchedAt)[0];
      if (oldest) this.states.delete(oldest[0]);
    }
    const root = nearbyCohortRootGroup(checkpoint);
    state = {
      checkpoint: { ...checkpoint },
      root,
      touchedAt: nowMs,
      policy: null,
      transitionsById: new Map(),
      transitionByFromRoom: new Map(),
      activeByRoom: new Map([[root.roomId, root]]),
      claimsByHash: new Map(),
      canonicalByPub: new Map(),
      winnersByRoom: new Map(),
      reconciliationLosers: new Set(),
      reservationsByToken: new Map(),
      reservationTokenByPub: new Map(),
    };
    this.states.set(key, state);
    return state;
  }

  private rebuildActiveGroups(state: CohortState): void {
    const transitions = [...state.transitionsById.values()].sort(transitionPriority);
    const canonical = new Map<string, VerifiedNearbyPartitionTransitionV2>();
    for (const transition of transitions) {
      if (!canonical.has(transition.fromGroup.roomId)) {
        canonical.set(transition.fromGroup.roomId, transition);
      }
    }
    const active = new Map<string, NearbyPartitionGroupV2>([[state.root.roomId, state.root]]);
    const byFrom = new Map<string, VerifiedNearbyPartitionTransitionV2>();
    for (let pass = 0; pass < 24; pass += 1) {
      let changed = false;
      for (const transition of transitions) {
        if (canonical.get(transition.fromGroup.roomId)?.transitionId !== transition.transitionId
          || !active.has(transition.fromGroup.roomId)
          || active.size - 1 + transition.toGroups.length > MAX_ACTIVE_GROUPS) continue;
        active.delete(transition.fromGroup.roomId);
        byFrom.set(transition.fromGroup.roomId, transition);
        for (const target of transition.toGroups) active.set(target.roomId, target);
        changed = true;
      }
      if (!changed) break;
    }
    state.activeByRoom = active;
    state.transitionByFromRoom = byFrom;
  }

  private rebuildClaims(state: CohortState, nowMs: number): void {
    const byPub = new Map<string, VerifiedNearbyCohortSeatClaim[]>();
    for (const claim of state.claimsByHash.values()) {
      if (Date.parse(claim.expiresAt) <= nowMs) continue;
      const values = byPub.get(claim.pub) ?? [];
      values.push(claim);
      byPub.set(claim.pub, values);
    }
    state.canonicalByPub = new Map([...byPub].map(([pub, claims]) => [
      pub,
      claims.sort(claimPriority)[0]!,
    ]));
    const candidatesByRoom = new Map<string, VerifiedNearbyCohortSeatClaim[]>();
    for (const claim of state.canonicalByPub.values()) {
      if (claim.status !== 'active') continue;
      const values = candidatesByRoom.get(claim.group.roomId) ?? [];
      values.push(claim);
      candidatesByRoom.set(claim.group.roomId, values);
    }
    state.winnersByRoom = new Map();
    state.reconciliationLosers = new Set();
    for (const [roomId, claims] of candidatesByRoom) {
      const ordered = claims.sort(seatPriority);
      const winners = ordered.slice(0, state.checkpoint.chatroomCapacity);
      state.winnersByRoom.set(roomId, winners);
      for (const loser of ordered.slice(state.checkpoint.chatroomCapacity)) {
        state.reconciliationLosers.add(loser.claimHash);
      }
    }
  }

  private async maybeExpandArea(
    state: CohortState,
    areaBindingId: string,
    currentGroup: NearbyPartitionGroupV2,
    now: Date,
    force = false,
  ): Promise<NearbyPartitionTransitionV2[]> {
    const sameArea = [...state.activeByRoom.values()].filter((group) =>
      group.address.geographicPath === currentGroup.address.geographicPath
      && group.address.cohortPath.length === currentGroup.address.cohortPath.length);
    const maxAreaCohorts = state.policy?.maxAreaCohorts ?? DEFAULT_MAX_AREA_COHORTS;
    if (sameArea.length === 0 || sameArea.length * 2 > maxAreaCohorts) return [];
    // A reserved target must remain active through commit. Opening a replacement while another
    // serialized reservation still points at this level would invalidate an already-issued token.
    if (sameArea.some((group) => this.reservedCount(state, group.roomId, now.getTime()) > 0)) return [];
    const target = state.policy?.targetOccupancy ?? state.checkpoint.chatroomCapacity;
    const counts = sameArea.map((group) => (state.winnersByRoom.get(group.roomId)?.length ?? 0)
      + this.reservedCount(state, group.roomId, now.getTime()));
    const shouldExpand = force
      || counts.some((count) => count >= state.checkpoint.chatroomCapacity)
      || counts.reduce((sum, count) => sum + count, 0) >= target * sameArea.length;
    if (!shouldExpand || state.transitionsById.size + sameArea.length > MAX_TRANSITIONS) return [];
    const evidenceHash = portableSha256Hex(canonicalSerialize({
      type: 'iinpublic-nearby-cohort-capacity-evidence-v1',
      checkpoint: state.checkpoint,
      areaBindingId,
      policySequence: state.policy?.sequence ?? null,
      claims: [...state.winnersByRoom.entries()]
        .filter(([roomId]) => sameArea.some((group) => group.roomId === roomId))
        .flatMap(([, claims]) => claims.map((claim) => claim.claimHash))
        .sort(),
    }));
    const evidenceTimes = [...state.winnersByRoom.entries()]
      .filter(([roomId]) => sameArea.some((group) => group.roomId === roomId))
      .flatMap(([, claims]) => claims.map((claim) => Date.parse(claim.observedAt)))
      .filter(Number.isFinite);
    const deterministicCreatedAt = new Date(
      evidenceTimes.length > 0 ? Math.max(...evidenceTimes) : now.getTime(),
    ).toISOString();
    const created: VerifiedNearbyPartitionTransitionV2[] = [];
    for (const group of sameArea) {
      const candidate = createNearbyPartitionTransitionV2({
        axis: 'cohort',
        checkpoint: state.checkpoint,
        fromGroup: group,
        evidenceHash,
        createdAt: deterministicCreatedAt,
      });
      const verification = await verifyNearbyPartitionTransitionV2(candidate, state.checkpoint);
      if (!verification.ok) throw new Error(verification.reason);
      state.transitionsById.set(verification.transition.transitionId, verification.transition);
      created.push(verification.transition);
    }
    this.rebuildActiveGroups(state);
    return created;
  }

  private transitionsFrom(state: CohortState, roomId: string): NearbyPartitionTransitionV2[] {
    const transition = state.transitionByFromRoom.get(roomId);
    return transition ? [transition] : [];
  }

  private assertNextClaim(
    current: VerifiedNearbyCohortSeatClaim | undefined,
    next: VerifiedNearbyCohortSeatClaim,
  ): void {
    if (!current) {
      if (next.generation !== 1 || next.previousClaimHash !== null) {
        throw new NearbyCohortStoreError('claim-conflict', 'Nearby first claim must begin at generation one');
      }
      return;
    }
    if (next.generation !== current.generation + 1
      || next.previousClaimHash !== current.claimHash) {
      throw new NearbyCohortStoreError('claim-conflict', 'Nearby claim does not extend active signed history');
    }
    if (next.pub !== current.pub) {
      throw new NearbyCohortStoreError('claim-conflict', 'Nearby claim changes stable identity');
    }
  }

  private hasValidLink(state: CohortState, claim: VerifiedNearbyCohortSeatClaim): boolean {
    if (claim.generation === 1) return claim.previousClaimHash === null;
    const previous = claim.previousClaimHash ? state.claimsByHash.get(claim.previousClaimHash) : undefined;
    return !!previous && previous.pub === claim.pub && previous.generation + 1 === claim.generation;
  }

  private acceptClaim(state: CohortState, claim: VerifiedNearbyCohortSeatClaim): void {
    if (!state.claimsByHash.has(claim.claimHash) && state.claimsByHash.size >= MAX_CLAIMS) {
      throw new NearbyCohortStoreError('policy-unavailable', 'Nearby claim index is at its bounded limit', 503);
    }
    state.claimsByHash.set(claim.claimHash, claim);
  }

  private reservedCount(state: CohortState, roomId: string, nowMs: number, exceptPub?: string): number {
    return [...state.reservationsByToken.values()].filter((reservation) =>
      reservation.expiresAtMs > nowMs
      && reservation.claim.group.roomId === roomId
      && reservation.claim.pub !== exceptPub).length;
  }

  private deleteReservation(state: CohortState, token: string): void {
    const reservation = state.reservationsByToken.get(token);
    if (!reservation) return;
    state.reservationsByToken.delete(token);
    if (state.reservationTokenByPub.get(reservation.claim.pub) === token) {
      state.reservationTokenByPub.delete(reservation.claim.pub);
    }
  }

  private prune(state: CohortState, nowMs: number): void {
    if (state.policy && Date.parse(state.policy.expiresAt) <= nowMs) state.policy = null;
    for (const [token, reservation] of state.reservationsByToken) {
      if (reservation.expiresAtMs <= nowMs) this.deleteReservation(state, token);
    }
    for (const [hash, claim] of state.claimsByHash) {
      if (Date.parse(claim.expiresAt) <= nowMs) state.claimsByHash.delete(hash);
    }
    this.rebuildClaims(state, nowMs);
  }

  private async serialized<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(action);
    const tail = result.then(() => undefined, () => undefined);
    this.tails.set(key, tail);
    try {
      return await result;
    } finally {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}

// Retain a compile-time reference so accidental removal of the signed-policy constructor is caught
// by lint/type tooling even though production policy issuance happens outside the relay process.
void createNearbyCohortOccupancyPolicy;
void parseNearbyCohortOccupancyPolicy;
