import type { RoomProtocolCheckpoint } from './active-exchange-room';
import {
  NEARBY_COHORT_PROTOCOL_VERSION,
  nearbyCohortRootGroup,
  parseNearbyManualCohortSelection,
  parseNearbyPartitionTransitionV2,
  type NearbyManualCohortSelection,
  type NearbyPartitionTransitionV2,
} from './nearby-cohort-protocol';
import {
  NEARBY_PARTITION_MAX_CHAIN,
  nearbyPartitionRootGroup,
  parseNearbyPartitionTransition,
  type NearbyPartitionTransition,
} from './nearby-partition';
import {
  type ProtocolManifestBody,
} from './protocol-manifest';
import { canonicalSerialize } from './p2p-runtime';
import { portableSha256Hex } from './portable-sha256';

/**
 * Mixed-release bridge for the v1 combined spatial/identity path and the v2 split
 * geographic/cohort address. It deliberately does not allocate cohorts: it only decides when the
 * new protocol is safe to use, separates its records from legacy records, and journals local state
 * without deleting the rollback-readable v1 cache.
 */
export const NEARBY_VISITABLE_COHORT_CAPABILITY = 'nearby-visitable-cohorts-v2';
export const NEARBY_VISITABLE_COHORT_ROOM_PROTOCOL_VERSION = 2;
export const NEARBY_COHORT_MIGRATION_STATE_VERSION = 3;

const MIGRATION_KIND = 'iinpublic-nearby-cohort-migration';
export const NEARBY_RELEASE_2_LOCAL_STATE_KIND = 'iinpublic-nearby-cohort-local-state';
const MIGRATION_STORAGE_PREFIX = 'iinpublic_nearby_cohort_migration_v3:';
const LEGACY_LINEAGE_STORAGE_PREFIX = 'iinpublic_nearby_partition_lineage_v1:';
const MAX_LOCAL_STATE_BYTES = 256 * 1024;
const MAX_LEGACY_LINEAGE_BYTES = 7_500_000;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export type NearbyCohortEndpointSupport = {
  roomProtocolVersion: number;
  capabilities: readonly string[];
};

export type NearbyCohortMigrationPolicy = {
  mode: 'legacy-v1' | 'cohort-v2' | 'network-retired';
  legacyAdmissionAllowed: boolean;
  manualSelectionAllowed: boolean;
  reason: string;
};

/**
 * A verified signed manifest is the only authority that can activate or retire cohort behavior.
 * During the compatibility window, any missing client/index capability falls back to the legacy
 * room. Retirement is deliberately stricter: the manifest must require both room protocol 2 and
 * the cohort capability, select network-only retirement, and carry an elapsed legacy cutoff.
 */
export function evaluateNearbyCohortMigrationPolicy(input: {
  checkpoint: RoomProtocolCheckpoint;
  manifest?: ProtocolManifestBody | null;
  manifestVerified: boolean;
  client: NearbyCohortEndpointSupport;
  index: NearbyCohortEndpointSupport;
  now?: Date;
}): NearbyCohortMigrationPolicy {
  const now = input.now ?? new Date();
  const manifest = input.manifest;
  const manifestApplies = !!manifest
    && input.manifestVerified
    && manifest.networkId === input.checkpoint.networkId
    && manifest.sequence === input.checkpoint.manifestSequence
    && manifest.protocolEpoch === input.checkpoint.protocolEpoch
    && manifest.chatroomCapacity === input.checkpoint.chatroomCapacity
    && now.getTime() >= Date.parse(manifest.effectiveAt);

  if (!manifestApplies || !manifest) {
    return {
      mode: 'legacy-v1',
      legacyAdmissionAllowed: true,
      manualSelectionAllowed: false,
      reason: 'verified cohort policy is not active',
    };
  }

  const advertised = manifest.requiredCapabilities.includes(NEARBY_VISITABLE_COHORT_CAPABILITY)
    || manifest.optionalCapabilities.includes(NEARBY_VISITABLE_COHORT_CAPABILITY);
  const clientReady = input.client.roomProtocolVersion >= NEARBY_VISITABLE_COHORT_ROOM_PROTOCOL_VERSION
    && input.client.capabilities.includes(NEARBY_VISITABLE_COHORT_CAPABILITY);
  const indexReady = input.index.roomProtocolVersion >= NEARBY_VISITABLE_COHORT_ROOM_PROTOCOL_VERSION
    && input.index.capabilities.includes(NEARBY_VISITABLE_COHORT_CAPABILITY);
  const cutoff = manifest.legacyEpochAllowedUntil
    ? Date.parse(manifest.legacyEpochAllowedUntil)
    : Number.POSITIVE_INFINITY;
  const legacyRetired = manifest.retirementMode === 'network-only'
    && manifest.minimumRoomProtocol >= NEARBY_VISITABLE_COHORT_ROOM_PROTOCOL_VERSION
    && manifest.requiredCapabilities.includes(NEARBY_VISITABLE_COHORT_CAPABILITY)
    && Number.isFinite(cutoff)
    && now.getTime() >= cutoff;

  if (advertised && clientReady && indexReady) {
    return {
      mode: 'cohort-v2',
      legacyAdmissionAllowed: !legacyRetired,
      manualSelectionAllowed: true,
      reason: legacyRetired
        ? 'cohort protocol active; legacy admission retired by signed policy'
        : 'cohort protocol active with legacy fallback',
    };
  }
  if (legacyRetired) {
    return {
      mode: 'network-retired',
      legacyAdmissionAllowed: false,
      manualSelectionAllowed: false,
      reason: 'this client or index lacks the signed required cohort protocol',
    };
  }
  return {
    mode: 'legacy-v1',
    legacyAdmissionAllowed: true,
    manualSelectionAllowed: false,
    reason: advertised
      ? 'cohort capability is not available at both endpoints'
      : 'signed policy has not advertised cohort support',
  };
}

