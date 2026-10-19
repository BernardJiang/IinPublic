import { summarizeActiveRooms } from '../../shared/active-rooms';

const SD = { latitude: 32.7157, longitude: -117.1611 };
const CAFE = 'place_32.71_-117.17_abcdefabcdef';
const LAJOLLA = 'place_32.85_-117.27_abcdefabcdef';
const LA = 'place_34.05_-118.24_abcdefabcdef';
const pins: Record<string, { name: string; latitude: number; longitude: number }> = {
  [CAFE]: { name: 'Bean There Café', latitude: 32.711, longitude: -117.171 },
  [LAJOLLA]: { name: 'Cove', latitude: 32.85, longitude: -117.27 }, // ~17 km
  [LA]: { name: 'Echo Park', latitude: 34.05, longitude: -118.24 }, // ~180 km
};
const rooms = [
  { roomId: LA, memberIds: ['c1', 'c2', 'c3'] },
  { roomId: CAFE, memberIds: ['a1', 'a2'] },
  { roomId: LAJOLLA, memberIds: ['b1', 'a1'] },
  { roomId: 'place_0.00_0.00_abcdefabcdef', memberIds: [] },
  // A retired v2 Nearby group still in the hub's roster: Nearby is never a listed room (§3.7).
  { roomId: 'nearby_v2_e1_0123456789abcdef01234567', memberIds: ['z1', 'z2'] },
];
const summarize = (extra: Partial<Parameters<typeof summarizeActiveRooms>[0]> = {}) => summarizeActiveRooms({
  rooms,
  placeOf: (id) => pins[id],
  origin: SD,
  ...extra,
});

describe('room list (active Places)', () => {
  it('lists Places with people, nearest first; empty Places and non-Places are left out', () => {
    const view = summarize();
    expect(view.rooms.map((room) => room.roomId)).toEqual([CAFE, LAJOLLA, LA]);
    expect(view.totalRooms).toBe(3);
    // Distinct people across every Place (a1 is in two); the retired group's members are not counted.
    expect(view.totalOnline).toBe(6);
    expect(view.rooms[0]).toEqual(expect.objectContaining({ kind: 'place', name: 'Bean There Café', memberCount: 2 }));
    expect(view.rooms[1]!.distanceMeters!).toBeGreaterThan(15_000);
    expect(view.rooms[2]!.bearingDegrees!).toBeGreaterThan(270);
  });

  it('keeps my own Place on top and sorts by busiest or most room on request', () => {
    expect(summarize({ currentRoomId: LA }).rooms[0]!.roomId).toBe(LA);
    expect(summarize({ sort: 'busiest' }).rooms.map((room) => room.roomId)).toEqual([LA, CAFE, LAJOLLA]);
    expect(summarize({ sort: 'most-room' }).rooms.map((room) => room.roomId)).toEqual([CAFE, LAJOLLA, LA]);
  });

  it('pages the list and puts a Place without a known pin last', () => {
    const page = summarize({ limit: 2 });
    expect(page.rooms).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    const unplaced = summarizeActiveRooms({
      rooms: [{ roomId: 'place_9.99_9.99_abcdefabcdef', memberIds: ['ghost'] }, { roomId: LA, memberIds: ['c1'] }],
      placeOf: (id) => pins[id],
      origin: SD,
    });
    expect(unplaced.rooms.map((room) => room.roomId)).toEqual([LA, 'place_9.99_9.99_abcdefabcdef']);
    expect(unplaced.rooms[1]!.latitude).toBeUndefined();
  });
});
