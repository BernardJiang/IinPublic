import { canonicalSerialize } from './p2p-runtime';
import {
  verifyMutualDeviceSyncAuthorization,
  type DeviceSyncAuthorization,
  type DeviceSyncRevocation,
} from './device-sync-authorization';
import {
  DEVICE_SYNC_DATA_INVENTORY,
  verifyAndAcknowledgeDeviceSyncBundle,
  verifyDeviceSyncAcknowledgement,
  verifyDeviceSyncBundle,
  type DeviceSyncAcknowledgement,
  type DeviceSyncBundle,
  type DeviceSyncCategory,
  type DeviceSyncConvergence,
  type DeviceSyncCrypto,
  type DeviceSyncRecord,
} from './device-sync-contract';

export interface DeviceSyncImportConflict {
  category: DeviceSyncCategory;
  recordId: string;
  reason: 'immutable-id-collision' | 'ambiguous-concurrent-edit';
  local: DeviceSyncRecord;
  incoming: DeviceSyncRecord;
}

export interface DeviceSyncImportProgress {
  version: 1;
  checkpointId: string;
  status: 'importing' | 'interrupted' | 'conflicted' | 'complete';
  processedRecordKeys: string[];
  appliedCount: number;
  retainedLocalCount: number;
  conflicts: DeviceSyncImportConflict[];
  /** User-approved local winners for otherwise ambiguous incoming records. */
  keptLocalConflictKeys: string[];
  updatedAt: string;
  lastError?: string;
}

/**
 * Storage boundary for imported private records. Implementations must encrypt
 * values with the receiving installation's local custody before persistence.
 */
export interface DeviceSyncCustodyStore {
  readonly protection: 'receiving-device-local-custody';
  readRecord(category: DeviceSyncCategory, recordId: string): Promise<DeviceSyncRecord | null>;
  writeRecord(record: DeviceSyncRecord): Promise<void>;
  readProgress(checkpointId: string): Promise<DeviceSyncImportProgress | null>;
  writeProgress(progress: DeviceSyncImportProgress): Promise<void>;
  readAcknowledgement(checkpointId: string): Promise<DeviceSyncAcknowledgement | null>;
  writeAcknowledgement(acknowledgement: DeviceSyncAcknowledgement): Promise<void>;
  readHead(sourceDevicePub: string): Promise<string | null>;
  writeHead(sourceDevicePub: string, checkpointId: string): Promise<void>;
}

export type DeviceSyncImportResult =
  | { ok: true; status: 'complete'; acknowledgement: DeviceSyncAcknowledgement; progress: DeviceSyncImportProgress }
  | { ok: false; status: 'rejected'; reason: string }
  | { ok: false; status: 'interrupted'; reason: string; progress: DeviceSyncImportProgress }
  | { ok: false; status: 'conflicted'; conflicts: DeviceSyncImportConflict[]; progress: DeviceSyncImportProgress };

export interface DeviceSyncConflictDecision {
  category: DeviceSyncCategory;
  recordId: string;
  resolution: 'keep-local' | 'use-incoming';
}

/** Persist explicit user choices, then call the authorized importer again to finish and acknowledge. */
export async function resolveDeviceSyncImportConflicts(input: {
  store: DeviceSyncCustodyStore;
  checkpointId: string;
  decisions: readonly DeviceSyncConflictDecision[];
  now?: () => Date;
}): Promise<DeviceSyncImportProgress> {
  const progress = await input.store.readProgress(input.checkpointId);
  if (!progress || progress.status !== 'conflicted' || progress.conflicts.length === 0) throw new Error('no unresolved sync conflicts for checkpoint');
  const decisions = new Map(input.decisions.map((decision) => [recordKey(decision), decision]));
  if (decisions.size !== input.decisions.length) throw new Error('duplicate sync conflict decision');
  if (decisions.size !== progress.conflicts.length) throw new Error('every sync conflict requires a decision');
  const processed = new Set(progress.processedRecordKeys);
  const keptLocal = new Set(progress.keptLocalConflictKeys ?? []);
  for (const conflict of progress.conflicts) {
    const key = recordKey(conflict);
    const decision = decisions.get(key);
    if (!decision) throw new Error(`missing sync conflict decision: ${conflict.category}/${conflict.recordId}`);
    if (decision.resolution === 'use-incoming') {
      await input.store.writeRecord(conflict.incoming);
      progress.appliedCount += 1;
      keptLocal.delete(key);
    } else {
      progress.retainedLocalCount += 1;
      keptLocal.add(key);
    }
    processed.add(key);
  }
  const resolved = withTimestamp({
    ...progress,
    status: 'importing',
    conflicts: [],
    processedRecordKeys: [...processed].sort(),
    keptLocalConflictKeys: [...keptLocal].sort(),
  }, input.now);
  await input.store.writeProgress(resolved);
  return resolved;
}

