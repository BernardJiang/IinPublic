import SEA from 'gun/sea';
import type { RoomProtocolCheckpoint } from '../../shared/active-exchange-room';
import {
  createNearbyManualCohortSelection,
  createNearbyPartitionTransitionV2,
  nearbyCohortRootGroup,
} from '../../shared/nearby-cohort-protocol';
import {
  NEARBY_RELEASE_2_LOCAL_STATE_KIND,
  NEARBY_VISITABLE_COHORT_CAPABILITY,
  boundVerifiedLegacyNearbyView,
  classifyNearbyMixedReleaseRecord,
  evaluateNearbyCohortMigrationPolicy,
  migrateNearbyCohortLocalState,
  nearbyCohortMigrationStorageKey,
  nearbyLegacyLineageStorageKey,
  readNearbyCohortMigrationState,
  separateLegacyNearbyPath,
  type NearbyRelease2CommittedState,
} from '../../shared/nearby-cohort-migration';
import {
  createNearbyPartitionSplit,
  nearbyPartitionRootGroup,
} from '../../shared/nearby-partition';
import type { ProtocolManifestBody } from '../../shared/protocol-manifest';
import type { SeaSigningPair } from '../../shared/p2p-runtime';

describe('Nearby mixed-release cohort migration', () => {
  const checkpoint: RoomProtocolCheckpoint = {
    networkId: 'iinpublic-test',
    protocolEpoch: 3,
    manifestSequence: 3,
    manifestHash: 'a'.repeat(64),
    chatroomCapacity: 2,
  };
  const ready = {
    roomProtocolVersion: 2,
    capabilities: [NEARBY_VISITABLE_COHORT_CAPABILITY],
  };
  const legacy = { roomProtocolVersion: 1, capabilities: [] as string[] };

  function manifest(overrides: Partial<ProtocolManifestBody> = {}): ProtocolManifestBody {
    return {
      kind: 'iinpublic-protocol-manifest',
      formatVersion: 1,
      networkId: checkpoint.networkId,
      sequence: checkpoint.manifestSequence,
      previousManifestHash: 'b'.repeat(64),
      protocolEpoch: checkpoint.protocolEpoch,
      effectiveAt: '2026-10-10T00:00:00.000Z',
      minimumManifestEngine: 1,
      minimumRoomProtocol: 1,
      chatroomCapacity: checkpoint.chatroomCapacity,
      requiredCapabilities: [],
      optionalCapabilities: [NEARBY_VISITABLE_COHORT_CAPABILITY],
      retirementMode: 'none',
      nextReleaseKeys: [],
      recoveryPolicy: { threshold: 1, keys: [] },
      signatureAlgorithm: 'p256-sha256',
      ...overrides,
    };
  }

  function memoryStorage(initial: Record<string, string> = {}): {
    storage: Pick<Storage, 'getItem' | 'setItem'>;
    values: Map<string, string>;
    writes: string[];
  } {
    const values = new Map(Object.entries(initial));
    const writes: string[] = [];
    return {
      values,
      writes,
      storage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
          writes.push(key);
          values.set(key, value);
        },
      },
    };
  }

  test('uses v2 only when signed policy, client, and index all advertise it', () => {
    const now = new Date('2026-10-10T01:00:00.000Z');
    expect(evaluateNearbyCohortMigrationPolicy({
      checkpoint,
      manifest: manifest(),
      manifestVerified: true,
      client: ready,
      index: ready,
      now,
    })).toMatchObject({
      mode: 'cohort-v2',
      legacyAdmissionAllowed: true,
      manualSelectionAllowed: true,
    });
    expect(evaluateNearbyCohortMigrationPolicy({
      checkpoint,
      manifest: manifest(),
      manifestVerified: true,
      client: ready,
      index: legacy,
      now,
    })).toMatchObject({
      mode: 'legacy-v1',
      legacyAdmissionAllowed: true,
      manualSelectionAllowed: false,
    });
    expect(evaluateNearbyCohortMigrationPolicy({
      checkpoint,
      manifest: manifest(),
      manifestVerified: false,
      client: ready,
      index: ready,
      now,
    }).mode).toBe('legacy-v1');
  });

  test('retires legacy admission only through an elapsed explicit signed global policy', () => {
    const retirement = manifest({
      minimumRoomProtocol: 2,
      requiredCapabilities: [NEARBY_VISITABLE_COHORT_CAPABILITY],
      optionalCapabilities: [],
      legacyEpochAllowedUntil: '2026-10-10T02:00:00.000Z',
      retirementMode: 'network-only',
    });
    const before = new Date('2026-10-10T01:59:59.000Z');
    const after = new Date('2026-10-10T02:00:00.000Z');
    expect(evaluateNearbyCohortMigrationPolicy({
      checkpoint,
      manifest: retirement,
      manifestVerified: true,
      client: legacy,
      index: ready,
      now: before,
    }).mode).toBe('legacy-v1');
    expect(evaluateNearbyCohortMigrationPolicy({
      checkpoint,
      manifest: retirement,
      manifestVerified: true,
      client: legacy,
      index: ready,
      now: after,
    })).toMatchObject({ mode: 'network-retired', legacyAdmissionAllowed: false });
    expect(evaluateNearbyCohortMigrationPolicy({
      checkpoint,
      manifest: retirement,
      manifestVerified: true,
      client: ready,
      index: ready,
      now: after,
    })).toMatchObject({ mode: 'cohort-v2', legacyAdmissionAllowed: false });
    expect(evaluateNearbyCohortMigrationPolicy({
      checkpoint,
      manifest: retirement,
      manifestVerified: false,
      client: legacy,
      index: ready,
      now: after,
    })).toMatchObject({ mode: 'legacy-v1', legacyAdmissionAllowed: true });
  });

  test('strictly separates manual cohort selection from geographic transitions', async () => {
    const pair = await SEA.pair() as SeaSigningPair;
    const root = nearbyCohortRootGroup(checkpoint);
    const split = createNearbyPartitionTransitionV2({
      axis: 'cohort',
      checkpoint,
      fromGroup: root,
      evidenceHash: 'c'.repeat(64),
      createdAt: '2026-10-10T00:10:00.000Z',
    });
    const selection = await createNearbyManualCohortSelection({
      checkpoint,
      rootRoomId: root.roomId,
      userId: 'alice',
      pair,
      privacyMode: 'regional',
      fromGroup: split.toGroups[0]!,
      targetGroup: split.toGroups[1]!,
      visitOrdinal: 1,
      now: new Date('2026-10-10T00:11:00.000Z'),
    });
    expect(classifyNearbyMixedReleaseRecord(selection).kind).toBe('manual-cohort-selection');
    expect(classifyNearbyMixedReleaseRecord(split).kind).toBe('cohort-transition');
    expect(classifyNearbyMixedReleaseRecord({
      ...selection,
      path: selection.targetGroup.address.cohortPath,
    }).kind).toBe('unknown');
  });

  test('bounds a shuffled legacy view at C and de-duplicates stable identities', () => {
    const claims = [
      { pub: 'carol', enteredAt: '2026-10-10T00:00:03.000Z', claimId: '3' },
      { pub: 'alice', enteredAt: '2026-10-10T00:00:02.000Z', claimId: '2' },
      { pub: 'alice', enteredAt: '2026-10-10T00:00:01.000Z', claimId: '1' },
      { pub: 'bob', enteredAt: '2026-10-10T00:00:01.000Z', claimId: '0' },
    ];
    const forward = boundVerifiedLegacyNearbyView(claims, checkpoint);
    const reverse = boundVerifiedLegacyNearbyView([...claims].reverse(), checkpoint);
    expect(forward).toEqual(reverse);
    expect(forward.map((claim) => claim.pub)).toEqual(['bob', 'alice']);
    expect(forward).toHaveLength(checkpoint.chatroomCapacity);
  });

  test('never translates a v1 identity-lane suffix into v2 geography', () => {
    expect(separateLegacyNearbyPath({ path: '012301', geographicDepth: 3 })).toEqual({
      geographicPath: '012',
      legacyIdentityLanePath: '301',
      canTranslateIdentityLaneToV2: false,
    });
  });

  test('migrates release 1 directly to release 3 once and leaves rollback data untouched', () => {
    const root = nearbyPartitionRootGroup(checkpoint);
    const transition = createNearbyPartitionSplit({
      checkpoint,
      fromGroup: root,
      witnesses: [],
      createdAt: '2026-10-10T00:00:00.000Z',
    });
    const lineageKey = nearbyLegacyLineageStorageKey(root.roomId);
    const originalLineage = JSON.stringify([transition]);
    const { storage, values, writes } = memoryStorage({ [lineageKey]: originalLineage });
    const first = migrateNearbyCohortLocalState({
      storage,
      scopeId: 'alice',
      checkpoint,
      legacyActiveRoomId: transition.toGroups[0]!.roomId,
      now: new Date('2026-10-10T01:00:00.000Z'),
    });
    expect(first.status).toBe('migrated');
    expect(first.state.sourceRelease).toBe(1);
    expect(first.state.legacy.activeRoomId).toBe(transition.toGroups[0]!.roomId);
    expect(first.state.legacy.transitionIds).toEqual([transition.transitionId]);
    expect(values.get(lineageKey)).toBe(originalLineage);
    const writesAfterFirst = writes.length;
    const second = migrateNearbyCohortLocalState({
      storage,
      scopeId: 'alice',
      checkpoint,
      legacyActiveRoomId: root.roomId,
      now: new Date('2026-10-10T02:00:00.000Z'),
    });
    expect(second.status).toBe('already-migrated');
    expect(second.state).toEqual(first.state);
    expect(writes).toHaveLength(writesAfterFirst);
    expect(values.get(lineageKey)).toBe(originalLineage);
  });

  test('migrates release-2 committed selection only as a re-verification candidate', async () => {
    const pair = await SEA.pair() as SeaSigningPair;
    const root = nearbyCohortRootGroup(checkpoint);
    const split = createNearbyPartitionTransitionV2({
      axis: 'cohort',
      checkpoint,
      fromGroup: root,
      evidenceHash: 'd'.repeat(64),
      createdAt: '2026-10-10T00:10:00.000Z',
    });
    const selection = await createNearbyManualCohortSelection({
      checkpoint,
      rootRoomId: root.roomId,
      userId: 'alice',
      pair,
      privacyMode: 'regional',
      fromGroup: split.toGroups[0]!,
      targetGroup: split.toGroups[1]!,
      visitOrdinal: 2,
      now: new Date('2026-10-10T00:11:00.000Z'),
    });
    const release2Key = 'release-2-state';
    const release2: NearbyRelease2CommittedState = {
      version: 2,
      kind: NEARBY_RELEASE_2_LOCAL_STATE_KIND,
      checkpoint,
      legacyRootRoomId: nearbyPartitionRootGroup(checkpoint).roomId,
      legacyActiveRoomId: null,
      committedSelection: selection,
    };
    const { storage } = memoryStorage({ [release2Key]: JSON.stringify(release2) });
    const result = migrateNearbyCohortLocalState({
      storage,
      scopeId: 'alice',
      checkpoint,
      release2StorageKey: release2Key,
      now: new Date('2026-10-10T01:00:00.000Z'),
    });
    expect(result.state.sourceRelease).toBe(2);
    expect(result.state.cohortCandidate).toMatchObject({
      protocolVersion: 2,
      requiresReverification: true,
      committedSelection: { visitOrdinal: 2 },
    });
  });

  test('recovers a write-ahead slot after interruption without touching v1 state', () => {
    const values = new Map<string, string>();
    const committedKey = nearbyCohortMigrationStorageKey('alice', 'committed');
    let failCommit = true;
    const storage: Pick<Storage, 'getItem' | 'setItem'> = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        if (key === committedKey && failCommit) throw new Error('simulated interruption');
        values.set(key, value);
      },
    };
    const interrupted = migrateNearbyCohortLocalState({ storage, scopeId: 'alice', checkpoint });
    expect(interrupted.status).toBe('pending-only');
    expect(readNearbyCohortMigrationState({ storage, scopeId: 'alice', checkpoint })?.slot)
      .toBe('pending');
    failCommit = false;
    const recovered = migrateNearbyCohortLocalState({ storage, scopeId: 'alice', checkpoint });
    expect(recovered.status).toBe('recovered-pending');
    expect(readNearbyCohortMigrationState({ storage, scopeId: 'alice', checkpoint })?.slot)
      .toBe('committed');
  });

  test('rejects locally tampered committed migration state and safely rebuilds from v1', () => {
    const { storage, values } = memoryStorage();
    const first = migrateNearbyCohortLocalState({
      storage,
      scopeId: 'alice',
      checkpoint,
      legacyActiveRoomId: nearbyPartitionRootGroup(checkpoint).roomId,
    });
    const committedKey = nearbyCohortMigrationStorageKey('alice', 'committed');
    const pendingKey = nearbyCohortMigrationStorageKey('alice', 'pending');
    const tampered = {
      ...first.state,
      legacy: { ...first.state.legacy, activeRoomId: 'nearby_v2_e3_deadbeefdeadbeefdeadbeef' },
    };
    values.set(committedKey, JSON.stringify(tampered));
    values.delete(pendingKey);
    expect(readNearbyCohortMigrationState({ storage, scopeId: 'alice', checkpoint })).toBeNull();
    const rebuilt = migrateNearbyCohortLocalState({ storage, scopeId: 'alice', checkpoint });
    expect(rebuilt.status).toBe('migrated');
    expect(rebuilt.state.legacy.activeRoomId).toBeNull();
  });
});