export type NearbyMixedReleaseRecord =
  | { kind: 'legacy-transition'; transition: NearbyPartitionTransition }
  | { kind: 'cohort-transition'; transition: NearbyPartitionTransitionV2 }
  | { kind: 'manual-cohort-selection'; selection: NearbyManualCohortSelection }
  | { kind: 'unknown' };

/**
 * Parse each wire family independently. In particular, a manual selection never becomes a v1
 * quadtree path, and a v1 identity-lane suffix never becomes v2 geography.
 */
export function classifyNearbyMixedReleaseRecord(value: unknown): NearbyMixedReleaseRecord {
  const legacy = parseNearbyPartitionTransition(value);
  if (legacy) return { kind: 'legacy-transition', transition: legacy };
  const cohort = parseNearbyPartitionTransitionV2(value);
  if (cohort) return { kind: 'cohort-transition', transition: cohort };
  const selection = parseNearbyManualCohortSelection(value);
  if (selection) return { kind: 'manual-cohort-selection', selection };
  return { kind: 'unknown' };
}

export type VerifiedLegacyNearbyMember = {
  pub: string;
  enteredAt: string;
  claimId: string;
};

/**
 * Bound an already-verified legacy view for an old client. Stable key de-duplication and a
 * content-derived tie-break make the result independent of merge order; callers must verify claim
 * signatures/scope before invoking this compatibility adapter.
 */
export function boundVerifiedLegacyNearbyView<T extends VerifiedLegacyNearbyMember>(
  claims: readonly T[],
  checkpoint: Pick<RoomProtocolCheckpoint, 'chatroomCapacity'>,
): T[] {
  const capacity = checkpoint.chatroomCapacity;
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 1_000_000) {
    throw new Error('Nearby legacy capacity is invalid');
  }
  const valid = claims.filter((claim) => claim.pub
    && claim.claimId
    && Number.isFinite(Date.parse(claim.enteredAt)));
  const ordered = [...valid].sort((left, right) =>
    Date.parse(left.enteredAt) - Date.parse(right.enteredAt)
    || left.claimId.localeCompare(right.claimId)
    || left.pub.localeCompare(right.pub));
  const unique = new Map<string, T>();
  for (const claim of ordered) {
    if (!unique.has(claim.pub)) unique.set(claim.pub, claim);
  }
  return [...unique.values()].slice(0, capacity);
}

export type NearbyLegacyPathBoundary = {
  geographicPath: string;
  legacyIdentityLanePath: string;
  /** Always false: v2 must derive a fresh binary cohort path under verified v2 transitions. */
  canTranslateIdentityLaneToV2: false;
};