/** Public receiver entry point: data import is unavailable without separate mutual consent. */
export async function importAuthorizedDeviceSyncBundle(input: {
  bundle: DeviceSyncBundle;
  authorizations: readonly [DeviceSyncAuthorization, DeviceSyncAuthorization];
  revocations?: readonly DeviceSyncRevocation[];
  targetDevicePub: string;
  targetCrypto: DeviceSyncCrypto;
  store: DeviceSyncCustodyStore;
  now?: () => Date;
}): Promise<DeviceSyncImportResult> {
  const authorization = await verifyMutualDeviceSyncAuthorization({
    authorizations: input.authorizations,
    ...(input.revocations ? { revocations: input.revocations } : {}),
    sourceDevicePub: input.bundle.manifest.source.devicePub,
    targetDevicePub: input.targetDevicePub,
    selectedCategories: input.bundle.manifest.selectedCategories,
    crypto: input.targetCrypto,
    now: input.now?.() ?? new Date(),
  });
  if (!authorization.ok) return { ok: false, status: 'rejected', reason: authorization.reason };
  if (authorization.authorizationId !== input.bundle.manifest.authorizationId) {
    return { ok: false, status: 'rejected', reason: 'manifest authorization id mismatch' };
  }
  return importDeviceSyncBundle({
    bundle: input.bundle,
    targetDevicePub: input.targetDevicePub,
    targetCrypto: input.targetCrypto,
    store: input.store,
    ...(input.now ? { now: input.now } : {}),
  });
}

/**
 * Low-level verified import primitive. Application/transport callers must use
 * importAuthorizedDeviceSyncBundle so an identity link alone cannot authorize
 * private data transfer. Progress is persisted after each item so a new
 * importer instance can safely resume.
 */
export async function importDeviceSyncBundle(input: {
  bundle: DeviceSyncBundle;
  targetDevicePub: string;
  targetCrypto: DeviceSyncCrypto;
  store: DeviceSyncCustodyStore;
  now?: () => Date;
}): Promise<DeviceSyncImportResult> {
  if (input.store.protection !== 'receiving-device-local-custody') {
    return { ok: false, status: 'rejected', reason: 'import store does not provide receiving-device custody' };
  }
  const verification = await verifyDeviceSyncBundle(input.bundle, input.targetCrypto, {
    targetDevicePub: input.targetDevicePub,
  });
  if (!verification.ok) return { ok: false, status: 'rejected', reason: verification.reason };

  const { manifest } = input.bundle;
  const existingAck = await input.store.readAcknowledgement(manifest.checkpointId);
  if (existingAck) {
    const ackVerification = await verifyDeviceSyncAcknowledgement(existingAck, manifest, input.targetCrypto);
    if (ackVerification.ok) {
      let completeProgress = await input.store.readProgress(manifest.checkpointId) ?? newProgress(manifest.checkpointId, input.now);
      const needsHeadRepair = completeProgress.status !== 'complete';
      try {
        // Repair the small crash window between acknowledgement persistence and
        // head/progress persistence before reporting this retry complete.
        if (needsHeadRepair) await input.store.writeHead(manifest.source.devicePub, manifest.checkpointId);
        completeProgress = await persistProgress(input.store, withoutLastError(completeProgress, 'complete'), input.now);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { ok: false, status: 'interrupted', reason, progress: withTimestamp({ ...completeProgress, status: 'interrupted', lastError: reason }, input.now) };
      }
      return { ok: true, status: 'complete', acknowledgement: existingAck, progress: completeProgress };
    }
    return { ok: false, status: 'rejected', reason: 'stored acknowledgement is invalid' };
  }

  if (manifest.mode === 'delta') {
    const head = await input.store.readHead(manifest.source.devicePub);
    if (head !== manifest.previousCheckpointId) {
      return { ok: false, status: 'rejected', reason: 'delta predecessor does not match imported checkpoint' };
    }
  }

  let progress = await input.store.readProgress(manifest.checkpointId) ?? newProgress(manifest.checkpointId, input.now);
  const processed = new Set(progress.processedRecordKeys);
  const records = [...input.bundle.records].sort((a, b) => recordKey(a).localeCompare(recordKey(b)));

  try {
    progress = await persistProgress(input.store, withoutLastError(progress, 'importing'), input.now);
    for (const incoming of records) {
      const key = recordKey(incoming);
      const local = await input.store.readRecord(incoming.category, incoming.recordId);
      const decision = chooseConvergedRecord(local, incoming);
      if (processed.has(key) && decision.kind === 'retain-local') continue;
      if (processed.has(key) && decision.kind === 'conflict' && (progress.keptLocalConflictKeys ?? []).includes(key)) continue;
      processed.delete(key);
      if (decision.kind === 'conflict') {
        progress.conflicts = replaceConflict(progress.conflicts, decision.conflict);
        progress = await persistProgress(input.store, { ...progress, status: 'conflicted' }, input.now);
        continue;
      }
      if (decision.kind === 'apply') {
        await input.store.writeRecord(incoming);
        progress.appliedCount += 1;
      } else {
        progress.retainedLocalCount += 1;
      }
      processed.add(key);
      progress.processedRecordKeys = [...processed].sort();
      progress = await persistProgress(input.store, progress, input.now);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const interrupted = withTimestamp({ ...progress, status: 'interrupted', lastError: reason }, input.now);
    try {
      await input.store.writeProgress(interrupted);
    } catch {
      // The same storage failure may prevent the marker; written records remain
      // safe because convergence makes the next attempt idempotent.
    }
    return { ok: false, status: 'interrupted', reason, progress: interrupted };
  }

  if (progress.conflicts.length > 0) {
    return { ok: false, status: 'conflicted', conflicts: progress.conflicts, progress };
  }

  const acknowledgementResult = await verifyAndAcknowledgeDeviceSyncBundle(
    input.bundle,
    input.targetCrypto,
    input.targetDevicePub,
    (input.now?.() ?? new Date()).toISOString(),
  );
  if (!acknowledgementResult.ok) return { ok: false, status: 'rejected', reason: acknowledgementResult.reason };
  try {
    await input.store.writeAcknowledgement(acknowledgementResult.acknowledgement);
    await input.store.writeHead(manifest.source.devicePub, manifest.checkpointId);
    progress = await persistProgress(input.store, withoutLastError(progress, 'complete'), input.now);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, status: 'interrupted', reason, progress: withTimestamp({ ...progress, status: 'interrupted', lastError: reason }, input.now) };
  }
  return { ok: true, status: 'complete', acknowledgement: acknowledgementResult.acknowledgement, progress };
}

