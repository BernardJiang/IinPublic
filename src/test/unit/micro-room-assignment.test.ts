import {
  assignMicroRoom,
  assignMicroRoomForGeneration,
  microRoomBelongsToBase,
  microRoomControlScopeId,
  microRoomGenerationForRoom,
  microRoomLaneIndex,
  recommendedMicroRoomLaneCount,
} from '../../shared/micro-room-assignment';

describe('OPEN-40 deterministic micro-room assignment', () => {
  const baseGrid = 'region_32.71_-117.17_room_0';

  it('does not split a grid until it exceeds the global capacity', () => {
    expect(recommendedMicroRoomLaneCount(0, 498)).toBe(1);
    expect(recommendedMicroRoomLaneCount(498, 498)).toBe(1);
    expect(recommendedMicroRoomLaneCount(499, 498)).toBe(2);
    expect(assignMicroRoom('pub-alice', baseGrid, 498, 498).roomId).toBe(baseGrid);
  });

  it('plans 32 headroom lanes for 10,000 users at C=498', () => {
    expect(recommendedMicroRoomLaneCount(10_000, 498)).toBe(32);
  });

  it('is deterministic and does not expose coordinate-bearing grid ids', () => {
    const first = assignMicroRoom('pub-alice', baseGrid, 10_000, 498);
    const second = assignMicroRoom('pub-alice', baseGrid, 10_000, 498);
    expect(second).toEqual(first);
    expect(first.roomId).toMatch(/^grid_[a-f0-9]{24}_g5_lane_\d+$/);
    expect(first.roomId).not.toContain('32.71');
    expect(first.roomId).not.toContain('-117.17');
  });

  it('keeps a deterministic 10,000-identity simulation below C with headroom', () => {
    const lanes = recommendedMicroRoomLaneCount(10_000, 498);
    const occupancy = Array.from({ length: lanes }, () => 0);
    for (let i = 0; i < 10_000; i += 1) {
      occupancy[microRoomLaneIndex(`pub-${i}`, baseGrid, lanes)] += 1;
    }
    expect(occupancy.reduce((sum, count) => sum + count, 0)).toBe(10_000);
    expect(Math.max(...occupancy)).toBeLessThanOrEqual(498);
    expect(Math.min(...occupancy)).toBeGreaterThan(0);
  });

  it('rejects non-power-of-two lane plans so peers cannot derive incompatible generations', () => {
    expect(() => microRoomLaneIndex('pub-alice', baseGrid, 21)).toThrow(
      'micro-room lane count must be a power of two',
    );
  });

  it('derives a coordinate-free control scope and assignment from a verified generation', () => {
    expect(microRoomControlScopeId(baseGrid)).toMatch(/^grid_[a-f0-9]{24}_control_v1$/);
    expect(microRoomControlScopeId(baseGrid)).not.toContain('32.71');
    const assignment = assignMicroRoomForGeneration('pub-alice', baseGrid, 5);
    expect(assignment).toEqual(
      expect.objectContaining({ laneCount: 32, splitGeneration: 5 }),
    );
    expect(microRoomBelongsToBase(assignment.roomId, baseGrid)).toBe(true);
    expect(microRoomGenerationForRoom(assignment.roomId, baseGrid)).toBe(5);
    expect(microRoomGenerationForRoom(baseGrid, baseGrid)).toBe(0);
    expect(microRoomBelongsToBase('unrelated-room', baseGrid)).toBe(false);
  });
});