export function separateLegacyNearbyPath(input: {
  path: string;
  geographicDepth: number;
}): NearbyLegacyPathBoundary {
  if (!/^[0-3]{0,24}$/.test(input.path)
    || !Number.isSafeInteger(input.geographicDepth)
    || input.geographicDepth < 0
    || input.geographicDepth > input.path.length) {
    throw new Error('Nearby legacy path boundary is invalid');
  }
  return {
    geographicPath: input.path.slice(0, input.geographicDepth),
    legacyIdentityLanePath: input.path.slice(input.geographicDepth),
    canTranslateIdentityLaneToV2: false,
  };
}

export type NearbyRelease2CommittedState = {
  version: 2;
  kind: typeof NEARBY_RELEASE_2_LOCAL_STATE_KIND;
  checkpoint: RoomProtocolCheckpoint;
  legacyRootRoomId: string;
  legacyActiveRoomId: string | null;
  committedSelection: NearbyManualCohortSelection | null;
};

export type NearbyCohortMigrationState = {
  schemaVersion: typeof NEARBY_COHORT_MIGRATION_STATE_VERSION;
  kind: typeof MIGRATION_KIND;
  scopeId: string;
  checkpoint: RoomProtocolCheckpoint;
  migrationId: string;
  migratedAt: string;
  sourceRelease: 1 | 2;
  legacy: {
    rootRoomId: string;
    activeRoomId: string | null;
    lineageStorageKey: string;
    lineageDigest: string;
    transitionIds: string[];
    retainedForRollback: true;
  };
  /** Release-2 selections are candidates until the current runtime re-verifies proof and expiry. */
  cohortCandidate: null | {
    protocolVersion: typeof NEARBY_COHORT_PROTOCOL_VERSION;
    committedSelection: NearbyManualCohortSelection;
    requiresReverification: true;
  };
};

export type NearbyCohortMigrationResult = {
  state: NearbyCohortMigrationState;
  status: 'already-migrated' | 'migrated' | 'recovered-pending' | 'pending-only';
};

export function nearbyCohortMigrationStorageKey(
  scopeId: string,
  slot: 'pending' | 'committed',
): string {
  const normalized = String(scopeId || '').trim();
  if (!normalized || normalized.length > 256) throw new Error('Nearby migration scope is invalid');
  const scopeHash = portableSha256Hex(`iinpublic:nearby-cohort-migration-scope:v1:${normalized}`).slice(0, 24);
  return `${MIGRATION_STORAGE_PREFIX}${scopeHash}:${slot}`;
}

export function nearbyLegacyLineageStorageKey(rootRoomId: string): string {
  return `${LEGACY_LINEAGE_STORAGE_PREFIX}${rootRoomId}`;
}

/** Read the committed slot first, then the write-ahead slot left by an interrupted commit. */
export function readNearbyCohortMigrationState(input: {
  storage: Pick<Storage, 'getItem'>;
  scopeId: string;
  checkpoint: RoomProtocolCheckpoint;
}): { state: NearbyCohortMigrationState; slot: 'committed' | 'pending' } | null {
  for (const slot of ['committed', 'pending'] as const) {
    let raw: string | null;
    try {
      raw = input.storage.getItem(nearbyCohortMigrationStorageKey(input.scopeId, slot));
    } catch {
      return null;
    }
    const parsed = parseMigrationState(raw, input.scopeId, input.checkpoint);
    if (parsed) return { state: parsed, slot };
  }
  return null;
}

/**
 * One-time, write-ahead migration. The old v1 lineage key is only read and is intentionally never
 * removed or rewritten, so a rollback release can keep using it. A release-3 client may migrate
 * directly from release 1; release-2 committed state is preserved only as a re-verification
 * candidate and can never start exchange merely because it existed in local storage.
 */
