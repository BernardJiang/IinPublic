import SEA from 'gun/sea';
import { portableSha256Hex } from '../../shared/portable-sha256';
import {
  PROTOCOL_MANIFEST_ARCHIVE_STORAGE_KEY,
  ProtocolManifestController,
} from '../../shared/protocol-manifest-controller';
import {
  PROTOCOL_MANIFEST_FORMAT_VERSION,
  PROTOCOL_MANIFEST_KIND,
  PROTOCOL_MANIFEST_SIGNATURE_ALGORITHM,
  createProtocolReleaseKey,
  evaluateProtocolManifestCompatibility,
  parseProtocolManifestTrustState,
  protocolManifestHash,
  serializeProtocolManifestTrustState,
  signProtocolManifest,
  verifyProtocolManifestChain,
  type ProtocolManifestBody,
  type ProtocolManifestRuntimePolicy,
  type ProtocolManifestTrustState,
} from '../../shared/protocol-manifest';

type Pair = { pub: string; priv: string };

const NETWORK_ID = 'iinpublic-test';
const H1 = portableSha256Hex('iinpublic-test-manifest-1');

function body(params: {
  sequence: number;
  previousManifestHash: string;
  signerForNext: Pair;
  recovery: Pair;
  capacity?: number;
  minimumRoomProtocol?: number;
  requiredCapabilities?: string[];
  effectiveAt?: string;
  legacyEpochAllowedUntil?: string;
  retirementMode?: 'none' | 'network-only';
  criticalExtensions?: string[];
}): ProtocolManifestBody {
  return {
    kind: PROTOCOL_MANIFEST_KIND,
    formatVersion: PROTOCOL_MANIFEST_FORMAT_VERSION,
    networkId: NETWORK_ID,
    sequence: params.sequence,
    previousManifestHash: params.previousManifestHash,
    protocolEpoch: params.sequence,
    effectiveAt: params.effectiveAt || '2026-10-04T00:00:00.000Z',
    minimumManifestEngine: 1,
    minimumRoomProtocol: params.minimumRoomProtocol || 1,
    chatroomCapacity: params.capacity || 498,
    requiredCapabilities: params.requiredCapabilities || [],
    optionalCapabilities: ['manifest-relay-v1'],
    ...(params.legacyEpochAllowedUntil ? { legacyEpochAllowedUntil: params.legacyEpochAllowedUntil } : {}),
    retirementMode: params.retirementMode || 'none',
    nextReleaseKeys: [createProtocolReleaseKey(params.signerForNext.pub)],
    recoveryPolicy: { threshold: 1, keys: [createProtocolReleaseKey(params.recovery.pub)] },
    signatureAlgorithm: PROTOCOL_MANIFEST_SIGNATURE_ALGORITHM,
    ...(params.criticalExtensions
      ? { extensions: { futureRule: true }, criticalExtensions: params.criticalExtensions }
      : {}),
  };
}

function anchor(next: Pair, recovery: Pair): ProtocolManifestTrustState {
  return {
    networkId: NETWORK_ID,
    sequence: 1,
    manifestHash: H1,
    nextReleaseKeys: [createProtocolReleaseKey(next.pub)],
    recoveryPolicy: { threshold: 1, keys: [createProtocolReleaseKey(recovery.pub)] },
  };
}

const runtimePolicy: ProtocolManifestRuntimePolicy = {
  manifestEngineVersion: 1,
  roomProtocolVersion: 1,
  capabilities: ['room-presence-v1'],
  supportedExtensions: [],
  minimumChatroomCapacity: 1,
  maximumChatroomCapacity: 2_000,
};

