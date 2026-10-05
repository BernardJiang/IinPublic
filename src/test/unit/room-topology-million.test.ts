import { roomTopologyBounds, syntheticRoomForUser } from '../../shared/room-topology-bounds';

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
});
