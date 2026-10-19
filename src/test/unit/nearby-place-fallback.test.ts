/** @jest-environment jsdom */

import { IinPublicApp } from '../../web/app/app';
import { NEARBY_V3_ROOM_ID } from '../../shared/nearby-rooms';

describe('full Place Nearby fallback', () => {
  beforeEach(() => localStorage.clear());

  it('offers Nearby at the Place pin: my card moves there, the scope stays my list', () => {
    const app: any = Object.create(IinPublicApp.prototype);
    let joinSuggestion: (() => void) | undefined;
    app.currentUser = { id: 'alice', languages: ['en'] };
    app.uiManager = {
      getCustomChatroomMeta: jest.fn().mockReturnValue({
        id: 'place-id',
        name: 'Bean There',
        location: { latitude: 32.7157, longitude: -117.1611 },
      }),
      showLocationRoomSuggestion: jest.fn((_label: string, onJoin: () => void) => {
        joinSuggestion = onJoin;
      }),
      emit: jest.fn(),
    };

    app.offerNearbyAroundFullPlace('place-id');

    expect(app.uiManager.showLocationRoomSuggestion).toHaveBeenCalledWith(
      'Nearby around Bean There',
      expect.any(Function),
    );
    joinSuggestion!();
    expect(app.pendingNearbyTravel).toMatchObject({
      placeId: 'place-id',
      placeName: 'Bean There',
      location: { latitude: 32.7157, longitude: -117.1611 },
    });
    expect(app.uiManager.emit).toHaveBeenCalledWith('chatroomChanged', NEARBY_V3_ROOM_ID);
  });

  it('restores a Nearby-at-a-pin visit only together with its public point', () => {
    const app: any = Object.create(IinPublicApp.prototype);
    app.uiManager = { setTravelModeState: jest.fn() };
    localStorage.setItem('iinpublic_travel_room', NEARBY_V3_ROOM_ID);
    localStorage.setItem('iinpublic_travel_nearby_point', JSON.stringify({
      latitude: 40.7128,
      longitude: -74.006,
      placeId: 'place-nyc',
      placeName: 'Public Library',
    }));

    app.loadTravelModeStateFromStorage();

    expect(app.travelModeActive).toBe(true);
    expect(app.travelChatroomId).toBe(NEARBY_V3_ROOM_ID);
    expect(app.travelNearbyPoint).toMatchObject({
      latitude: 40.7128,
      longitude: -74.006,
      placeId: 'place-nyc',
    });

    localStorage.removeItem('iinpublic_travel_nearby_point');
    app.loadTravelModeStateFromStorage();
    expect(app.travelModeActive).toBe(false);
    expect(app.travelChatroomId).toBeUndefined();
  });
});
