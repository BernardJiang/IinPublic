import type { RoomProtocolCheckpoint } from '../../shared/active-exchange-room';
import {
  nearbyAreaBindingId,
  nearbyCohortRootGroup,
  verifyNearbyManualCohortSelection,
  type NearbyManualCohortSelection,
  type NearbyPartitionGroupV2,
} from '../../shared/nearby-cohort-protocol';
import type { NearbyPublicMode } from '../../shared/nearby-rooms';
import type { SeaSigningPair } from '../../shared/p2p-runtime';
import type { NearbyCohortSeatClaim } from '../../shared/nearby-cohort-admission';
import { canonicalSerialize } from '../../shared/p2p-runtime';
import { portableSha256Hex } from '../../shared/portable-sha256';
import type {
  CohortTraversalSnapshot,
  CohortTraversalStatus,
  CohortTraversalViewModel,
} from '../ui/cohort-traversal-view-model';

const STORAGE_PREFIX = 'iinpublic_nearby_cohort_traversal_v1:';
export const NEARBY_COHORT_SUMMARY_LIMIT = 32;
export const NEARBY_COHORT_RECENT_LIMIT = 32;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type NearbyCohortSummary = {
  group: NearbyPartitionGroupV2;
  activeCount: number;
  reservedCount: number;
  available: boolean;
  isCurrent: boolean;
};

export type NearbyCohortSummaryPage = {
  cohorts: NearbyCohortSummary[];
  truncated: boolean;
};

export type NearbyCohortTraversalContext = {
  checkpoint: RoomProtocolCheckpoint;
  userId: string;
  pair: SeaSigningPair;
  privacyMode: NearbyPublicMode;
  /** Verified automatic group. This is the safe fallback for every failed restore or handoff. */
  defaultGroup: NearbyPartitionGroupV2;
};

export type NearbyCohortReservation = {
  reservationToken: string;
  expiresAt: string;
  /** Absent only for the first automatic claim of the verified default group. */
  selection?: NearbyManualCohortSelection;
  claim?: NearbyCohortSeatClaim;
  targetGroup: NearbyPartitionGroupV2;
};

export type NearbyCohortCommit = {
  activeGroup: NearbyPartitionGroupV2;
};

/**
 * Narrow client contract over OPEN-40-G2.1. The REST implementation owns claim construction and
 * verification; traversal owns bounded choice, persistence, and stop-before-start coordination.
 */
export interface NearbyCohortTraversalApi {
  summaries(input: {
    context: NearbyCohortTraversalContext;
    areaBindingId: string;
    currentGroup: NearbyPartitionGroupV2;
    limit: number;
  }): Promise<NearbyCohortSummaryPage>;
  active(input: {
    context: NearbyCohortTraversalContext;
  }): Promise<{ activeGroup: NearbyPartitionGroupV2 | null }>;
  reserve(input: {
    context: NearbyCohortTraversalContext;
    fromGroup: NearbyPartitionGroupV2;
    targetGroup: NearbyPartitionGroupV2;
    visitOrdinal: number;
  }): Promise<NearbyCohortReservation>;
  commit(input: {
    context: NearbyCohortTraversalContext;
    reservation: NearbyCohortReservation;
  }): Promise<NearbyCohortCommit>;
  cancel(input: {
    context: NearbyCohortTraversalContext;
    reservation: NearbyCohortReservation;
  }): Promise<void>;
}

/** Membership/runtime work deliberately stays outside the allocator transport. */
export interface NearbyCohortHandoff {
  stopOld(group: NearbyPartitionGroupV2): Promise<void>;
  startTarget(group: NearbyPartitionGroupV2): Promise<void>;
  restoreOld(group: NearbyPartitionGroupV2): Promise<void>;
}

export class NearbyCohortTraversalError extends Error {
  constructor(
    readonly code: 'full' | 'offline' | 'invalid' | 'conflict' | 'error',
    message: string,
  ) {
    super(message);
    this.name = 'NearbyCohortTraversalError';
  }
}

type PersistedTraversal = {
  version: 1;
  checkpointKey: string;
  userId: string;
  pub: string;
  privacyMode: NearbyPublicMode;
  defaultGroup: NearbyPartitionGroupV2;
  activeGroup: NearbyPartitionGroupV2;
  committedSelection?: NearbyManualCohortSelection;
  visitOrdinal: number;
  recentRoomIds: string[];
  committedAt: string;
};