describe('forward-authorized protocol manifests', () => {
  let k2: Pair;
  let k3: Pair;
  let k4: Pair;
  let recovery: Pair;

  beforeAll(async () => {
    [k2, k3, k4, recovery] = await Promise.all([SEA.pair(), SEA.pair(), SEA.pair(), SEA.pair()]) as Pair[];
  });

  it('uses the pinned K2 public key to authenticate M2 and learn K3', async () => {
    const m2 = await signProtocolManifest(body({
      sequence: 2,
      previousManifestHash: H1,
      signerForNext: k3,
      recovery,
      capacity: 1_000,
    }), k2);

    const result = await verifyProtocolManifestChain({
      state: anchor(k2, recovery),
      manifests: [m2],
      runtimePolicy,
      now: new Date('2026-10-05T00:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.sequence).toBe(2);
    expect(result.state.manifestHash).toBe(protocolManifestHash(m2));
    expect(result.state.nextReleaseKeys).toEqual([createProtocolReleaseKey(k3.pub)]);
    expect(result.compatibility).toEqual({
      status: 'compatible',
      reasons: [],
      activeChatroomCapacity: 1_000,
    });
  });

  it('lets release 1 verify release 3 only through the complete M2 then M3 chain', async () => {
    const m2 = await signProtocolManifest(body({
      sequence: 2,
      previousManifestHash: H1,
      signerForNext: k3,
      recovery,
      capacity: 1_000,
    }), k2);
    const m3 = await signProtocolManifest(body({
      sequence: 3,
      previousManifestHash: protocolManifestHash(m2),
      signerForNext: k4,
      recovery,
      capacity: 1_500,
    }), k3);

    const missingLink = await verifyProtocolManifestChain({ state: anchor(k2, recovery), manifests: [m3] });
    expect(missingLink).toEqual(expect.objectContaining({ ok: false, reason: 'manifest sequence gap' }));

    const result = await verifyProtocolManifestChain({
      state: anchor(k2, recovery),
      manifests: [m2, m3],
      runtimePolicy,
      now: new Date('2026-10-05T00:00:00.000Z'),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.sequence).toBe(3);
    expect(result.state.nextReleaseKeys).toEqual([createProtocolReleaseKey(k4.pub)]);
    expect(result.accepted.map((entry) => entry.manifest.body.sequence)).toEqual([2, 3]);
    expect(result.compatibility?.activeChatroomCapacity).toBe(1_500);
  });

  it('allows public manifest replay without treating the relay as an authenticated release', async () => {
    const m2 = await signProtocolManifest(body({
      sequence: 2,
      previousManifestHash: H1,
      signerForNext: k3,
      recovery,
    }), k2);
    const first = await verifyProtocolManifestChain({ state: anchor(k2, recovery), manifests: [m2] });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const replay = await verifyProtocolManifestChain({ state: first.state, manifests: [m2] });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.accepted).toHaveLength(0);
    expect(replay.state).toEqual(first.state);
  });

  it('rejects tampering, rollback, and same-sequence forks', async () => {
    const m2 = await signProtocolManifest(body({
      sequence: 2,
      previousManifestHash: H1,
      signerForNext: k3,
      recovery,
    }), k2);
    const tampered = { ...m2, body: { ...m2.body, chatroomCapacity: 99_999 } };
    const tamperedResult = await verifyProtocolManifestChain({ state: anchor(k2, recovery), manifests: [tampered] });
    expect(tamperedResult).toEqual(expect.objectContaining({ ok: false, reason: 'invalid manifest signature' }));

    const accepted = await verifyProtocolManifestChain({ state: anchor(k2, recovery), manifests: [m2] });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;

    const rollback = await verifyProtocolManifestChain({
      state: accepted.state,
      manifests: [{ ...m2, body: { ...m2.body, sequence: 1 } }],
    });
    expect(rollback).toEqual(expect.objectContaining({ ok: false, reason: 'manifest rollback attempted' }));

    const fork = await signProtocolManifest(body({
      sequence: 2,
      previousManifestHash: H1,
      signerForNext: k4,
      recovery,
    }), k2);
    const forkResult = await verifyProtocolManifestChain({ state: accepted.state, manifests: [fork] });
    expect(forkResult).toEqual(expect.objectContaining({ ok: false, reason: 'same-sequence manifest fork detected' }));
  });

  it('classifies future activation, unsupported mandatory behavior, and retirement', () => {
    const future = body({
      sequence: 2,
      previousManifestHash: H1,
      signerForNext: k3,
      recovery,
      effectiveAt: '2030-01-01T00:00:00.000Z',
      minimumRoomProtocol: 10,
    });
    expect(evaluateProtocolManifestCompatibility(future, runtimePolicy, new Date('2029-01-01T00:00:00.000Z')).status)
      .toBe('pending-activation');
    expect(evaluateProtocolManifestCompatibility(future, runtimePolicy, new Date('2030-01-02T00:00:00.000Z')).status)
      .toBe('update-required');

    const retired = {
      ...future,
      legacyEpochAllowedUntil: '2030-02-01T00:00:00.000Z',
      retirementMode: 'network-only' as const,
    };
    expect(evaluateProtocolManifestCompatibility(retired, runtimePolicy, new Date('2030-02-02T00:00:00.000Z')).status)
      .toBe('retired');
  });

  it('fails closed on unsupported critical extensions and out-of-bounds capacity', () => {
    const manifestBody = body({
      sequence: 2,
      previousManifestHash: H1,
      signerForNext: k3,
      recovery,
      capacity: 5_000,
      criticalExtensions: ['futureRule'],
    });
    const result = evaluateProtocolManifestCompatibility(manifestBody, runtimePolicy, new Date('2026-10-05T00:00:00.000Z'));
    expect(result.status).toBe('update-required');
    expect(result.reasons).toEqual(expect.arrayContaining([
      'chatroom capacity is outside local safety bounds',
      'unsupported critical extensions: futureRule',
    ]));
  });

  it('round-trips a strict durable checkpoint and rejects malformed state', async () => {
    const m2 = await signProtocolManifest(body({
      sequence: 2,
      previousManifestHash: H1,
      signerForNext: k3,
      recovery,
    }), k2);
    const result = await verifyProtocolManifestChain({ state: anchor(k2, recovery), manifests: [m2] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const serialized = serializeProtocolManifestTrustState(result.state);
    expect(parseProtocolManifestTrustState(serialized)).toEqual(result.state);
    expect(parseProtocolManifestTrustState('{"sequence":2}')).toBeNull();
    expect(parseProtocolManifestTrustState('not-json')).toBeNull();
  });

  it('persists public manifests and serves the exact suffix an old release needs', async () => {
    const records = new Map<string, string>();
    const storage = {
      getItem: (key: string) => records.get(key) ?? null,
      setItem: (key: string, value: string) => { records.set(key, value); },
    };
    const m2 = await signProtocolManifest(body({
      sequence: 2,
      previousManifestHash: H1,
      signerForNext: k3,
      recovery,
    }), k2);
    const m3 = await signProtocolManifest(body({
      sequence: 3,
      previousManifestHash: protocolManifestHash(m2),
      signerForNext: k4,
      recovery,
    }), k3);

    const controller = await ProtocolManifestController.create({
      anchor: anchor(k2, recovery),
      runtimePolicy,
      storage,
      bundledManifests: [m2, m3],
      now: new Date('2026-10-05T00:00:00.000Z'),
    });
    expect(controller.summary()).toEqual(expect.objectContaining({ sequence: 3, manifestHash: protocolManifestHash(m3) }));
    expect(controller.manifestSuffixAfter(1, H1)).toEqual([m2, m3]);
    expect(controller.manifestSuffixAfter(2, protocolManifestHash(m2))).toEqual([m3]);
    expect(controller.manifestSuffixAfter(2, portableSha256Hex('wrong'))).toBeNull();
    expect(records.get(PROTOCOL_MANIFEST_ARCHIVE_STORAGE_KEY)).toBe(JSON.stringify([m2, m3]));

    const reloaded = await ProtocolManifestController.create({
      anchor: anchor(k2, recovery),
      runtimePolicy,
      storage,
      now: new Date('2026-10-05T00:00:00.000Z'),
    });
    expect(reloaded.summary()).toEqual(controller.summary());
    expect(reloaded.publicArchive()).toEqual([m2, m3]);
  });

  it('discards a corrupted stored archive instead of trusting its checkpoint', async () => {
    const records = new Map<string, string>([[PROTOCOL_MANIFEST_ARCHIVE_STORAGE_KEY, '[{"forged":true}]']]);
    const controller = await ProtocolManifestController.create({
      anchor: anchor(k2, recovery),
      runtimePolicy,
      storage: {
        getItem: (key: string) => records.get(key) ?? null,
        setItem: (key: string, value: string) => { records.set(key, value); },
      },
    });
    expect(controller.summary()).toEqual(expect.objectContaining({ sequence: 1, manifestHash: H1 }));
    expect(controller.publicArchive()).toEqual([]);
    expect(records.get(PROTOCOL_MANIFEST_ARCHIVE_STORAGE_KEY)).toBe('[]');
  });
});