export function chooseConvergedRecord(
  local: DeviceSyncRecord | null,
  incoming: DeviceSyncRecord,
):
  | { kind: 'apply' }
  | { kind: 'retain-local' }
  | { kind: 'conflict'; conflict: DeviceSyncImportConflict } {
  if (!local) return { kind: 'apply' };
  if (canonicalSerialize(local) === canonicalSerialize(incoming)) return { kind: 'retain-local' };
  const convergence = convergenceFor(incoming.category);
  if (convergence === 'immutable-union') {
    return { kind: 'conflict', conflict: { category: incoming.category, recordId: incoming.recordId, reason: 'immutable-id-collision', local, incoming } };
  }
  if (convergence === 'tombstoned' && local.tombstone !== incoming.tombstone) {
    return incoming.tombstone ? { kind: 'apply' } : { kind: 'retain-local' };
  }
  if (incoming.version !== local.version) return incoming.version > local.version ? { kind: 'apply' } : { kind: 'retain-local' };
  const timeOrder = incoming.updatedAt.localeCompare(local.updatedAt);
  if (timeOrder !== 0) return timeOrder > 0 ? { kind: 'apply' } : { kind: 'retain-local' };
  return { kind: 'conflict', conflict: { category: incoming.category, recordId: incoming.recordId, reason: 'ambiguous-concurrent-edit', local, incoming } };
}

function convergenceFor(category: DeviceSyncCategory): Exclude<DeviceSyncConvergence, 'device-local'> {
  const policy = DEVICE_SYNC_DATA_INVENTORY.find((entry) => entry.category === category);
  if (!policy || !policy.transferable) throw new Error(`missing convergence policy for ${category}`);
  return policy.convergence;
}

function newProgress(checkpointId: string, now?: () => Date): DeviceSyncImportProgress {
  return withTimestamp({
    version: 1,
    checkpointId,
    status: 'importing',
    processedRecordKeys: [],
    appliedCount: 0,
    retainedLocalCount: 0,
    conflicts: [],
    keptLocalConflictKeys: [],
  }, now);
}

function withTimestamp(
  progress: Omit<DeviceSyncImportProgress, 'updatedAt'> & { updatedAt?: string },
  now?: () => Date,
): DeviceSyncImportProgress {
  return { ...progress, updatedAt: (now?.() ?? new Date()).toISOString() };
}

async function persistProgress(
  store: DeviceSyncCustodyStore,
  progress: DeviceSyncImportProgress,
  now?: () => Date,
): Promise<DeviceSyncImportProgress> {
  const updated = withTimestamp(progress, now);
  await store.writeProgress(updated);
  return updated;
}

function replaceConflict(
  conflicts: DeviceSyncImportConflict[],
  next: DeviceSyncImportConflict,
): DeviceSyncImportConflict[] {
  return [...conflicts.filter((conflict) => recordKey(conflict) !== recordKey(next)), next]
    .sort((a, b) => recordKey(a).localeCompare(recordKey(b)));
}

function withoutLastError(
  progress: DeviceSyncImportProgress,
  status: DeviceSyncImportProgress['status'],
): DeviceSyncImportProgress {
  const { lastError, ...rest } = progress;
  void lastError;
  return { ...rest, status };
}

function recordKey(record: Pick<DeviceSyncRecord, 'category' | 'recordId'>): string {
  return `${record.category}\u0000${record.recordId}`;
}
