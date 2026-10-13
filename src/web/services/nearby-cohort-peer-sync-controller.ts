import {
  createNearbyCohortSeatClaim,
  verifyNearbyCohortSeatClaim,
  type NearbyCohortSeatClaim,
} from '../../shared/nearby-cohort-admission';
import {
  deriveNearbyCohortCapacityArtifact,
  parseNearbyCohortPeerSyncPayload,
  verifyNearbyCohortCapacityArtifact,
  NEARBY_COHORT_PEER_SYNC_CHUNK_SIZE,
  NEARBY_COHORT_PEER_SYNC_MAX_CLAIMS,
  NEARBY_COHORT_PEER_SYNC_MAX_ARTIFACTS,
  type NearbyCohortCapacityArtifact,
  type NearbyCohortPeerSyncPayload,
} from '../../shared/nearby-cohort-peer-sync';
import {
  selectNearbyCohortReplacementV2,
  type NearbyPartitionGroupV2,
} from '../../shared/nearby-cohort-protocol';
import type { NearbyCohortTraversalContext } from './nearby-cohort-traversal-client';

function sameGroup(left: NearbyPartitionGroupV2, right: NearbyPartitionGroupV2): boolean {
  return left.roomId === right.roomId
    && left.address.geographicPath === right.address.geographicPath
    && left.address.cohortPath === right.address.cohortPath;
}

/**
 * Serverless Nearby-capacity control plane. Mesh frames are only transport: every embedded claim
 * keeps its user's SEA signature and every accepted split is reproduced locally from C+1 claims.
 */
