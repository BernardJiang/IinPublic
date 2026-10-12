import type { RoomProtocolCheckpoint } from '../../shared/active-exchange-room';
import {
  maximumNearbyPartitionGeographicDepth,
  nearbyPartitionDisplayGeometry,
} from '../../shared/nearby-partition-geometry';
import {
  nearbyPartitionAssignment,
  nearbyPartitionSelectorPath,
  type NearbyPartitionGroup,
} from '../../shared/nearby-partition';
import {
  nearbyBasePrecisionMeters,
  nearbyMapArea,
  nearbyPublicScope,
  type NearbyPublicMode,
} from '../../shared/nearby-rooms';
import type { GPSCoordinate } from '../../shared/types';

const checkpoint: RoomProtocolCheckpoint = {
  networkId: 'iinpublic-geometry-test',
  protocolEpoch: 1,
  manifestSequence: 1,
  manifestHash: '9'.repeat(64),
  chatroomCapacity: 498,
};

const point = (latitude: number, longitude: number, accuracy = 5): GPSCoordinate => ({
  latitude,
  longitude,
  accuracy,
  timestamp: new Date('2026-10-10T12:00:00.000Z'),
});

function group(path: string, marker = 'a'): NearbyPartitionGroup {
  return {
    path,
    roomId: `nearby_v2_e1_${marker.repeat(24)}`,
  };
}

const modes: NearbyPublicMode[] = ['regional', 'citywide', 'neighborhood', 'close-nearby'];

describe('adaptive Nearby partition display geometry', () => {
  test.each(modes)('%s clamps capacity-only suffixes to the same disclosed map area', (mode) => {
    const location = point(32.7157, -117.1611);
    const firstPath = nearbyPartitionSelectorPath(location, mode, 24, 'alice-public-key');
    const secondPath = nearbyPartitionSelectorPath(location, mode, 24, 'bob-public-key');
    const geographicDepth = maximumNearbyPartitionGeographicDepth({
      location,
      mode,
      maximumDepth: 24,
    });
    expect(firstPath.slice(0, geographicDepth)).toBe(secondPath.slice(0, geographicDepth));

    const first = nearbyPartitionAssignment({
      group: group(firstPath, 'a'),
      location,
      mode,
      checkpoint,
    });
    const second = nearbyPartitionAssignment({
      group: group(secondPath, 'b'),
      location,
      mode,
      checkpoint,
    });

    expect(first.splitGeneration).toBe(geographicDepth);
    expect(first.requestedSplitGeneration).toBe(24);
    expect(first.identityLaneCount).toBeGreaterThan(1);
    expect(first.localCell).toEqual(second.localCell);
    expect(first.cellSizeMeters).toBeCloseTo(second.cellSizeMeters, 8);
    expect(first.approximateDiameterMeters).toBe(second.approximateDiameterMeters);
    expect(nearbyMapArea(first)).toEqual(nearbyMapArea(second));
    expect(first.cellSizeMeters).toBeGreaterThanOrEqual(nearbyBasePrecisionMeters(mode));

    const publicScope = nearbyPublicScope(first) as Record<string, unknown>;
    expect(publicScope.localCell).toBeUndefined();
    expect(publicScope.geographicPath).toBeUndefined();
    expect(publicScope.cohortPath).toBeUndefined();
    expect(JSON.stringify(publicScope)).not.toContain(firstPath);
  });

  test('an explicit protocol geographic depth cannot bypass a coarser member floor', () => {
    const location = point(0, 0);
    const geometry = nearbyPartitionDisplayGeometry({
      path: '33333333333333333333',
      geographicDepth: 20,
      location,
      mode: 'regional',
      maximumDepth: 24,
    });
    expect(geometry.geographicDepth).toBe(9);
    expect(geometry.geographicPath).toBe('333333333');
    expect(geometry.cohortDepth).toBe(11);
    expect(geometry.cellSizeMeters).toBeGreaterThanOrEqual(50_000);
    expect(geometry.cellSizeMeters / 2).toBeLessThan(50_000);
  });

  test.each(modes)('%s remains no finer than its ground-distance floor at high latitude', (mode) => {
    const location = point(80, 15);
    const equatorDepth = maximumNearbyPartitionGeographicDepth({
      location: point(0, 15),
      mode,
      maximumDepth: 24,
    });
    const highLatitudeDepth = maximumNearbyPartitionGeographicDepth({
      location,
      mode,
      maximumDepth: 24,
    });
    expect(highLatitudeDepth).toBeLessThan(equatorDepth);

    const path = nearbyPartitionSelectorPath(location, mode, 24, 'high-latitude-user');
    const assignment = nearbyPartitionAssignment({
      group: group(path),
      location,
      mode,
      checkpoint,
    });
    const floor = nearbyBasePrecisionMeters(mode);
    expect(assignment.splitGeneration).toBe(highLatitudeDepth);
    expect(assignment.cellSizeMeters).toBeGreaterThanOrEqual(floor);
    expect(assignment.cellSizeMeters / 2).toBeLessThan(floor);
    const area = nearbyMapArea(assignment);
    expect(area.south).toBeGreaterThanOrEqual(-85.05112878);
    expect(area.north).toBeLessThanOrEqual(85.05112878);
  });

  test('GPS uncertainty can only broaden the displayed geographic footprint', () => {
    const location = point(32.7157, -117.1611, 5_000);
    const path = nearbyPartitionSelectorPath(location, 'close-nearby', 24, 'uncertain-user');
    const assignment = nearbyPartitionAssignment({
      group: group(path),
      location,
      mode: 'close-nearby',
      checkpoint,
    });
    expect(assignment.cellSizeMeters).toBeGreaterThanOrEqual(10_000);
    expect(assignment.cellSizeMeters / 2).toBeLessThan(10_000);
  });

  test('a point on a quadrant boundary has deterministic inclusive display bounds', () => {
    const location = point(0, 0);
    const path = nearbyPartitionSelectorPath(location, 'close-nearby', 24, 'boundary-user');
    expect(nearbyPartitionSelectorPath(location, 'close-nearby', 24, 'boundary-user')).toBe(path);
    const assignment = nearbyPartitionAssignment({
      group: group(path),
      location,
      mode: 'close-nearby',
      checkpoint,
    });
    const area = nearbyMapArea(assignment);
    expect(area.west).toBeLessThanOrEqual(location.longitude);
    expect(area.east).toBeGreaterThanOrEqual(location.longitude);
    expect(area.south).toBeLessThanOrEqual(location.latitude);
    expect(area.north).toBeGreaterThanOrEqual(location.latitude);
  });

  test('Location off cannot be forced into automatic Nearby assignment', () => {
    expect(() => nearbyPartitionAssignment({
      group: group(''),
      location: point(32.7157, -117.1611),
      mode: 'location-off' as NearbyPublicMode,
      checkpoint,
    })).toThrow('cannot participate in automatic Nearby');
  });
});

