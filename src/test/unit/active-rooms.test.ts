import { summarizeActiveRooms } from '../../shared/active-rooms';

const SD = { latitude: 32.7157, longitude: -117.1611 };
const points: Record<string, { latitude: number; longitude: number }> = {
  a1: { latitude: 32.72, longitude: -117.16 },
  a2: { latitude: 32.71, longitude: -117.17 },
  b1: { latitude: 32.85, longitude: -117.27 }, // La Jolla, ~17 km
  c1: { latitude: 34.05, longitude: -118.24 }, // Los Angeles, ~180 km
  c2: { latitude: 34.06, longitude: -118.25 },
  c3: { latitude: 34.04, longitude: -118.23 },
};
const rooms = [
  { roomId: 'nearby_la', memberIds: ['c1', 'c2', 'c3'] },
  { roomId: 'nearby_home', memberIds: ['a1', 'a2'] },
  { roomId: 'nearby_lajolla', memberIds: ['b1'] },
  { roomId: 'place_32.71_-117.17_abcdefabcdef', memberIds: ['a1', 'x9'] },
  { roomId: 'nearby_empty', memberIds: [] },
];
const summarize = (extra: Partial<Parameters<typeof summarizeActiveRooms>[0]> = {}) => summarizeActiveRooms({
  rooms,
  pointOf: (id) => points[id],
  placeOf: (id) => id.startsWith('place_') ? { name: 'Bean There Café', latitude: 32.711, longitude: -117.171 } : undefined,
  origin: SD,
  currentRoomId: 'nearby_home',
  ...extra,
});

describe('room list (active rooms)', () => {
  it('lists my room first, then rooms with people nearest first; empty rooms are left out', () => {
    const view = summarize();
    expect(view.rooms.map((room) => room.roomId)).toEqual(['nearby_home', 'place_32.71_-117.17_abcdefabcdef', 'nearby_lajolla', 'nearby_la']);
    expect(view.totalRooms).toBe(4);
    // Distinct people across every room (a1 is in two rooms).
    expect(view.totalOnline).toBe(7);
    expect(view.rooms[2]).toEqual(expect.objectContaining({ kind: 'nearby', memberCount: 1 }));
    expect(view.rooms[2]!.distanceMeters!).toBeGreaterThan(15_000);
    expect(view.rooms[3]!.bearingDegrees!).toBeGreaterThan(270);
    expect(view.rooms[1]).toEqual(expect.objectContaining({ kind: 'place', name: 'Bean There Café' }));
  });

  it('sorts by busiest or most room on request, keeping my room on top', () => {
    expect(summarize({ sort: 'busiest' }).rooms.map((room) => room.roomId))
      .toEqual(['nearby_home', 'nearby_la', 'place_32.71_-117.17_abcdefabcdef', 'nearby_lajolla']);
    expect(summarize({ sort: 'most-room' }).rooms.map((room) => room.roomId))
      .toEqual(['nearby_home', 'nearby_lajolla', 'place_32.71_-117.17_abcdefabcdef', 'nearby_la']);
  });

  it('pages the list and places a room without any member dot last', () => {
    const page = summarize({ limit: 2 });
    expect(page.rooms).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    const unplaced = summarizeActiveRooms({
      rooms: [{ roomId: 'nearby_x', memberIds: ['ghost'] }, { roomId: 'nearby_la', memberIds: ['c1'] }],
      pointOf: (id) => points[id],
      placeOf: () => undefined,
      origin: SD,
    });
    expect(unplaced.rooms.map((room) => room.roomId)).toEqual(['nearby_la', 'nearby_x']);
    expect(unplaced.rooms[1]!.latitude).toBeUndefined();
  });
});
