import { roomTopologyBounds, syntheticRoomForUser } from '../../shared/room-topology-bounds';
import {
  NEARBY_PARTITION_MAX_CHAIN,
  NEARBY_PARTITION_MAX_DEPTH,
  nearbyPartitionSelectorPath,
} from '../../shared/nearby-partition';

describe('OPEN-37 one-million-user topology', () => {
  it('keeps candidate enumeration O(C) per device and link attempts O(NK)', () => {
    const bounds = roomTopologyBounds(1_000_000, 498, 12);
    expect(bounds).toEqual({
      users: 1_000_000,
      roomCapacity: 498,
      neighborLimit: 12,
      minimumRoomCount: 2009,
      maximumCandidatesPerDevice: 497,
      maximumDirectedLinks: 12_000_000,
      maximumUndirectedLinks: 6_000_000,
      globalPairCount: 499_999_500_000,
    });
    expect(bounds.maximumUndirectedLinks).toBeLessThan(bounds.globalPairCount / 80_000);
  });

  it('partitions directly without constructing a global roster', () => {
    expect(syntheticRoomForUser(0, 498)).toBe(0);
    expect(syntheticRoomForUser(497, 498)).toBe(0);
    expect(syntheticRoomForUser(498, 498)).toBe(1);
    expect(syntheticRoomForUser(999_999, 498)).toBe(2008);
  });

  it('keeps a one-million-person same-point venue below C through privacy-safe load shedding', () => {
    const location = { latitude: 0, longitude: 0, accuracy: 5, timestamp: new Date(0) };
    const occupancy = new Map<string, number>();
    for (let index = 0; index < 1_000_000; index += 1) {
      const path = nearbyPartitionSelectorPath(
        location,
        'close-nearby',
        NEARBY_PARTITION_MAX_DEPTH,
        `million-user-${index}`,
      );
      occupancy.set(path, (occupancy.get(path) ?? 0) + 1);
    }
    expect(Math.max(...occupancy.values())).toBeLessThanOrEqual(498);
    expect(NEARBY_PARTITION_MAX_DEPTH).toBeLessThanOrEqual(NEARBY_PARTITION_MAX_CHAIN);
    expect(occupancy.size).toBeLessThanOrEqual(65_536);
  }, 30_000);
});