export class NearbyCohortPeerSyncController {
  private context: NearbyCohortTraversalContext | null = null;
  private localClaim: NearbyCohortSeatClaim | null = null;
  private activeGroup: NearbyPartitionGroupV2 | null = null;
  private readonly claims = new Map<string, NearbyCohortSeatClaim>();
  private readonly artifacts = new Map<string, NearbyCohortCapacityArtifact>();
  private appliedTransitionIds = new Set<string>();
  private readonly pendingIndexArtifactIds = new Set<string>();
  private readonly pendingIndexClaims = new Map<string, NearbyCohortSeatClaim>();
  private operation: Promise<void> = Promise.resolve();
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: {
    send(payload: NearbyCohortPeerSyncPayload, recipientUserId?: string): Promise<void>;
    applyAutomaticTransition(input: {
      fromGroup: NearbyPartitionGroupV2;
      targetGroup: NearbyPartitionGroupV2;
      claim: NearbyCohortSeatClaim;
      artifact: NearbyCohortCapacityArtifact;
    }): Promise<void>;
    reconcileWithIndex?(payload: NearbyCohortPeerSyncPayload): Promise<void>;
    now?: () => Date;
  }) {}

  async activate(
    context: NearbyCohortTraversalContext,
    activeGroup: NearbyPartitionGroupV2,
    knownClaim?: NearbyCohortSeatClaim | null,
  ): Promise<void> {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.context = context;
    this.activeGroup = activeGroup;
    this.claims.clear();
    this.artifacts.clear();
    this.appliedTransitionIds = new Set();
    this.pendingIndexArtifactIds.clear();
    this.pendingIndexClaims.clear();
    let claim = knownClaim ?? null;
    if (claim) {
      const checked = await verifyNearbyCohortSeatClaim(claim, {
        expectedCheckpoint: context.checkpoint,
        now: this.now(),
      });
      if (!checked.ok
        || checked.claim.pub !== context.pair.pub
        || checked.claim.userId !== context.userId
        || !sameGroup(checked.claim.group, activeGroup)) claim = null;
    }
    this.localClaim = claim ?? await createNearbyCohortSeatClaim({
      checkpoint: context.checkpoint,
      pair: context.pair,
      userId: context.userId,
      privacyMode: context.privacyMode,
      group: activeGroup,
      generation: 1,
      now: this.now(),
    });
    this.acceptClaim(this.localClaim);
    this.pendingIndexClaims.set(this.localClaim.claimHash, this.localClaim);
    const initialPayload = this.payload([this.localClaim], []);
    await this.options.send(initialPayload);
    await this.tryIndexReconcile();
    this.scheduleRefresh();
  }

  async updateLocalClaim(claim: NearbyCohortSeatClaim): Promise<void> {
    const context = this.context;
    if (!context) return;
    const checked = await verifyNearbyCohortSeatClaim(claim, {
      expectedCheckpoint: context.checkpoint,
      now: this.now(),
    });
    if (!checked.ok || checked.claim.pub !== context.pair.pub || checked.claim.userId !== context.userId) return;
    if (!this.acceptClaim(checked.claim)) return;
    this.localClaim = checked.claim;
    this.activeGroup = checked.claim.group;
    this.pendingIndexClaims.set(checked.claim.claimHash, checked.claim);
    const payload = this.payload([checked.claim], this.pendingArtifacts());
    await this.options.send(payload);
    await this.tryIndexReconcile();
  }

  ingest(payload: unknown): Promise<void> {
    const run = this.operation.then(() => this.ingestNow(payload), () => this.ingestNow(payload));
    this.operation = run.catch(() => undefined);
    return run;
  }

  /** Send bounded snapshots directly to a newly connected peer; no third-party relay is trusted. */
  async syncToPeer(recipientUserId: string): Promise<void> {
    if (!this.context) return;
    const claims = [...this.claims.values()]
      .sort((left, right) => left.claimHash.localeCompare(right.claimHash))
      .slice(-NEARBY_COHORT_PEER_SYNC_MAX_CLAIMS);
    const artifacts = [...this.artifacts.values()];
    const chunks = Math.max(
      1,
      Math.ceil(claims.length / NEARBY_COHORT_PEER_SYNC_CHUNK_SIZE),
      Math.ceil(artifacts.length / NEARBY_COHORT_PEER_SYNC_MAX_ARTIFACTS),
    );
    for (let index = 0; index < chunks; index += 1) {
      await this.options.send(this.payload(
        claims.slice(index * NEARBY_COHORT_PEER_SYNC_CHUNK_SIZE, (index + 1) * NEARBY_COHORT_PEER_SYNC_CHUNK_SIZE),
        artifacts.slice(
          index * NEARBY_COHORT_PEER_SYNC_MAX_ARTIFACTS,
          (index + 1) * NEARBY_COHORT_PEER_SYNC_MAX_ARTIFACTS,
        ),
      ), recipientUserId);
    }
  }

  diagnostics(): {
    activeRoomId: string | null;
    claimCount: number;
    artifactCount: number;
    appliedTransitionCount: number;
  } {
    return {
      activeRoomId: this.activeGroup?.roomId ?? null,
      claimCount: this.claims.size,
      artifactCount: this.artifacts.size,
      appliedTransitionCount: this.appliedTransitionIds.size,
    };
  }

  deactivate(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.context = null;
    this.localClaim = null;
    this.activeGroup = null;
    this.claims.clear();
    this.artifacts.clear();
    this.pendingIndexArtifactIds.clear();
    this.pendingIndexClaims.clear();
  }

  private async ingestNow(value: unknown): Promise<void> {
    const context = this.context;
    if (!context) return;
    const payload = parseNearbyCohortPeerSyncPayload(value, context.checkpoint);
    if (!payload) return;
    const learnedClaims: NearbyCohortSeatClaim[] = [];
    for (const valueClaim of payload.claims) {
      const checked = await verifyNearbyCohortSeatClaim(valueClaim, {
        expectedCheckpoint: context.checkpoint,
        now: this.now(),
      });
      if (!checked.ok || this.claims.has(checked.claim.claimHash)) continue;
      if (this.claims.size >= NEARBY_COHORT_PEER_SYNC_MAX_CLAIMS) this.pruneClaims();
      if (this.claims.size >= NEARBY_COHORT_PEER_SYNC_MAX_CLAIMS) continue;
      if (this.acceptClaim(checked.claim)) learnedClaims.push(checked.claim);
    }

    const learnedArtifacts: NearbyCohortCapacityArtifact[] = [];
    for (const valueArtifact of payload.artifacts) {
      const checked = await verifyNearbyCohortCapacityArtifact(
        valueArtifact,
        context.checkpoint,
        this.now(),
      );
      if (!checked.ok || this.artifacts.has(checked.artifact.transition.transitionId)) continue;
      this.artifacts.set(checked.artifact.transition.transitionId, checked.artifact);
      this.pendingIndexArtifactIds.add(checked.artifact.transition.transitionId);
      for (const claim of checked.artifact.evidenceClaims) this.acceptClaim(claim);
      learnedArtifacts.push(checked.artifact);
    }

    // Re-originate only newly verified inner records. This is bounded epidemic reconciliation,
    // not authority delegation: every next hop verifies each user's original claim signature.
    if (learnedClaims.length > 0 || learnedArtifacts.length > 0) {
      for (let offset = 0; offset < learnedClaims.length; offset += NEARBY_COHORT_PEER_SYNC_CHUNK_SIZE) {
        await this.options.send(this.payload(
          learnedClaims.slice(offset, offset + NEARBY_COHORT_PEER_SYNC_CHUNK_SIZE),
          offset === 0 ? learnedArtifacts : [],
        ));
      }
      if (learnedClaims.length === 0) await this.options.send(this.payload([], learnedArtifacts));
    }

    await this.deriveAndApply();
  }

  private async deriveAndApply(): Promise<void> {
    const context = this.context;
    const localClaim = this.localClaim;
    const activeGroup = this.activeGroup;
    if (!context || !localClaim || !activeGroup) return;
    let artifact: NearbyCohortCapacityArtifact | undefined = [...this.artifacts.values()]
      .filter((candidate) => sameGroup(candidate.transition.fromGroup, activeGroup))
      .sort((left, right) => Date.parse(left.transition.createdAt) - Date.parse(right.transition.createdAt)
        || left.transition.transitionId.localeCompare(right.transition.transitionId))[0];
    if (!artifact) {
      artifact = await deriveNearbyCohortCapacityArtifact({
        checkpoint: context.checkpoint,
        fromGroup: activeGroup,
        claims: [...this.claims.values()],
        now: this.now(),
      }) ?? undefined;
      if (artifact) {
        this.artifacts.set(artifact.transition.transitionId, artifact);
        this.pendingIndexArtifactIds.add(artifact.transition.transitionId);
        // Publish the complete proof before leaving the old mesh room.
        const artifactPayload = this.payload([], [artifact]);
        await this.options.send(artifactPayload);
        await this.tryIndexReconcile();
      }
    }
    if (!artifact || this.appliedTransitionIds.has(artifact.transition.transitionId)) return;
    const targetGroup = selectNearbyCohortReplacementV2(artifact.transition, context.pair.pub);
    const nextClaim = await createNearbyCohortSeatClaim({
      checkpoint: context.checkpoint,
      pair: context.pair,
      userId: context.userId,
      privacyMode: context.privacyMode,
      group: targetGroup,
      generation: localClaim.generation + 1,
      previousClaimHash: localClaim.claimHash,
      enteredAt: new Date(localClaim.enteredAt),
      now: this.now(),
    });
    await this.options.applyAutomaticTransition({
      fromGroup: activeGroup,
      targetGroup,
      claim: nextClaim,
      artifact,
    });
    this.appliedTransitionIds.add(artifact.transition.transitionId);
    this.localClaim = nextClaim;
    this.activeGroup = targetGroup;
    this.acceptClaim(nextClaim);
    this.pendingIndexClaims.set(nextClaim.claimHash, nextClaim);
    const movedPayload = this.payload([nextClaim], [artifact]);
    await this.options.send(movedPayload);
    await this.tryIndexReconcile();
  }

  private payload(
    claims: NearbyCohortSeatClaim[],
    artifacts: NearbyCohortCapacityArtifact[],
  ): NearbyCohortPeerSyncPayload {
    if (!this.context) throw new Error('Nearby peer sync is not active');
    return {
      version: 1,
      kind: 'nearby-cohort-peer-sync',
      checkpoint: this.context.checkpoint,
      claims: claims.slice(0, NEARBY_COHORT_PEER_SYNC_CHUNK_SIZE),
      artifacts: artifacts.slice(0, NEARBY_COHORT_PEER_SYNC_MAX_ARTIFACTS),
    };
  }

  private pruneClaims(): void {
    const now = this.now().getTime();
    for (const [hash, claim] of this.claims) {
      if (Date.parse(claim.expiresAt) <= now && hash !== this.localClaim?.claimHash) this.claims.delete(hash);
    }
  }

  private acceptClaim(claim: NearbyCohortSeatClaim): boolean {
    const sameSigner = [...this.claims.values()].filter((candidate) => candidate.pub === claim.pub);
    const winner = [...sameSigner, claim].sort((left, right) =>
      right.generation - left.generation || left.claimHash.localeCompare(right.claimHash))[0]!;
    if (winner.claimHash !== claim.claimHash) return false;
    for (const prior of sameSigner) this.claims.delete(prior.claimHash);
    this.claims.set(claim.claimHash, claim);
    return sameSigner.every((prior) => prior.claimHash !== claim.claimHash);
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refreshLocalClaim().finally(() => {
        if (this.context) this.scheduleRefresh();
      });
    }, 20_000);
    (this.refreshTimer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
  }

  private async refreshLocalClaim(): Promise<void> {
    const context = this.context;
    const current = this.localClaim;
    const group = this.activeGroup;
    if (!context || !current || !group) return;
    const next = await createNearbyCohortSeatClaim({
      checkpoint: context.checkpoint,
      pair: context.pair,
      userId: context.userId,
      privacyMode: context.privacyMode,
      group,
      generation: current.generation + 1,
      previousClaimHash: current.claimHash,
      enteredAt: new Date(current.enteredAt),
      now: this.now(),
    });
    this.localClaim = next;
    this.acceptClaim(next);
    this.pendingIndexClaims.set(next.claimHash, next);
    const payload = this.payload([next], this.pendingArtifacts());
    await this.options.send(payload);
    await this.tryIndexReconcile();
  }

  private pendingArtifacts(): NearbyCohortCapacityArtifact[] {
    return [...this.pendingIndexArtifactIds]
      .map((id) => this.artifacts.get(id))
      .filter((artifact): artifact is NearbyCohortCapacityArtifact => !!artifact)
      .slice(0, NEARBY_COHORT_PEER_SYNC_MAX_ARTIFACTS);
  }

  private pendingClaims(): NearbyCohortSeatClaim[] {
    return [...this.pendingIndexClaims.values()]
      .sort((left, right) => left.generation - right.generation
        || left.observedAt.localeCompare(right.observedAt)
        || left.claimHash.localeCompare(right.claimHash))
      .slice(0, NEARBY_COHORT_PEER_SYNC_CHUNK_SIZE);
  }

  private async tryIndexReconcile(): Promise<void> {
    if (!this.options.reconcileWithIndex) return;
    let hasPending = true;
    while (hasPending) {
      const payload = this.payload(this.pendingClaims(), this.pendingArtifacts());
      if (payload.claims.length === 0 && payload.artifacts.length === 0) return;
      try {
        await this.options.reconcileWithIndex(payload);
        for (const claim of payload.claims) this.pendingIndexClaims.delete(claim.claimHash);
        for (const artifact of payload.artifacts) {
          this.pendingIndexArtifactIds.delete(artifact.transition.transitionId);
        }
        hasPending = this.pendingIndexClaims.size > 0 || this.pendingIndexArtifactIds.size > 0;
      } catch {
        // Expected while offline. The next signed heartbeat retries pending artifacts and chains.
        return;
      }
    }
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}
