import {
  evaluateProtocolManifestCompatibility,
  isSignedProtocolManifest,
  parseProtocolManifestTrustState,
  protocolManifestHash,
  serializeProtocolManifestTrustState,
  verifyProtocolManifestChain,
  type ProtocolManifestChainResult,
  type ProtocolManifestCompatibility,
  type ProtocolManifestRuntimePolicy,
  type ProtocolManifestTrustState,
  type SignedProtocolManifest,
} from './protocol-manifest';
import type { RoomProtocolCheckpoint } from './active-exchange-room';

export const PROTOCOL_MANIFEST_ARCHIVE_STORAGE_KEY = 'iinpublic_protocol_manifest_archive_v1';
export const PROTOCOL_MANIFEST_CHECKPOINT_STORAGE_KEY = 'iinpublic_protocol_manifest_checkpoint_v1';
const MAX_STORED_MANIFEST_ARCHIVE_BYTES = 512 * 1024;

export type ProtocolManifestSummary = {
  networkId: string;
  sequence: number;
  manifestHash: string;
  manifestEngineVersion: number;
  roomProtocolVersion: number;
  capabilities: string[];
};

type ManifestStorage = Pick<Storage, 'getItem' | 'setItem'>;

export class ProtocolManifestController {
  private state: ProtocolManifestTrustState;
  private archive: SignedProtocolManifest[];
  private compatibility: ProtocolManifestCompatibility;

  private constructor(
    private readonly anchor: ProtocolManifestTrustState,
    private readonly runtimePolicy: ProtocolManifestRuntimePolicy,
    private readonly storage?: ManifestStorage,
    state?: ProtocolManifestTrustState,
    archive: SignedProtocolManifest[] = [],
    compatibility?: ProtocolManifestCompatibility,
  ) {
    this.state = state || cloneState(anchor);
    this.archive = archive.map(cloneManifest);
    this.compatibility = compatibility || this.compatibilityFor(this.state);
  }

  static async create(params: {
    anchor: ProtocolManifestTrustState;
    runtimePolicy: ProtocolManifestRuntimePolicy;
    storage?: ManifestStorage;
    bundledManifests?: readonly SignedProtocolManifest[];
    now?: Date;
  }): Promise<ProtocolManifestController> {
    let archive = readStoredArchive(params.storage);
    const durableCheckpoint = readStoredCheckpoint(params.storage);
    const bundled = (params.bundledManifests || []).map(cloneManifest);
    if (bundled.length > 0) archive = mergeArchives(archive, bundled);
    const replay = await verifyProtocolManifestChain({
      state: cloneState(params.anchor),
      manifests: archive,
      runtimePolicy: params.runtimePolicy,
      ...(params.now ? { now: params.now } : {}),
    });
    if (!replay.ok) {
      if (durableCheckpoint && checkpointIsAheadOf(durableCheckpoint, params.anchor)) {
        throw new Error(`Stored protocol manifest archive cannot reproduce the monotonic checkpoint: ${replay.reason}`);
      }
      archive = bundled;
      const bundledReplay = await verifyProtocolManifestChain({
        state: cloneState(params.anchor),
        manifests: archive,
        runtimePolicy: params.runtimePolicy,
        ...(params.now ? { now: params.now } : {}),
      });
      if (!bundledReplay.ok) throw new Error(`Invalid bundled protocol manifest chain: ${bundledReplay.reason}`);
      assertCheckpointNotRolledBack(durableCheckpoint, bundledReplay.state);
      writeStoredArchive(params.storage, archive);
      writeStoredCheckpoint(params.storage, bundledReplay.state);
      return new ProtocolManifestController(
        cloneState(params.anchor),
        params.runtimePolicy,
        params.storage,
        bundledReplay.state,
        archive,
        bundledReplay.compatibility,
      );
    }
    assertCheckpointNotRolledBack(durableCheckpoint, replay.state);
    writeStoredArchive(params.storage, archive);
    writeStoredCheckpoint(params.storage, replay.state);
    return new ProtocolManifestController(
      cloneState(params.anchor),
      params.runtimePolicy,
      params.storage,
      replay.state,
      archive,
      replay.compatibility,
    );
  }