function checkpointKey(checkpoint: RoomProtocolCheckpoint): string {
  return [
    checkpoint.networkId,
    checkpoint.protocolEpoch,
    checkpoint.manifestSequence,
    checkpoint.manifestHash,
    checkpoint.chatroomCapacity,
  ].join(':');
}

function sameGroup(left: NearbyPartitionGroupV2, right: NearbyPartitionGroupV2): boolean {
  return left.roomId === right.roomId
    && left.address.geographicPath === right.address.geographicPath
    && left.address.cohortPath === right.address.cohortPath;
}

function validGroup(group: NearbyPartitionGroupV2 | null | undefined): group is NearbyPartitionGroupV2 {
  return !!group
    && /^nearby_v3_e\d+_[a-f0-9]{24}$/.test(group.roomId)
    && /^[0-3]{0,24}$/.test(group.address?.geographicPath ?? '')
    && /^[01]{0,24}$/.test(group.address?.cohortPath ?? '')
    && group.address.geographicPath.length + group.address.cohortPath.length <= 24;
}

function eligibleForSameArea(
  source: NearbyPartitionGroupV2,
  summary: NearbyCohortSummary,
): boolean {
  return validGroup(summary.group)
    && summary.group.address.geographicPath === source.address.geographicPath
    && summary.group.address.cohortPath.length === source.address.cohortPath.length
    && summary.group.roomId !== source.roomId
    && summary.available;
}

function normalizeSummary(value: NearbyCohortSummary): NearbyCohortSummary | null {
  if (!validGroup(value?.group)
    || !Number.isSafeInteger(value.activeCount)
    || value.activeCount < 0
    || !Number.isSafeInteger(value.reservedCount)
    || value.reservedCount < 0
    || typeof value.available !== 'boolean'
    || typeof value.isCurrent !== 'boolean') return null;
  return value;
}

function storageKey(context: NearbyCohortTraversalContext): string {
  return `${STORAGE_PREFIX}${portableSha256Hex(canonicalSerialize({
    checkpoint: checkpointKey(context.checkpoint),
    rootRoomId: nearbyCohortRootGroup(context.checkpoint).roomId,
    pub: context.pair.pub,
  })).slice(0, 32)}`;
}

function persistedMatchesContext(
  state: PersistedTraversal,
  context: NearbyCohortTraversalContext,
): boolean {
  return state.version === 1
    && state.checkpointKey === checkpointKey(context.checkpoint)
    && state.userId === context.userId
    && state.pub === context.pair.pub
    && state.privacyMode === context.privacyMode
    && sameGroup(state.defaultGroup, context.defaultGroup)
    && validGroup(state.activeGroup)
    && Number.isSafeInteger(state.visitOrdinal)
    && state.visitOrdinal >= 0
    && Array.isArray(state.recentRoomIds)
    && state.recentRoomIds.length <= NEARBY_COHORT_RECENT_LIMIT;
}

function statusFor(error: unknown): CohortTraversalStatus {
  if (error instanceof NearbyCohortTraversalError) {
    if (error.code === 'full') return 'full';
    if (error.code === 'offline') return 'offline';
  }
  return 'error';
}

/**
 * Real traversal state behind the flat Group 1 controls. It never exposes opaque room IDs through
 * the view model. All server lists and local history remain strictly bounded.
 */
export class NearbyCohortTraversalClient implements CohortTraversalViewModel {
  private context: NearbyCohortTraversalContext | null = null;
  private activeGroup: NearbyPartitionGroupV2 | null = null;
  private committedSelection: NearbyManualCohortSelection | undefined;
  private recentRoomIds: string[] = [];
  private visitOrdinal = 0;
  private status: CohortTraversalStatus = 'ready';
  private lastError: string | null = null;
  private groupCount: number | undefined = 1;
  private operation: Promise<void> = Promise.resolve();

  constructor(private readonly options: {
    api: NearbyCohortTraversalApi;
    handoff: NearbyCohortHandoff;
    storage: StorageLike;
    now?: () => Date;
  }) {}

  getSnapshot(): CohortTraversalSnapshot {
    return {
      status: this.status,
      isDefaultGroup: !this.context || !this.activeGroup
        || sameGroup(this.activeGroup, this.context.defaultGroup),
      ...(this.groupCount === undefined ? {} : { groupCount: this.groupCount }),
    };
  }

