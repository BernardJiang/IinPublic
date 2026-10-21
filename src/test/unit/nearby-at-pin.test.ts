/** @jest-environment jsdom */

import { IinPublicApp } from '../../web/app/app';
import { NEARBY_V3_ROOM_ID } from '../../shared/nearby-rooms';

describe('Nearby at a pin', () => {
  beforeEach(() => localStorage.clear());

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