describe('room-list tap target', () => {
  it('a tap on a group lands in that exact group, even when members sit near its edge', () => {
    const { nearbyPartitionTargetPoint } = jest.requireActual('../../shared/nearby-partition-geometry');
    const { nearbyPartitionSelectorPath } = jest.requireActual('../../shared/nearby-partition');
    for (const spot of [
      { latitude: 32.7132, longitude: -117.1756 },
      { latitude: 32.7157, longitude: -117.1611 },
      { latitude: 51.5007, longitude: -0.1246 },
      { latitude: -33.8568, longitude: 151.2153 },
    ]) {
      const at = { ...spot, accuracy: 25, timestamp: new Date() };
      for (const depth of [4, 9, 12, 15]) {
        const path = nearbyPartitionSelectorPath(at, 'neighborhood', depth, 'someone');
        const target = nearbyPartitionTargetPoint({ path, mode: 'neighborhood', near: spot });
        const back = nearbyPartitionSelectorPath({ ...target, accuracy: 0, timestamp: new Date() }, 'neighborhood', depth, 'traveler');
        const geographic = maximumNearbyPartitionGeographicDepth({ location: at, mode: 'neighborhood', maximumDepth: 24 });
        if (depth <= geographic) {
          expect(target.laneLimited).toBe(false);
          expect(back).toBe(path);
        } else {
          // Below the privacy floor the digits are identity lanes: the area matches, the lane is the traveler's own.
          expect(target.laneLimited).toBe(true);
          expect(back.slice(0, geographic)).toBe(path.slice(0, geographic));
        }
      }
    }
  });
});