  summary(): ProtocolManifestSummary {
    return {
      networkId: this.state.networkId,
      sequence: this.state.sequence,
      manifestHash: this.state.manifestHash,
      manifestEngineVersion: this.runtimePolicy.manifestEngineVersion,
      roomProtocolVersion: this.runtimePolicy.roomProtocolVersion,
      capabilities: [...this.runtimePolicy.capabilities],
    };
  }

  currentCompatibility(now: Date = new Date()): ProtocolManifestCompatibility {
    this.compatibility = this.compatibilityFor(this.state, now);
    return cloneCompatibility(this.compatibility);
  }

  isRoomExchangeAllowed(now: Date = new Date()): boolean {
    const status = this.currentCompatibility(now).status;
    return status === 'compatible' || status === 'pending-activation';
  }

  /**
   * Resolve the room data-plane checkpoint for `now`. A verified future manifest is advertised as
   * the accepted sequence/hash during its grace period while the old epoch/capacity stay active.
   */
  roomCheckpoint(
    baseline: RoomProtocolCheckpoint,
    now: Date = new Date(),
  ): RoomProtocolCheckpoint {
    if (baseline.networkId !== this.state.networkId) throw new Error('baseline protocol network mismatch');
    const compatibility = this.currentCompatibility(now);
    if (compatibility.status === 'update-required' || compatibility.status === 'retired') {
      throw new Error(`room exchange is ${compatibility.status}`);
    }
    const latest = this.state.latestManifest;
    const activated = !!latest && now.getTime() >= Date.parse(latest.effectiveAt);
    return {
      networkId: this.state.networkId,
      protocolEpoch: activated ? latest.protocolEpoch : baseline.protocolEpoch,
      manifestSequence: this.state.sequence,
      manifestHash: this.state.manifestHash,
      chatroomCapacity: activated ? latest.chatroomCapacity : baseline.chatroomCapacity,
    };
  }

  nextActivationAt(now: Date = new Date()): Date | null {
    const effectiveAt = this.state.latestManifest?.effectiveAt;
    if (!effectiveAt) return null;
    const value = Date.parse(effectiveAt);
    return Number.isFinite(value) && value > now.getTime() ? new Date(value) : null;
  }

  manifestSuffixAfter(sequence: number, manifestHash: string): SignedProtocolManifest[] | null {
    if (!Number.isSafeInteger(sequence) || sequence < this.anchor.sequence || sequence > this.state.sequence) return null;
    let expectedHash = this.anchor.manifestHash;
    if (sequence === this.anchor.sequence) {
      if (manifestHash !== expectedHash) return null;
      return this.archive.map(cloneManifest);
    }
    for (let index = 0; index < this.archive.length; index += 1) {
      const manifest = this.archive[index];
      expectedHash = protocolManifestHash(manifest);
      if (manifest.body.sequence !== sequence) continue;
      if (manifestHash !== expectedHash) return null;
      return this.archive.slice(index + 1).map(cloneManifest);
    }
    return null;
  }

  async acceptManifestSuffix(
    manifests: readonly SignedProtocolManifest[],
    now: Date = new Date(),
  ): Promise<ProtocolManifestChainResult> {
    const result = await verifyProtocolManifestChain({
      state: this.state,
      manifests,
      runtimePolicy: this.runtimePolicy,
      now,
    });
    if (!result.ok) return result;
    if (result.accepted.length > 0) {
      this.archive.push(...result.accepted.map((entry) => cloneManifest(entry.manifest)));
      this.state = cloneState(result.state);
      this.compatibility = result.compatibility || this.compatibilityFor(this.state, now);
      writeStoredArchive(this.storage, this.archive);
      writeStoredCheckpoint(this.storage, this.state);
    }
    return result;
  }

  publicArchive(): SignedProtocolManifest[] {
    return this.archive.map(cloneManifest);
  }

  private compatibilityFor(state: ProtocolManifestTrustState, now: Date = new Date()): ProtocolManifestCompatibility {
    if (!state.latestManifest) {
      return { status: 'compatible', reasons: [] };
    }
    return evaluateProtocolManifestCompatibility(state.latestManifest, this.runtimePolicy, now);
  }
}

