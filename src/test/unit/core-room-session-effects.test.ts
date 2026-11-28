import { RoomSessionEffects, type RoomSessionState } from '../../core/room-session-effects';

const effects = new RoomSessionEffects({
  isNearby: (id) => id.startsWith('nearby'),
  isPlace: (id) => id.startsWith('place'),
});
const initial: RoomSessionState = {
  currentRoomId: 'nearby-home',
  travelModeActive: false,
  travelHomeRoomId: undefined,
  travelRoomId: undefined,
  travelNearbyPoint: undefined,
  pendingNearbyTravel: undefined,
};

describe('RoomSessionEffects', () => {
  it('enters a Place while preserving the home room', () => {
    expect(effects.enter(initial, 'place-cafe')).toMatchObject({
      currentRoomId: 'place-cafe', travelModeActive: true, travelHomeRoomId: 'nearby-home', travelRoomId: 'place-cafe',
    });
  });

  it('commits a pending Nearby-at-point trip only when the room changes', () => {
    const pending = {
      ...initial,
      pendingNearbyTravel: {
        location: { latitude: 1, longitude: 2, accuracy: 0, timestamp: new Date(0) },
        placeId: 'map',
        placeName: 'Point',
      },
    };
    expect(effects.enter(pending, 'nearby-map')).toMatchObject({
      travelModeActive: true,
      travelNearbyPoint: { latitude: 1, longitude: 2, placeId: 'map', placeName: 'Point' },
      pendingNearbyTravel: undefined,
    });
  });

  it('returns to ordinary Nearby as home when no point trip continues', () => {
    const traveling = effects.enter(initial, 'place-cafe');
    expect(effects.enter(traveling, 'nearby-home')).toMatchObject({
      travelModeActive: false, travelHomeRoomId: 'nearby-home', travelRoomId: undefined,
    });
  });

  it('clears all travel state when returning home', () => {
    expect(effects.home(effects.enter(initial, 'place-cafe'), 'nearby-home')).toEqual({
      currentRoomId: 'nearby-home', travelModeActive: false, travelHomeRoomId: 'nearby-home',
      travelRoomId: undefined, travelNearbyPoint: undefined, pendingNearbyTravel: undefined,
    });
  });
});