  getActiveGroup(): NearbyPartitionGroupV2 | null {
    return this.activeGroup;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  /**
   * Call before starting room presence. A visit is restored only when both its local signature and
   * the G2.1 active-claim index agree. Any expired, offline, or unverifiable state returns default.
   */
  async initialize(context: NearbyCohortTraversalContext): Promise<NearbyPartitionGroupV2> {
    if (!validGroup(context.defaultGroup) || !context.userId || !context.pair.pub || !context.pair.priv) {
      throw new NearbyCohortTraversalError('invalid', 'Nearby cohort context is invalid');
    }
    this.context = context;
    this.activeGroup = context.defaultGroup;
    this.committedSelection = undefined;
    this.visitOrdinal = 0;
    this.recentRoomIds = [];
    const persisted = this.readPersisted(context);
    let remoteActive: NearbyPartitionGroupV2 | null = null;
    try {
      remoteActive = (await this.options.api.active({ context })).activeGroup;
      if (!remoteActive) {
        const reservation = await this.options.api.reserve({
          context,
          fromGroup: context.defaultGroup,
          targetGroup: context.defaultGroup,
          visitOrdinal: 0,
        });
        remoteActive = (await this.options.api.commit({ context, reservation })).activeGroup;
      }
    } catch (error) {
      this.status = statusFor(error);
    }
    if (persisted && !sameGroup(persisted.activeGroup, context.defaultGroup)
      && persisted.committedSelection) {
      const rootRoomId = nearbyCohortRootGroup(context.checkpoint).roomId;
      const verification = await verifyNearbyManualCohortSelection(
        persisted.committedSelection,
        {
          expectedCheckpoint: context.checkpoint,
          expectedRootRoomId: rootRoomId,
          allowedTargetRoomIds: new Set([persisted.activeGroup.roomId]),
          now: this.now(),
        },
      );
      if (verification.ok) {
        try {
          if (remoteActive && sameGroup(remoteActive, persisted.activeGroup)) {
            this.activeGroup = persisted.activeGroup;
            this.committedSelection = verification.selection;
            this.visitOrdinal = persisted.visitOrdinal;
            this.recentRoomIds = persisted.recentRoomIds.slice(-NEARBY_COHORT_RECENT_LIMIT);
          } else {
            this.clearPersisted(context);
          }
        } catch {
          // A disconnected/unverifiable claim must not start a non-default room after restart.
          this.clearPersisted(context);
        }
      } else {
        this.clearPersisted(context);
      }
    } else if (persisted) {
      this.visitOrdinal = persisted.visitOrdinal;
      this.recentRoomIds = persisted.recentRoomIds.slice(-NEARBY_COHORT_RECENT_LIMIT);
    }
    if (remoteActive
      && !sameGroup(remoteActive, context.defaultGroup)
      && sameGroup(this.activeGroup, context.defaultGroup)) {
      // The index remembers a visit that local storage cannot authenticate (expired, tampered,
      // or lost). Supersede it with a newly signed return-to-default before any room runtime
      // starts; never briefly start either the stale visit or an uncommitted default.
      const reservation = await this.options.api.reserve({
        context,
        fromGroup: remoteActive,
        targetGroup: context.defaultGroup,
        visitOrdinal: Math.max(1, this.visitOrdinal + 1),
      });
      const committed = await this.options.api.commit({ context, reservation });
      if (!sameGroup(committed.activeGroup, context.defaultGroup)) {
        throw new NearbyCohortTraversalError('conflict', 'Nearby default recovery selected another group');
      }
      this.visitOrdinal = Math.max(1, this.visitOrdinal + 1);
      this.clearPersisted(context);
    }
    await this.refreshSummaries().catch((error) => {
      this.status = statusFor(error);
    });
    return this.activeGroup;
  }

  async refreshSummaries(): Promise<void> {
    const context = this.requireContext();
    const currentGroup = this.activeGroup ?? context.defaultGroup;
    const page = await this.options.api.summaries({
      context,
      areaBindingId: nearbyAreaBindingId({
        checkpoint: context.checkpoint,
        privacyMode: context.privacyMode,
        geographicPath: currentGroup.address.geographicPath,
      }),
      currentGroup,
      limit: NEARBY_COHORT_SUMMARY_LIMIT,
    });
    const cohorts = page.cohorts
      .slice(0, NEARBY_COHORT_SUMMARY_LIMIT)
      .map(normalizeSummary)
      .filter((entry): entry is NearbyCohortSummary => entry !== null)
      .filter((entry) => entry.group.address.geographicPath === currentGroup.address.geographicPath
        && entry.group.address.cohortPath.length === currentGroup.address.cohortPath.length);
    this.groupCount = new Set(cohorts.map((entry) => entry.group.roomId)).size || 1;
    this.status = 'ready';
  }

  meetAnotherGroup(): Promise<void> {
    return this.enqueue('visiting', async () => {
      const context = this.requireContext();
      const source = this.activeGroup ?? context.defaultGroup;
      const page = await this.options.api.summaries({
        context,
        areaBindingId: nearbyAreaBindingId({
          checkpoint: context.checkpoint,
          privacyMode: context.privacyMode,
          geographicPath: source.address.geographicPath,
        }),
        currentGroup: source,
        limit: NEARBY_COHORT_SUMMARY_LIMIT,
      });
      const summaries = page.cohorts
        .slice(0, NEARBY_COHORT_SUMMARY_LIMIT)
        .map(normalizeSummary)
        .filter((entry): entry is NearbyCohortSummary => entry !== null);
      this.groupCount = new Set(summaries
        .filter((entry) => entry.group.address.geographicPath === source.address.geographicPath)
        .map((entry) => entry.group.roomId)).size || 1;
      const ordered = this.visitOrder(
        source,
        summaries.filter((entry) => eligibleForSameArea(source, entry)).map((entry) => entry.group),
      );
      if (ordered.length === 0) {
        throw new NearbyCohortTraversalError('full', 'No other Nearby group currently has space');
      }

      let sawFull = false;
      for (const target of ordered) {
        try {
          await this.move(source, target);
          return;
        } catch (error) {
          if (error instanceof NearbyCohortTraversalError && error.code === 'full') {
            sawFull = true;
            continue;
          }
          throw error;
        }
      }
      throw new NearbyCohortTraversalError(
        sawFull ? 'full' : 'error',
        sawFull ? 'Every eligible Nearby group became full' : 'No eligible Nearby group is available',
      );
    });
  }

  returnToDefaultGroup(): Promise<void> {
    return this.enqueue('returning', async () => {
      const context = this.requireContext();
      const source = this.activeGroup ?? context.defaultGroup;
      if (sameGroup(source, context.defaultGroup)) return;
      await this.move(source, context.defaultGroup);
    });
  }

  private enqueue(pending: 'visiting' | 'returning', operation: () => Promise<void>): Promise<void> {
    this.status = pending;
    const run = this.operation.then(operation, operation)
      .then(() => {
        this.status = 'ready';
        this.lastError = null;
      })
      .catch((error) => {
        this.status = statusFor(error);
        this.lastError = error instanceof Error ? error.message : String(error);
      });
    this.operation = run;
    return run;
  }

  private async move(
    source: NearbyPartitionGroupV2,
    target: NearbyPartitionGroupV2,
  ): Promise<void> {
    const context = this.requireContext();
    const nextOrdinal = this.visitOrdinal + 1;
    let reservation: NearbyCohortReservation;
    try {
      reservation = await this.options.api.reserve({
        context,
        fromGroup: source,
        targetGroup: target,
        visitOrdinal: nextOrdinal,
      });
    } catch (error) {
      throw normalizeApiError(error);
    }
    let stopped = false;
    let committed = false;
    try {
      await this.options.handoff.stopOld(source);
      stopped = true;
      const result = await this.options.api.commit({ context, reservation });
      committed = true;
      if (!sameGroup(result.activeGroup, target)) {
        throw new NearbyCohortTraversalError('conflict', 'Nearby cohort commit selected another group');
      }
      this.activeGroup = target;
      this.committedSelection = reservation.selection;
      this.visitOrdinal = nextOrdinal;
      this.remember(source.roomId);
      this.remember(target.roomId);
      // Persist before starting the target: a hard restart must never flash/start default after a
      // successful server commit.
      this.persist(context);
      try {
        await this.options.handoff.startTarget(target);
      } catch (firstStartError) {
        // The index already made the target authoritative. Never resurrect/cancel the old claim at
        // this point: retry the idempotent local start once, while the persisted target guarantees
        // the next process boot also starts the committed room directly.
        try {
          await this.options.handoff.startTarget(target);
        } catch {
          throw firstStartError;
        }
      }
    } catch (error) {
      if (!committed) {
        await this.options.api.cancel({ context, reservation }).catch(() => undefined);
        if (stopped) await this.options.handoff.restoreOld(source).catch(() => undefined);
      }
      throw normalizeApiError(error);
    }
  }

  private visitOrder(
    source: NearbyPartitionGroupV2,
    groups: NearbyPartitionGroupV2[],
  ): NearbyPartitionGroupV2[] {
    const context = this.requireContext();
    const deduped = [...new Map(groups.map((group) => [group.roomId, group])).values()];
    const recent = new Set(this.recentRoomIds);
    const score = (group: NearbyPartitionGroupV2): string => portableSha256Hex(canonicalSerialize({
      domain: 'iinpublic:nearby-cohort-visit-order:v1',
      checkpoint: checkpointKey(context.checkpoint),
      rootRoomId: nearbyCohortRootGroup(context.checkpoint).roomId,
      pub: context.pair.pub,
      geographicPath: source.address.geographicPath,
      cohortDepth: source.address.cohortPath.length,
      targetRoomId: group.roomId,
    }));
    return deduped.sort((left, right) => {
      const recentDifference = Number(recent.has(left.roomId)) - Number(recent.has(right.roomId));
      if (recentDifference !== 0) return recentDifference;
      return score(left).localeCompare(score(right));
    });
  }

  private remember(roomId: string): void {
    this.recentRoomIds = [
      ...this.recentRoomIds.filter((candidate) => candidate !== roomId),
      roomId,
    ].slice(-NEARBY_COHORT_RECENT_LIMIT);
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private requireContext(): NearbyCohortTraversalContext {
    if (!this.context) throw new NearbyCohortTraversalError('invalid', 'Nearby cohort traversal is not initialized');
    return this.context;
  }

  private readPersisted(context: NearbyCohortTraversalContext): PersistedTraversal | null {
    try {
      const raw = this.options.storage.getItem(storageKey(context));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PersistedTraversal;
      return persistedMatchesContext(parsed, context) ? parsed : null;
    } catch {
      return null;
    }
  }

  private persist(context: NearbyCohortTraversalContext): void {
    if (!this.activeGroup) return;
    const value: PersistedTraversal = {
      version: 1,
      checkpointKey: checkpointKey(context.checkpoint),
      userId: context.userId,
      pub: context.pair.pub,
      privacyMode: context.privacyMode,
      defaultGroup: context.defaultGroup,
      activeGroup: this.activeGroup,
      ...(this.committedSelection ? { committedSelection: this.committedSelection } : {}),
      visitOrdinal: this.visitOrdinal,
      recentRoomIds: this.recentRoomIds.slice(-NEARBY_COHORT_RECENT_LIMIT),
      committedAt: this.now().toISOString(),
    };
    try {
      this.options.storage.setItem(storageKey(context), JSON.stringify(value));
    } catch {
      // The committed server claim remains authoritative; persistence is a restart optimization.
    }
  }

  private clearPersisted(context: NearbyCohortTraversalContext): void {
    try {
      this.options.storage.removeItem(storageKey(context));
    } catch {
      // Best effort only.
    }
  }
}

function normalizeApiError(error: unknown): NearbyCohortTraversalError {
  if (error instanceof NearbyCohortTraversalError) return error;
  const candidate = error as { code?: unknown; status?: unknown; message?: unknown } | null;
  const code = String(candidate?.code || '');
  const status = Number(candidate?.status);
  const message = typeof candidate?.message === 'string'
    ? candidate.message
    : 'Nearby cohort handoff failed';
  if (code === 'target-full' || status === 409 && /full/i.test(message)) {
    return new NearbyCohortTraversalError('full', message);
  }
  if (status === 0 || status === 503 || code === 'policy-unavailable' || /offline|network|fetch/i.test(message)) {
    return new NearbyCohortTraversalError('offline', message);
  }
  if (status === 400 || code === 'target-inactive') {
    return new NearbyCohortTraversalError('invalid', message);
  }
  if (status === 409) return new NearbyCohortTraversalError('conflict', message);
  return new NearbyCohortTraversalError('error', message);
}
