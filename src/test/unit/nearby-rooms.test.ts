import {
  deriveNearbyRoomAssignment,
  isNearbyRoomId,
  maximumGeographicSplitGeneration,
  nearbyPublicScope,
  projectNearbyCoordinate,
} from '../../shared/nearby-rooms';
import type { GPSCoordinate } from '../../shared/types';

const point = (latitude: number, longitude: number, accuracy = 10): GPSCoordinate => ({
  latitude,
  longitude,
  accuracy,
  timestamp: new Date('2026-10-08T12:00:00.000Z'),
});

describe('Nearby geographic room placement', () => {
  test('same close-nearby cell converges without exposing coordinates in the room ID', () => {
    const alice = deriveNearbyRoomAssignment({
      location: point(32.7157, -117.1611),
      mode: 'close-nearby',
      identity: 'alice',
    });
    const bob = deriveNearbyRoomAssignment({
      location: point(32.71571, -117.16109),
      mode: 'close-nearby',
      identity: 'bob',
    });
    expect(alice.roomId).toBe(bob.roomId);
    expect(isNearbyRoomId(alice.roomId)).toBe(true);
    expect(alice.roomId).not.toContain('32.7157');
    expect(alice.roomId).not.toContain('117.1611');
  });

  test('overflow generations group by finer geography before identity', () => {
    const west = deriveNearbyRoomAssignment({
      location: point(32.7157, -117.1625, 5),
      mode: 'neighborhood',
      identity: 'same-identity',
      requestedSplitGeneration: 3,
    });
    const east = deriveNearbyRoomAssignment({
      location: point(32.7157, -117.1585, 5),
      mode: 'neighborhood',
      identity: 'same-identity',
      requestedSplitGeneration: 3,
    });
    expect(west.splitGeneration).toBe(3);
    expect(west.identityLaneCount).toBe(1);
    expect(west.roomId).not.toBe(east.roomId);
  });

  test('poor GPS accuracy stops geographic splitting and uses final identity lanes', () => {
    expect(maximumGeographicSplitGeneration(400, 100)).toBe(1);
    const assignment = deriveNearbyRoomAssignment({
      location: point(32.7157, -117.1611, 100),
      mode: 'close-nearby',
      identity: 'alice',
      requestedSplitGeneration: 4,
    });
    expect(assignment.splitGeneration).toBe(1);
    expect(assignment.identityLaneCount).toBe(8);
    expect(assignment.roomId).toMatch(/_l\d+of8$/);
  });

  test('boundary hysteresis prevents GPS drift from immediately changing rooms', () => {
    const first = deriveNearbyRoomAssignment({
      location: point(0, 0.00358),
      mode: 'close-nearby',
      identity: 'alice',
    });
    const projected = projectNearbyCoordinate(point(0, 0.0036));
    const justAcross = point(0, (projected.x + 8) / 6_378_137 * 180 / Math.PI);
    const stable = deriveNearbyRoomAssignment({
      location: justAcross,
      mode: 'close-nearby',
      identity: 'alice',
      previous: first,
    });
    expect(stable.roomId).toBe(first.roomId);
  });

  test('public scope omits local grid coordinates and exact location', () => {
    const assignment = deriveNearbyRoomAssignment({
      location: point(32.7157, -117.1611),
      mode: 'neighborhood',
      identity: 'alice',
    });
    const scope = nearbyPublicScope(assignment) as Record<string, unknown>;
    expect(scope.localCell).toBeUndefined();
    expect(JSON.stringify(scope)).not.toContain('32.7157');
    expect(JSON.stringify(scope)).not.toContain('-117.1611');
  });
});