function readStoredCheckpoint(storage?: ManifestStorage): ProtocolManifestTrustState | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(PROTOCOL_MANIFEST_CHECKPOINT_STORAGE_KEY);
  } catch (error) {
    throw new Error(`Cannot read the durable protocol manifest checkpoint: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!raw) return null;
  if (raw.length > MAX_STORED_MANIFEST_ARCHIVE_BYTES) {
    throw new Error('Stored protocol manifest checkpoint exceeds its size bound');
  }
  const parsed = parseProtocolManifestTrustState(raw);
  if (!parsed) throw new Error('Stored protocol manifest checkpoint is invalid');
  return parsed;
}

function writeStoredCheckpoint(storage: ManifestStorage | undefined, state: ProtocolManifestTrustState): void {
  if (!storage) return;
  storage.setItem(PROTOCOL_MANIFEST_CHECKPOINT_STORAGE_KEY, serializeProtocolManifestTrustState(state));
}

function checkpointIsAheadOf(checkpoint: ProtocolManifestTrustState, state: ProtocolManifestTrustState): boolean {
  return checkpoint.networkId === state.networkId && checkpoint.sequence > state.sequence;
}

function assertCheckpointNotRolledBack(
  checkpoint: ProtocolManifestTrustState | null,
  replayed: ProtocolManifestTrustState,
): void {
  if (!checkpoint) return;
  if (checkpoint.networkId !== replayed.networkId) throw new Error('Stored protocol checkpoint network mismatch');
  if (replayed.sequence < checkpoint.sequence) throw new Error('Protocol manifest rollback detected in durable storage');
  if (replayed.sequence === checkpoint.sequence && replayed.manifestHash !== checkpoint.manifestHash) {
    throw new Error('Protocol manifest same-sequence fork detected in durable storage');
  }
}

function readStoredArchive(storage?: ManifestStorage): SignedProtocolManifest[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(PROTOCOL_MANIFEST_ARCHIVE_STORAGE_KEY);
    if (!raw || raw.length > MAX_STORED_MANIFEST_ARCHIVE_BYTES) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length > 128 || !parsed.every(isSignedProtocolManifest)) return [];
    return parsed.map(cloneManifest);
  } catch {
    return [];
  }
}

function writeStoredArchive(storage: ManifestStorage | undefined, archive: readonly SignedProtocolManifest[]): void {
  if (!storage) return;
  const serialized = JSON.stringify(archive);
  if (serialized.length > MAX_STORED_MANIFEST_ARCHIVE_BYTES) throw new Error('Protocol manifest archive exceeds storage bound');
  storage.setItem(PROTOCOL_MANIFEST_ARCHIVE_STORAGE_KEY, serialized);
}

function mergeArchives(
  stored: readonly SignedProtocolManifest[],
  bundled: readonly SignedProtocolManifest[],
): SignedProtocolManifest[] {
  const bySequence = new Map<number, SignedProtocolManifest>();
  for (const manifest of stored) bySequence.set(manifest.body.sequence, cloneManifest(manifest));
  for (const manifest of bundled) {
    const existing = bySequence.get(manifest.body.sequence);
    if (existing && protocolManifestHash(existing) !== protocolManifestHash(manifest)) {
      throw new Error(`Bundled protocol manifest forks stored sequence ${manifest.body.sequence}`);
    }
    bySequence.set(manifest.body.sequence, cloneManifest(manifest));
  }
  return [...bySequence.values()].sort((left, right) => left.body.sequence - right.body.sequence);
}

function cloneManifest(manifest: SignedProtocolManifest): SignedProtocolManifest {
  return JSON.parse(JSON.stringify(manifest)) as SignedProtocolManifest;
}

function cloneState(state: ProtocolManifestTrustState): ProtocolManifestTrustState {
  return JSON.parse(JSON.stringify(state)) as ProtocolManifestTrustState;
}

function cloneCompatibility(value: ProtocolManifestCompatibility): ProtocolManifestCompatibility {
  return {
    status: value.status,
    reasons: [...value.reasons],
    ...(value.activeChatroomCapacity !== undefined ? { activeChatroomCapacity: value.activeChatroomCapacity } : {}),
  };
}
