import { selectDirectTalkPeers } from '../../shared/direct-talk-scheduler';
import { deriveNearbyRoomAssignment, type NearbyRoomAssignment } from '../../shared/nearby-rooms';
import {
  advanceNearbySparseState,
  initialNearbySparseState,
  NEARBY_SPARSE_DWELL_MS,
} from '../../shared/nearby-sparse-policy';
import type { GPSCoordinate } from '../../shared/types';

type SimulatedUser = {
  id: string;
  location: GPSCoordinate;
  assignment: NearbyRoomAssignment;
};

const CAPACITIES = [32, 64, 128, 256, 498] as const;
const USER_COUNT = 10_000;
const NEIGHBOR_LIMIT = 12;

/** A deterministic 400 m × 250 m seating grid around a stadium in San Diego. */
function arenaUsers(): SimulatedUser[] {
  const centerLatitude = 32.7832;
  const centerLongitude = -117.1225;
  const metersPerLatitudeDegree = 111_320;
  const metersPerLongitudeDegree = metersPerLatitudeDegree * Math.cos(centerLatitude * Math.PI / 180);
  return Array.from({ length: USER_COUNT }, (_, index) => {
    const row = Math.floor(index / 100);
    const column = index % 100;
    const location: GPSCoordinate = {
      latitude: centerLatitude + ((row - 49.5) * 2.5) / metersPerLatitudeDegree,
      longitude: centerLongitude + ((column - 49.5) * 4) / metersPerLongitudeDegree,
      accuracy: 5,
      timestamp: new Date('2026-10-10T12:00:00.000Z'),
    };
    const id = `arena-user-${String(index).padStart(5, '0')}`;
    return {
      id,
      location,
      assignment: deriveNearbyRoomAssignment({ location, mode: 'neighborhood', identity: id }),
    };
  });
}

function groupByRoom(users: SimulatedUser[]): Map<string, SimulatedUser[]> {
  const groups = new Map<string, SimulatedUser[]>();
  for (const user of users) {
    const room = groups.get(user.assignment.roomId) ?? [];
    room.push(user);
    groups.set(user.assignment.roomId, room);
  }
  return groups;
}

/** Follow only each over-capacity branch, matching the certificate-chain behavior used by clients. */
function settleArena(capacity: number): { users: SimulatedUser[]; rounds: number } {
  const users = arenaUsers();
  for (let round = 0; round < 20; round += 1) {
    const groups = groupByRoom(users);
    const overfull = new Set(
      [...groups.entries()].filter(([, members]) => members.length > capacity).map(([roomId]) => roomId),
    );
    if (overfull.size === 0) return { users, rounds: round };
    for (const user of users) {
      if (!overfull.has(user.assignment.roomId)) continue;
      user.assignment = deriveNearbyRoomAssignment({
        location: user.location,
        mode: 'neighborhood',
        identity: user.id,
        requestedSplitGeneration: user.assignment.requestedSplitGeneration + 1,
        previous: user.assignment,
      });
    }
  }
  throw new Error(`arena did not settle at capacity ${capacity}`);
}

describe('OPEN-40 10,000-person Nearby capacity simulation', () => {
  test.each(CAPACITIES)('adaptive geographic paths keep every active room at or below C=%i', (capacity) => {
    const result = settleArena(capacity);
    const groups = groupByRoom(result.users);
    const occupancies = [...groups.values()].map((members) => members.length);

    expect(result.users).toHaveLength(USER_COUNT);
    expect(occupancies.reduce((sum, count) => sum + count, 0)).toBe(USER_COUNT);
    expect(Math.max(...occupancies)).toBeLessThanOrEqual(capacity);
    expect(Math.min(...occupancies)).toBeGreaterThan(0);
    expect(result.rounds).toBeGreaterThan(0);
    for (const user of result.users) {
      expect(user.assignment.roomId).not.toContain(String(user.location.latitude));
      expect(user.assignment.roomId).not.toContain(String(user.location.longitude));
    }
  }, 30_000);

  it('keeps direct-link selection symmetric and K-bounded inside settled rooms', () => {
    const { users } = settleArena(498);
    const rooms = [...groupByRoom(users).values()];
    for (const room of rooms) {
      const ids = room.map((user) => user.id);
      const selectedByUser = new Map(ids.map((localId) => [
        localId,
        selectDirectTalkPeers(ids, localId, NEIGHBOR_LIMIT, 0),
      ]));
      for (const localId of ids) {
        const selected = selectedByUser.get(localId)!;
        expect(selected.length).toBeLessThanOrEqual(NEIGHBOR_LIMIT);
        for (const peerId of selected) {
          expect(selectedByUser.get(peerId)).toContain(localId);
        }
      }
    }
  }, 30_000);

  it('lets asynchronously arriving users in adjacent sparse cells converge without parent overlap', () => {
    const points: GPSCoordinate[] = [
      { latitude: 0, longitude: 0.0044, accuracy: 10, timestamp: new Date(0) },
      { latitude: 0, longitude: 0.0092, accuracy: 10, timestamp: new Date(0) },
    ];
    const arrivals = [0, NEARBY_SPARSE_DWELL_MS + 20_000];
    const agents = points.map((location, index) => ({
      id: `sparse-${index}`,
      location,
      state: initialNearbySparseState(),
      assignment: deriveNearbyRoomAssignment({
        location,
        mode: 'neighborhood' as const,
        identity: `sparse-${index}`,
      }),
    }));

    let metAt: number | null = null;
    for (let nowMs = 0; nowMs <= 20 * 60_000; nowMs += 20_000) {
      const online = agents.filter((_, index) => nowMs >= arrivals[index]!);
      const roomCounts = new Map<string, number>();
      for (const agent of online) {
        roomCounts.set(agent.assignment.roomId, (roomCounts.get(agent.assignment.roomId) ?? 0) + 1);
      }
      if (online.length === 2 && online[0]!.assignment.roomId === online[1]!.assignment.roomId) {
        metAt = nowMs;
        break;
      }
      for (const agent of online) {
        const decision = advanceNearbySparseState({
          state: agent.state,
          activeMemberCount: roomCounts.get(agent.assignment.roomId)!,
          nowMs,
        });
        agent.state = decision.state;
        if (decision.direction === 'hold') continue;
        agent.assignment = deriveNearbyRoomAssignment({
          location: agent.location,
          mode: 'neighborhood',
          identity: agent.id,
          wideningLevel: decision.state.wideningLevel,
        });
      }
    }

    expect(metAt).not.toBeNull();
    expect(agents[0]!.assignment.roomId).toBe(agents[1]!.assignment.roomId);
    expect(agents[0]!.state.wideningLevel).toBeLessThanOrEqual(3);
    expect(agents[1]!.state.wideningLevel).toBeLessThanOrEqual(3);
  });
});
