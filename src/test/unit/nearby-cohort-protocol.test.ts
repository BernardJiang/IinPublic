import SEA from 'gun/sea';
import type { RoomProtocolCheckpoint } from '../../shared/active-exchange-room';
import {
  createNearbyManualCohortSelection,
  createNearbyPartitionTransitionV2,
  deriveNearbyMemberRouteV2,
  nearbyCohortRootGroup,
  parseNearbyPartitionTransitionAny,
  verifyNearbyManualCohortSelection,
  verifyNearbyPartitionTransitionAny,
  verifyNearbyPartitionTransitionV2,
  type NearbyPartitionGroupV2,
} from '../../shared/nearby-cohort-protocol';
import {
  createNearbyPartitionSplit,
  nearbyPartitionAssignment,
  nearbyPartitionRootGroup,
} from '../../shared/nearby-partition';
import { createNearbyControlPresence } from '../../shared/nearby-control-presence';
import type { SeaSigningPair } from '../../shared/p2p-runtime';

describe('Nearby visitable-cohort v2 contract', () => {
  const checkpoint: RoomProtocolCheckpoint = {
    networkId: 'iinpublic-test',
    protocolEpoch: 1,
    manifestSequence: 1,
    manifestHash: 'a'.repeat(64),
    chatroomCapacity: 2,
  };
  const seed = 'b'.repeat(64);
  const location = {
    latitude: 32.7,
    longitude: -117.2,
    accuracy: 10,
    timestamp: new Date('2026-10-10T20:00:00.000Z'),
  };

  it('distinguishes four-way geography from two-way capacity cohorts', async () => {
    const root = nearbyCohortRootGroup(checkpoint);
    const geographic = createNearbyPartitionTransitionV2({
      axis: 'geographic',
      checkpoint,
      fromGroup: root,
      evidenceHash: 'c'.repeat(64),
      createdAt: '2026-10-10T20:00:00.000Z',
    });
    const cohort = createNearbyPartitionTransitionV2({
      axis: 'cohort',
      checkpoint,
      fromGroup: root,
      evidenceHash: 'd'.repeat(64),
      createdAt: '2026-10-10T20:00:00.000Z',
    });
    expect(geographic.toGroups).toHaveLength(4);
    expect(geographic.toGroups.map((group) => group.address.geographicPath)).toEqual(['0', '1', '2', '3']);
    expect(geographic.toGroups.every((group) => group.address.cohortPath === '')).toBe(true);
    expect(cohort.toGroups).toHaveLength(2);
    expect(cohort.toGroups.map((group) => group.address.cohortPath)).toEqual(['0', '1']);
    expect(cohort.toGroups.every((group) => group.address.geographicPath === '')).toBe(true);
    await expect(verifyNearbyPartitionTransitionV2(geographic, checkpoint))
      .resolves.toMatchObject({ ok: true });
    await expect(verifyNearbyPartitionTransitionV2(cohort, checkpoint))
      .resolves.toMatchObject({ ok: true });
  });

  it('keeps the cohort root stable while compatible releases exchange manifests', () => {
    const successor = {
      ...checkpoint,
      manifestSequence: 2,
      manifestHash: 'b'.repeat(64),
      chatroomCapacity: 498,
    };
    expect(nearbyCohortRootGroup(successor).roomId)
      .toBe(nearbyCohortRootGroup(checkpoint).roomId);
    expect(nearbyCohortRootGroup({ ...successor, protocolEpoch: 2 }).roomId)
      .not.toBe(nearbyCohortRootGroup(checkpoint).roomId);
  });

  it('stops two privacy modes independently and converts excess geography to stable cohort bits', () => {
    const geographicSelectorPath = '012301230123012301230123';
    const regional = deriveNearbyMemberRouteV2({
      geographicSelectorPath,
      requestedGeographicDepth: 16,
      requestedCohortDepth: 0,
      privacyMode: 'regional',
      location,
      identity: 'alice-pub',
      checkpoint,
      transitionSeed: seed,
    });
    const close = deriveNearbyMemberRouteV2({
      geographicSelectorPath,
      requestedGeographicDepth: 16,
      requestedCohortDepth: 0,
      privacyMode: 'close-nearby',
      location,
      identity: 'alice-pub',
      checkpoint,
      transitionSeed: seed,
    });
    expect(regional.geographicDepth).toBe(9);
    expect(regional.cohortDepth).toBe(7);
    expect(regional.address.geographicPath).toBe(geographicSelectorPath.slice(0, 9));
    expect(close.geographicDepth).toBe(16);
    expect(close.cohortDepth).toBe(0);
    expect(close.address.geographicPath).toBe(geographicSelectorPath.slice(0, 16));
    const anotherRegionalIdentity = deriveNearbyMemberRouteV2({
      geographicSelectorPath,
      requestedGeographicDepth: 16,
      requestedCohortDepth: 0,
      privacyMode: 'regional',
      location,
      identity: 'bob-pub',
      checkpoint,
      transitionSeed: seed,
    });
    expect(anotherRegionalIdentity.address.geographicPath)
      .toBe(regional.address.geographicPath);
    expect(anotherRegionalIdentity.address.cohortPath)
      .not.toBe(regional.address.cohortPath);
    expect(deriveNearbyMemberRouteV2({
      geographicSelectorPath,
      requestedGeographicDepth: 16,
      requestedCohortDepth: 0,
      privacyMode: 'regional',
      location,
      identity: 'alice-pub',
      checkpoint,
      transitionSeed: seed,
    })).toEqual(regional);
    expect(JSON.stringify(regional)).not.toContain('latitude');
    expect(JSON.stringify(regional)).not.toContain('longitude');

    const highLatitudeRegional = deriveNearbyMemberRouteV2({
      geographicSelectorPath,
      requestedGeographicDepth: 16,
      requestedCohortDepth: 0,
      privacyMode: 'regional',
      location: { ...location, latitude: 80 },
      identity: 'alice-pub',
      checkpoint,
      transitionSeed: seed,
    });
    expect(highLatitudeRegional.geographicDepth).toBe(7);
    expect(highLatitudeRegional.cohortDepth).toBe(9);
  });

  it('preserves v1 parsing and verification while rejecting unknown and ambiguous versions', async () => {
    const root = nearbyPartitionRootGroup(checkpoint);
    const assignment = nearbyPartitionAssignment({
      group: root,
      location,
      mode: 'neighborhood',
      checkpoint,
    });
    const pairs = await Promise.all([SEA.pair(), SEA.pair(), SEA.pair()]) as SeaSigningPair[];
    const witnesses = await Promise.all(pairs.map((pair, index) => createNearbyControlPresence({
      userId: `legacy-${index}`,
      pair,
      rootRoomId: root.roomId,
      assignment,
      checkpoint,
      now: new Date('2026-10-10T20:00:00.000Z'),
    })));
    const legacy = createNearbyPartitionSplit({
      checkpoint,
      fromGroup: root,
      witnesses,
      createdAt: '2026-10-10T20:00:00.000Z',
    });
    expect(parseNearbyPartitionTransitionAny(legacy)?.version).toBe(1);
    await expect(verifyNearbyPartitionTransitionAny(legacy, checkpoint))
      .resolves.toMatchObject({ ok: true });
    expect(parseNearbyPartitionTransitionAny({ ...legacy, version: 99 })).toBeNull();

    const v2 = createNearbyPartitionTransitionV2({
      axis: 'cohort',
      checkpoint,
      fromGroup: nearbyCohortRootGroup(checkpoint),
      evidenceHash: 'e'.repeat(64),
    });
    expect(parseNearbyPartitionTransitionAny({ ...v2, fromGroups: [] })).toBeNull();
    await expect(verifyNearbyPartitionTransitionV2({
      ...v2,
      axis: 'geographic',
    }, checkpoint)).resolves.toMatchObject({ ok: false });
    await expect(verifyNearbyPartitionTransitionV2({
      ...v2,
      transitionId: 'f'.repeat(64),
    }, checkpoint)).resolves.toMatchObject({ ok: false });
  });

  it('signs a manual cohort visit that cannot change the disclosed area', async () => {
    const pair = await SEA.pair() as SeaSigningPair;
    const root = nearbyCohortRootGroup(checkpoint);
    const split = createNearbyPartitionTransitionV2({
      axis: 'cohort',
      checkpoint,
      fromGroup: root,
      evidenceHash: '1'.repeat(64),
      createdAt: '2026-10-10T20:00:00.000Z',
    });
    const fromGroup = split.toGroups[0] as NearbyPartitionGroupV2;
    const targetGroup = split.toGroups[1] as NearbyPartitionGroupV2;
    const now = new Date('2026-10-10T20:00:10.000Z');
    const selection = await createNearbyManualCohortSelection({
      checkpoint,
      rootRoomId: root.roomId,
      userId: 'alice',
      pair,
      privacyMode: 'regional',
      fromGroup,
      targetGroup,
      visitOrdinal: 1,
      now,
    });
    await expect(verifyNearbyManualCohortSelection(selection, {
      expectedCheckpoint: checkpoint,
      expectedRootRoomId: root.roomId,
      allowedTargetRoomIds: new Set([targetGroup.roomId]),
      now: new Date(now.getTime() + 1_000),
    })).resolves.toMatchObject({ ok: true });

    const otherArea = {
      ...selection,
      targetGroup: {
        ...selection.targetGroup,
        address: { ...selection.targetGroup.address, geographicPath: '0' },
      },
    };
    await expect(verifyNearbyManualCohortSelection(otherArea, {
      expectedCheckpoint: checkpoint,
      expectedRootRoomId: root.roomId,
      now: new Date(now.getTime() + 1_000),
    })).resolves.toMatchObject({ ok: false });

    const tamperedTarget = {
      ...selection,
      targetGroup: { ...selection.targetGroup, roomId: fromGroup.roomId },
    };
    await expect(verifyNearbyManualCohortSelection(tamperedTarget, {
      expectedCheckpoint: checkpoint,
      expectedRootRoomId: root.roomId,
      now: new Date(now.getTime() + 1_000),
    })).resolves.toMatchObject({ ok: false });
  });
});