export function migrateNearbyCohortLocalState(input: {
  storage: StorageLike;
  scopeId: string;
  checkpoint: RoomProtocolCheckpoint;
  legacyActiveRoomId?: string | null;
  release2StorageKey?: string;
  now?: Date;
}): NearbyCohortMigrationResult {
  const existing = readNearbyCohortMigrationState(input);
  if (existing?.slot === 'committed') {
    return { state: existing.state, status: 'already-migrated' };
  }
  if (existing?.slot === 'pending') {
    try {
      input.storage.setItem(
        nearbyCohortMigrationStorageKey(input.scopeId, 'committed'),
        JSON.stringify(existing.state),
      );
      return { state: existing.state, status: 'recovered-pending' };
    } catch {
      return { state: existing.state, status: 'pending-only' };
    }
  }

  const legacyRootRoomId = nearbyPartitionRootGroup(input.checkpoint).roomId;
  const lineageStorageKey = nearbyLegacyLineageStorageKey(legacyRootRoomId);
  const legacyTransitions = readLegacyTransitions(input.storage, lineageStorageKey);
  const release2 = input.release2StorageKey
    ? readRelease2State(input.storage, input.release2StorageKey, input.checkpoint, legacyRootRoomId)
    : null;
  const activeRoomId = release2?.legacyActiveRoomId
    ?? normalizeLegacyRoomId(input.legacyActiveRoomId, legacyRootRoomId, legacyTransitions);
  const transitionIds = legacyTransitions.map((transition) => transition.transitionId);
  const lineageDigest = portableSha256Hex(canonicalSerialize(transitionIds));
  const sourceRelease = release2 ? 2 : 1;
  const migratedAt = (input.now ?? new Date()).toISOString();
  const candidate = release2?.committedSelection ?? null;
  const migrationId = migrationIdFor({
    scopeId: input.scopeId,
    checkpoint: input.checkpoint,
    sourceRelease,
    legacyRootRoomId,
    activeRoomId,
    lineageDigest,
    candidate,
  });
  const state: NearbyCohortMigrationState = {
    schemaVersion: NEARBY_COHORT_MIGRATION_STATE_VERSION,
    kind: MIGRATION_KIND,
    scopeId: input.scopeId,
    checkpoint: { ...input.checkpoint },
    migrationId,
    migratedAt,
    sourceRelease,
    legacy: {
      rootRoomId: legacyRootRoomId,
      activeRoomId,
      lineageStorageKey,
      lineageDigest,
      transitionIds,
      retainedForRollback: true,
    },
    cohortCandidate: candidate ? {
      protocolVersion: NEARBY_COHORT_PROTOCOL_VERSION,
      committedSelection: candidate,
      requiresReverification: true,
    } : null,
  };
  const serialized = JSON.stringify(state);
  if (serialized.length > MAX_LOCAL_STATE_BYTES) throw new Error('Nearby migration state exceeds its size bound');
  input.storage.setItem(nearbyCohortMigrationStorageKey(input.scopeId, 'pending'), serialized);
  try {
    input.storage.setItem(nearbyCohortMigrationStorageKey(input.scopeId, 'committed'), serialized);
    return { state, status: 'migrated' };
  } catch {
    return { state, status: 'pending-only' };
  }
}

function readLegacyTransitions(storage: Pick<Storage, 'getItem'>, key: string): NearbyPartitionTransition[] {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return [];
  }
  if (!raw || raw.length > MAX_LEGACY_LINEAGE_BYTES) return [];
  try {
    const values = JSON.parse(raw) as unknown;
    if (!Array.isArray(values)) return [];
    const unique = new Map<string, NearbyPartitionTransition>();
    for (const value of values.slice(0, NEARBY_PARTITION_MAX_CHAIN * 4)) {
      const transition = parseNearbyPartitionTransition(value);
      if (transition) unique.set(transition.transitionId, transition);
    }
    return [...unique.values()].slice(-NEARBY_PARTITION_MAX_CHAIN);
  } catch {
    return [];
  }
}

function readRelease2State(
  storage: Pick<Storage, 'getItem'>,
  key: string,
  checkpoint: RoomProtocolCheckpoint,
  legacyRootRoomId: string,
): NearbyRelease2CommittedState | null {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (!raw || raw.length > MAX_LOCAL_STATE_BYTES) return null;
  try {
    const value = JSON.parse(raw) as Partial<NearbyRelease2CommittedState>;
    if (value.version !== 2
      || value.kind !== NEARBY_RELEASE_2_LOCAL_STATE_KIND
      || !sameCheckpoint(value.checkpoint, checkpoint)
      || value.legacyRootRoomId !== legacyRootRoomId
      || (value.legacyActiveRoomId !== null && typeof value.legacyActiveRoomId !== 'string')
      || (value.committedSelection !== null
        && !parseNearbyManualCohortSelection(value.committedSelection))) return null;
    if (value.committedSelection
      && value.committedSelection.rootRoomId !== nearbyCohortRootGroup(checkpoint).roomId) return null;
    return value as NearbyRelease2CommittedState;
  } catch {
    return null;
  }
}

