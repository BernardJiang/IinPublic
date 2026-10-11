/** @jest-environment jsdom */

import { IinPublicApp } from '../../web/app/app';
import { deriveNearbyRoomAssignment } from '../../shared/nearby-rooms';
import type { GPSCoordinate } from '../../shared/types';

describe('Nearby sparse-area app wiring', () => {
  const location: GPSCoordinate = {
    latitude: 32.7157,
    longitude: -117.1611,
    accuracy: 10,
    timestamp: new Date('2026-10-10T00:00:00.000Z'),
  };

  afterEach(() => jest.useRealTimers());

  it('starts the exchange runtime when a confirmed location first moves Contacts-only into Nearby', async () => {
    const root = deriveNearbyRoomAssignment({ location, mode: 'neighborhood', identity: 'alice' });
    const app: any = Object.create(IinPublicApp.prototype);
    app.currentUser = { id: 'alice', stageName: 'Alice' };
    app.currentChatroomId = 'local_contacts_only_v1';
    app.travelModeActive = false;
    app.chatroomService = {
      updateLocalUserLocation: jest.fn(),
      getCurrentChatroomId: jest.fn(() => 'local_contacts_only_v1'),
      switchChatroom: jest.fn(async () => undefined),
      subscribeToMembers: jest.fn(),
    };
    app.userService = { updateUserLocation: jest.fn(async () => undefined) };
    app.resolveAutomaticNearbyRoom = jest.fn(async () => root.roomId);
    app.subscribeToMessages = jest.fn();
    app.activateRoomExchange = jest.fn(async () => undefined);
    app.uiManager = {
      setCurrentChatroomId: jest.fn(),
      showNotification: jest.fn(),
      formatTravelMovedLocation: jest.fn(() => 'moved'),
      formatLocationUpdateFailed: jest.fn(() => 'failed'),
    };

    await app.updateLocationAndMaybeSwitch(location);

    expect(app.chatroomService.switchChatroom).toHaveBeenCalledWith('alice', root.roomId, 'Alice');
    expect(app.subscribeToMessages).toHaveBeenCalledWith(root.roomId);
    expect(app.chatroomService.subscribeToMembers).toHaveBeenCalledWith(root.roomId, expect.any(Function));
    expect(app.activateRoomExchange).toHaveBeenCalledWith(root.roomId);
    expect(localStorage.getItem('iinpublic_last_chatroom')).toBe(root.roomId);
  });

  it('does not make a private widening decision from one partial roster', () => {
    const root = deriveNearbyRoomAssignment({
      location,
      mode: 'neighborhood',
      identity: 'alice',
    });
    const app: any = Object.create(IinPublicApp.prototype);
    app.currentUser = { id: 'alice' };
    app.currentChatroomId = root.roomId;
    app.nearbyControlRootAssignment = root;
    app.nearbyControlRoutingLocation = location;
    app.chatroomService = {
      getNearbyRoomAssignment: jest.fn(() => root),
      setNearbyRootAssignment: jest.fn(),
      setNearbyRoomAssignment: jest.fn(),
    };
    app.uiManager = { emit: jest.fn(), setNearbyMapAssignment: jest.fn() };
    app.observeNearbyRoomRoster(root.roomId, [{ userId: 'alice' }]);
    expect(app.chatroomService.setNearbyRootAssignment).not.toHaveBeenCalled();
    expect(app.uiManager.emit).not.toHaveBeenCalled();
  });
});
