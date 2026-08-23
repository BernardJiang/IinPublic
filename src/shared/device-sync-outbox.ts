import {
  verifyMutualDeviceSyncAuthorization,
  type DeviceSyncAuthorization,
  type DeviceSyncRevocation,
} from './device-sync-authorization';
import {
  buildDeviceSyncBundle,
  verifyDeviceSyncAcknowledgement,
  type DeviceSyncAcknowledgement,
  type DeviceSyncBundle,
  type DeviceSyncCategory,
  type DeviceSyncCrypto,
  type DeviceSyncEndpoint,
  type DeviceSyncRecord,
} from './device-sync-contract';

export interface DeviceSyncOutboxEntry {
  sequence: number;
  record: DeviceSyncRecord;
  queuedAt: string;
}

export interface DeviceSyncInFlightDelta {
  throughSequence: number;
  bundle: DeviceSyncBundle;
}

export interface DeviceSyncOutboxState {
  version: 1;
  authorizationId: string;
  source: DeviceSyncEndpoint;
  target: DeviceSyncEndpoint;
  selectedCategories: DeviceSyncCategory[];
  nextSequence: number;
  lastAcknowledgedCheckpointId: string;
  entries: DeviceSyncOutboxEntry[];
  inFlight?: DeviceSyncInFlightDelta;
  updatedAt: string;
}

/** Outbox state contains private records and therefore must use local receiving/sending custody. */
export interface DeviceSyncOutboxStore {
  readonly protection: 'device-local-encrypted-custody';
  load(): Promise<DeviceSyncOutboxState | null>;
  save(state: DeviceSyncOutboxState): Promise<void>;
}

export type DeviceSyncFlushResult =
  | { ok: true; status: 'converged'; checkpointId: string; deliveredDeltas: number }
  | { ok: false; status: 'offline'; reason: string; pendingCount: number }
  | { ok: false; status: 'rejected'; reason: string; pendingCount: number };

export async function initializeDeviceSyncOutbox(input: {
  store: DeviceSyncOutboxStore;
  authorizationId: string;
  source: DeviceSyncEndpoint;
  target: DeviceSyncEndpoint;
  selectedCategories: readonly DeviceSyncCategory[];
  baseCheckpointId: string;
  now?: Date;
}): Promise<DeviceSyncOutboxState> {
  assertProtectedStore(input.store);
  const existing = await input.store.load();
  if (existing) {
    assertOutboxBinding(existing, input);
    return existing;
  }
  if (!input.baseCheckpointId) throw new Error('continuous sync outbox requires an acknowledged base checkpoint');
  const state: DeviceSyncOutboxState = {
    version: 1,
    authorizationId: input.authorizationId,
    source: input.source,
    target: input.target,
    selectedCategories: [...input.selectedCategories].sort(),
    nextSequence: 1,
    lastAcknowledgedCheckpointId: input.baseCheckpointId,
    entries: [],
    updatedAt: (input.now ?? new Date()).toISOString(),
  };
  await input.store.save(state);
  return state;
}

export async function enqueueDeviceSyncChange(input: {
  store: DeviceSyncOutboxStore;
  record: DeviceSyncRecord;
  now?: Date;
}): Promise<DeviceSyncOutboxEntry> {
  assertProtectedStore(input.store);
  const state = await requireState(input.store);
  if (!state.selectedCategories.includes(input.record.category)) throw new Error('change category is outside sync authorization');
  const entry: DeviceSyncOutboxEntry = {
    sequence: state.nextSequence,
    record: input.record,
    queuedAt: (input.now ?? new Date()).toISOString(),
  };
  await input.store.save({
    ...state,
    nextSequence: state.nextSequence + 1,
    entries: [...state.entries, entry],
    updatedAt: entry.queuedAt,
  });
  return entry;
}

/**
 * Drain queued changes in checkpoint order. `deliver` receives only the sealed
 * payload and returns the receiver's signed acknowledgement. An in-flight bundle
 * is persisted before delivery, so offline routes and lost acknowledgements retry
 * the identical checkpoint rather than producing forks.
 */