function parseMigrationState(
  raw: string | null,
  scopeId: string,
  checkpoint: RoomProtocolCheckpoint,
): NearbyCohortMigrationState | null {
  if (!raw || raw.length > MAX_LOCAL_STATE_BYTES) return null;
  try {
    const value = JSON.parse(raw) as Partial<NearbyCohortMigrationState>;
    if (value.schemaVersion !== NEARBY_COHORT_MIGRATION_STATE_VERSION
      || value.kind !== MIGRATION_KIND
      || value.scopeId !== scopeId
      || !sameCheckpoint(value.checkpoint, checkpoint)
      || typeof value.migrationId !== 'string'
      || !/^[a-f0-9]{64}$/.test(value.migrationId)
      || typeof value.migratedAt !== 'string'
      || !Number.isFinite(Date.parse(value.migratedAt))
      || (value.sourceRelease !== 1 && value.sourceRelease !== 2)
      || !value.legacy
      || value.legacy.rootRoomId !== nearbyPartitionRootGroup(checkpoint).roomId
      || (value.legacy.activeRoomId !== null && typeof value.legacy.activeRoomId !== 'string')
      || value.legacy.lineageStorageKey !== nearbyLegacyLineageStorageKey(value.legacy.rootRoomId)
      || typeof value.legacy.lineageDigest !== 'string'
      || !/^[a-f0-9]{64}$/.test(value.legacy.lineageDigest)
      || !Array.isArray(value.legacy.transitionIds)
      || value.legacy.transitionIds.length > NEARBY_PARTITION_MAX_CHAIN
      || value.legacy.transitionIds.some((id) => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))
      || value.legacy.retainedForRollback !== true) return null;
    if (value.legacy.lineageDigest
      !== portableSha256Hex(canonicalSerialize(value.legacy.transitionIds))) return null;
    if (value.cohortCandidate !== null) {
      if (!value.cohortCandidate
        || value.cohortCandidate.protocolVersion !== NEARBY_COHORT_PROTOCOL_VERSION
        || value.cohortCandidate.requiresReverification !== true
        || !parseNearbyManualCohortSelection(value.cohortCandidate.committedSelection)) return null;
      if (!sameCheckpoint(value.cohortCandidate.committedSelection.checkpoint, checkpoint)
        || value.cohortCandidate.committedSelection.rootRoomId
          !== nearbyCohortRootGroup(checkpoint).roomId) return null;
    }
    const expectedMigrationId = migrationIdFor({
      scopeId,
      checkpoint,
      sourceRelease: value.sourceRelease,
      legacyRootRoomId: value.legacy.rootRoomId,
      activeRoomId: value.legacy.activeRoomId,
      lineageDigest: value.legacy.lineageDigest,
      candidate: value.cohortCandidate?.committedSelection ?? null,
    });
    if (value.migrationId !== expectedMigrationId) return null;
    return value as NearbyCohortMigrationState;
  } catch {
    return null;
  }
}

function migrationIdFor(input: {
  scopeId: string;
  checkpoint: RoomProtocolCheckpoint;
  sourceRelease: 1 | 2;
  legacyRootRoomId: string;
  activeRoomId: string | null;
  lineageDigest: string;
  candidate: NearbyManualCohortSelection | null;
}): string {
  return portableSha256Hex(canonicalSerialize({
    domain: 'iinpublic:nearby-cohort-migration:v3',
    scopeId: input.scopeId,
    checkpoint: input.checkpoint,
    sourceRelease: input.sourceRelease,
    legacyRootRoomId: input.legacyRootRoomId,
    activeRoomId: input.activeRoomId,
    lineageDigest: input.lineageDigest,
    candidateId: input.candidate?.proof.signature || null,
  }));
}

function normalizeLegacyRoomId(
  value: string | null | undefined,
  rootRoomId: string,
  transitions: NearbyPartitionTransition[],
): string | null {
  if (value == null) return null;
  if (value === rootRoomId) return value;
  const known = transitions.some((transition) =>
    transition.fromGroups.some((group) => group.roomId === value)
    || transition.toGroups.some((group) => group.roomId === value));
  return known ? value : null;
}

function sameCheckpoint(
  left: RoomProtocolCheckpoint | undefined,
  right: RoomProtocolCheckpoint,
): left is RoomProtocolCheckpoint {
  return !!left
    && left.networkId === right.networkId
    && left.protocolEpoch === right.protocolEpoch
    && left.manifestSequence === right.manifestSequence
    && left.manifestHash === right.manifestHash
    && left.chatroomCapacity === right.chatroomCapacity;
}
