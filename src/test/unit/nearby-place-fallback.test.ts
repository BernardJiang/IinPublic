/** @jest-environment jsdom */

import { IinPublicApp } from '../../web/app/app';
import { deriveNearbyRoomAssignment, isNearbyRoomId } from '../../shared/nearby-rooms';

describe('full Place Nearby fallback', () => {
  beforeEach(() => localStorage.clear());

  it('offers a deliberate Nearby room derived from the Place public pin', () => {
    const app: any = Object.create(IinPublicApp.prototype);
    let joinSuggestion: (() => void) | undefined;
    app.currentUser = { id: 'alice', languages: ['en'] };
    app.nearbyControlRootAssignment = null;
    app.nearbyControlRoutingLocation = null;
    app.chatroomService = { getNearbyRoomAssignment: jest.fn().mockReturnValue(undefined) };
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
    expect(isNearbyRoomId(app.pendingNearbyTravel.rootAssignment.roomId)).toBe(true);
    expect(app.pendingNearbyTravel.location).toMatchObject({
      latitude: 32.7157,
      longitude: -117.1611,
    });
    expect(app.uiManager.emit).toHaveBeenCalledWith(
      'chatroomChanged',
      app.pendingNearbyTravel.rootAssignment.roomId,
    );
  });

  it('restores only a Nearby travel room that also has its public Place point', () => {
    const app: any = Object.create(IinPublicApp.prototype);
    app.uiManager = { setTravelModeState: jest.fn() };
    const travelRoomId = deriveNearbyRoomAssignment({
      location: { latitude: 40.7128, longitude: -74.006, accuracy: 0, timestamp: new Date() },
      mode: 'neighborhood',
      identity: 'alice',
    }).roomId;
    localStorage.setItem('iinpublic_travel_room', travelRoomId);
    localStorage.setItem('iinpublic_travel_nearby_point', JSON.stringify({
      latitude: 40.7128,
      longitude: -74.006,
      placeId: 'place-nyc',
      placeName: 'Public Library',
    }));

    app.loadTravelModeStateFromStorage();

    expect(app.travelModeActive).toBe(true);
    expect(app.travelChatroomId).toBe(travelRoomId);
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