export async function flushDeviceSyncOutbox<TSealed>(input: {
  store: DeviceSyncOutboxStore;
  authorizations: readonly [DeviceSyncAuthorization, DeviceSyncAuthorization];
  revocations?: readonly DeviceSyncRevocation[];
  sourceCrypto: DeviceSyncCrypto;
  seal(bundle: DeviceSyncBundle): Promise<TSealed>;
  deliver(sealed: TSealed): Promise<DeviceSyncAcknowledgement>;
  now?: () => Date;
  maxRecordsPerDelta?: number;
  maxRounds?: number;
}): Promise<DeviceSyncFlushResult> {
  assertProtectedStore(input.store);
  let deliveredDeltas = 0;
  const maxRecords = Math.max(1, input.maxRecordsPerDelta ?? 128);
  const maxRounds = Math.max(1, input.maxRounds ?? 100);

  for (let round = 0; round < maxRounds; round += 1) {
    let state = await requireState(input.store);
    const authorization = await verifyMutualDeviceSyncAuthorization({
      authorizations: input.authorizations,
      ...(input.revocations ? { revocations: input.revocations } : {}),
      sourceDevicePub: state.source.devicePub,
      targetDevicePub: state.target.devicePub,
      selectedCategories: state.selectedCategories,
      crypto: input.sourceCrypto,
      now: input.now?.() ?? new Date(),
    });
    if (!authorization.ok) return { ok: false, status: 'rejected', reason: authorization.reason, pendingCount: state.entries.length };
    if (authorization.authorizationId !== state.authorizationId) {
      return { ok: false, status: 'rejected', reason: 'outbox authorization id mismatch', pendingCount: state.entries.length };
    }
    if (state.entries.length === 0 && !state.inFlight) {
      return { ok: true, status: 'converged', checkpointId: state.lastAcknowledgedCheckpointId, deliveredDeltas };
    }

    if (!state.inFlight) {
      const selected = state.entries.slice(0, maxRecords);
      const throughSequence = selected[selected.length - 1]?.sequence;
      if (throughSequence == null) return { ok: false, status: 'rejected', reason: 'outbox state is inconsistent', pendingCount: state.entries.length };
      const records = collapseQueuedRecords(selected);
      const bundle = await buildDeviceSyncBundle({
        source: state.source,
        target: state.target,
        authorizationId: state.authorizationId,
        mode: 'delta',
        selectedCategories: state.selectedCategories,
        records,
        previousCheckpointId: state.lastAcknowledgedCheckpointId,
        crypto: input.sourceCrypto,
        createdAt: (input.now?.() ?? new Date()).toISOString(),
      });
      state = { ...state, inFlight: { throughSequence, bundle }, updatedAt: (input.now?.() ?? new Date()).toISOString() };
      await input.store.save(state);
    }

    const inFlight = state.inFlight;
    if (!inFlight) return { ok: false, status: 'rejected', reason: 'outbox failed to persist in-flight delta', pendingCount: state.entries.length };
    let acknowledgement: DeviceSyncAcknowledgement;
    try {
      acknowledgement = await input.deliver(await input.seal(inFlight.bundle));
    } catch (error) {
      return {
        ok: false,
        status: 'offline',
        reason: error instanceof Error ? error.message : String(error),
        pendingCount: state.entries.length,
      };
    }
    const acknowledgementCheck = await verifyDeviceSyncAcknowledgement(
      acknowledgement,
      inFlight.bundle.manifest,
      input.sourceCrypto,
    );
    if (!acknowledgementCheck.ok) {
      return { ok: false, status: 'rejected', reason: acknowledgementCheck.reason, pendingCount: state.entries.length };
    }

    // Reload so edits queued while the network call was in flight are retained.
    const latest = await requireState(input.store);
    if (latest.inFlight?.bundle.manifest.checkpointId !== inFlight.bundle.manifest.checkpointId) {
      return { ok: false, status: 'rejected', reason: 'outbox in-flight checkpoint changed concurrently', pendingCount: latest.entries.length };
    }
    const { inFlight: _completed, ...withoutInFlight } = latest;
    void _completed;
    await input.store.save({
      ...withoutInFlight,
      lastAcknowledgedCheckpointId: inFlight.bundle.manifest.checkpointId,
      entries: latest.entries.filter((entry) => entry.sequence > inFlight.throughSequence),
      updatedAt: (input.now?.() ?? new Date()).toISOString(),
    });
    deliveredDeltas += 1;
  }
  const state = await requireState(input.store);
  return { ok: false, status: 'offline', reason: 'sync flush round limit reached', pendingCount: state.entries.length };
}

function collapseQueuedRecords(entries: readonly DeviceSyncOutboxEntry[]): DeviceSyncRecord[] {
  const latest = new Map<string, DeviceSyncOutboxEntry>();
  for (const entry of entries) latest.set(recordKey(entry.record), entry);
  return [...latest.values()]
    .sort((a, b) => a.sequence - b.sequence)
    .map((entry) => entry.record);
}

function recordKey(record: Pick<DeviceSyncRecord, 'category' | 'recordId'>): string {
  return `${record.category}\u0000${record.recordId}`;
}

async function requireState(store: DeviceSyncOutboxStore): Promise<DeviceSyncOutboxState> {
  const state = await store.load();
  if (!state || state.version !== 1) throw new Error('device sync outbox is not initialized');
  return state;
}

function assertProtectedStore(store: DeviceSyncOutboxStore): void {
  if (store.protection !== 'device-local-encrypted-custody') throw new Error('device sync outbox must use encrypted local custody');
}

function assertOutboxBinding(
  state: DeviceSyncOutboxState,
  input: {
    authorizationId: string;
    source: DeviceSyncEndpoint;
    target: DeviceSyncEndpoint;
    selectedCategories: readonly DeviceSyncCategory[];
  },
): void {
  if (
    state.authorizationId !== input.authorizationId
    || state.source.devicePub !== input.source.devicePub
    || state.target.devicePub !== input.target.devicePub
    || JSON.stringify(state.selectedCategories) !== JSON.stringify([...input.selectedCategories].sort())
  ) throw new Error('existing device sync outbox binding does not match');
}
