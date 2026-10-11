import {
  createNearbyPartitionTransitionV2,
  deriveNearbyMemberRouteV2,
  nearbyCohortRootGroup,
} from '../../shared/nearby-cohort-protocol';
import {
  maximumNearbyPartitionGeographicDepth,
  nearbyPartitionDisplayGeometry,
} from '../../shared/nearby-partition-geometry';
import { nearbyBasePrecisionMeters, type NearbyPublicMode } from '../../shared/nearby-rooms';
import { selectDirectTalkPeers } from '../../shared/direct-talk-scheduler';
import { roomTopologyBounds } from '../../shared/room-topology-bounds';
import type { RoomProtocolCheckpoint } from '../../shared/active-exchange-room';

const CAPACITY = 498;
const K = 12;
const checkpoint: RoomProtocolCheckpoint = {
  networkId: 'iinpublic-open40-scale-gate',
  protocolEpoch: 1,
  manifestSequence: 1,
  manifestHash: 'a'.repeat(64),
  chatroomCapacity: CAPACITY,
};
const location = {
  latitude: 32.7157,
  longitude: -117.1611,
  accuracy: 10,
  timestamp: new Date('2026-10-11T00:00:00.000Z'),
};

describe('OPEN-40-G2.4 deterministic scale and privacy gates', () => {
  test.each([
    [2, 1],
    [498, 1],
    [499, 2],
    [10_000, 21],
    [1_000_000, 2_009],
  ])('bounds %i members without a global roster', (members, expectedMinimumRooms) => {
    const bounds = roomTopologyBounds(members, CAPACITY, K);
    expect(bounds.minimumRoomCount).toBe(expectedMinimumRooms);
    expect(bounds.maximumCandidatesPerDevice).toBeLessThanOrEqual(CAPACITY - 1);
    expect(bounds.maximumDirectedLinks).toBe(members * K);
    expect(bounds.maximumUndirectedLinks).toBeLessThanOrEqual(Math.ceil(members * K / 2));
  });

  it('keeps mixed privacy modes at their own public floor while deriving stable cohort suffixes', () => {
    const modes: NearbyPublicMode[] = ['regional', 'citywide', 'neighborhood', 'close-nearby'];
    const selector = '012301230123012301230123';
    for (const mode of modes) {
      const maximumGeographicDepth = maximumNearbyPartitionGeographicDepth({
        location,
        mode,
        maximumDepth: 24,
      });
      const route = deriveNearbyMemberRouteV2({
        geographicSelectorPath: selector,
        requestedGeographicDepth: 20,
        requestedCohortDepth: 4,
        privacyMode: mode,
        location,
        identity: `member-${mode}`,
        checkpoint,
        transitionSeed: 'b'.repeat(64),
      });
      expect(route.geographicDepth).toBeLessThanOrEqual(maximumGeographicDepth);
      expect(route.address.geographicPath).toBe(selector.slice(0, route.geographicDepth));
      expect(route.address.cohortPath).toMatch(/^[01]+$/);

      const display = nearbyPartitionDisplayGeometry({
        path: route.address.geographicPath,
        geographicDepth: route.geographicDepth,
        location,
        mode,
        maximumDepth: 24,
      });
      expect(display.geographicPath).toBe(route.address.geographicPath);
      expect(display.cellSizeMeters).toBeGreaterThanOrEqual(nearbyBasePrecisionMeters(mode));
      expect(JSON.stringify({ route, display })).not.toContain('latitude');
      expect(JSON.stringify({ route, display })).not.toContain('longitude');
    }
  });

  it('uses four-way geography, then two-way cohorts without changing the displayed area', () => {
    const root = nearbyCohortRootGroup(checkpoint);
    const geographic = createNearbyPartitionTransitionV2({
      axis: 'geographic',
      checkpoint,
      fromGroup: root,
      evidenceHash: 'c'.repeat(64),
      createdAt: '2026-10-11T00:00:00.000Z',
    });
    const geographicGroup = geographic.toGroups[2]!;
    const cohort = createNearbyPartitionTransitionV2({
      axis: 'cohort',
      checkpoint,
      fromGroup: geographicGroup,
      evidenceHash: 'd'.repeat(64),
      createdAt: '2026-10-11T00:00:01.000Z',
    });

    expect(geographic.toGroups).toHaveLength(4);
    expect(cohort.toGroups).toHaveLength(2);
    expect(new Set(cohort.toGroups.map((group) => group.address.geographicPath)))
      .toEqual(new Set([geographicGroup.address.geographicPath]));
    expect(cohort.toGroups.map((group) => group.address.cohortPath)).toEqual(['0', '1']);

    const geometries = cohort.toGroups.map((group) => nearbyPartitionDisplayGeometry({
      path: group.address.geographicPath,
      geographicDepth: group.address.geographicPath.length,
      location,
      mode: 'close-nearby',
      maximumDepth: 24,
    }));
    expect(geometries[0]).toEqual(geometries[1]);
  });

  it('keeps direct scheduling symmetric and K-bounded at a full cohort', () => {
    const members = Array.from({ length: CAPACITY }, (_, index) => `member-${String(index).padStart(3, '0')}`);
    const selected = new Map(members.map((member) => [
      member,
      selectDirectTalkPeers(members, member, K, 7),
    ]));
    for (const member of members) {
      const peers = selected.get(member)!;
      expect(peers).toHaveLength(K);
      for (const peer of peers) expect(selected.get(peer)).toContain(member);
    }
  });
});
