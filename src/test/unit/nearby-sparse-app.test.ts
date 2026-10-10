/** @jest-environment jsdom */

import { IinPublicApp } from '../../web/app/app';
import { NEARBY_SPARSE_DWELL_MS, initialNearbySparseState } from '../../shared/nearby-sparse-policy';
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

  it('replaces the active root after the sparse dwell without subscribing to a parent', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-10T01:00:00.000Z'));
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
    app.nearbySparseState = {
      ...initialNearbySparseState(),
      sparseSinceMs: Date.now() - NEARBY_SPARSE_DWELL_MS,
    };
    app.nearbySparseAnchorRoomId = root.roomId;
    app.nearbySparseTransitionInFlight = false;
    app.chatroomService = {
      getNearbyRoomAssignment: jest.fn(() => root),
      setNearbyRootAssignment: jest.fn(),
      setNearbyRoomAssignment: jest.fn(),
    };
    app.uiManager = { emit: jest.fn(), setNearbyMapAssignment: jest.fn() };
    app.resolveNearbyBeforeAdmission = jest.fn(async (assignment: { roomId: string }) => assignment.roomId);

    app.observeNearbyRoomRoster(root.roomId, [{ userId: 'alice' }]);
    await Promise.resolve();

    const widened = app.chatroomService.setNearbyRootAssignment.mock.calls[0][0];
    expect(widened.wideningLevel).toBe(1);
    expect(widened.roomId).toMatch(/_w1_g0_/);
    expect(app.uiManager.emit).toHaveBeenCalledWith('chatroomChanged', widened.roomId);
    // The policy consumes the existing active subscription; it never creates another one.
    expect(app.chatroomService.subscribeToMembers).toBeUndefined();
  });

  it('does not widen a capacity-split child even when its own roster is small', () => {
    const root = deriveNearbyRoomAssignment({ location, mode: 'neighborhood', identity: 'alice' });
    const child = deriveNearbyRoomAssignment({
      location,
      mode: 'neighborhood',
      identity: 'alice',
      requestedSplitGeneration: 1,
    });
    const app: any = Object.create(IinPublicApp.prototype);
    app.currentUser = { id: 'alice' };
    app.currentChatroomId = child.roomId;
    app.nearbyControlRootAssignment = root;
    app.nearbyControlRoutingLocation = location;
    app.nearbySparseState = {
      ...initialNearbySparseState(),
      sparseSinceMs: Date.now() - NEARBY_SPARSE_DWELL_MS,
    };
    app.nearbySparseAnchorRoomId = root.roomId;
    app.nearbySparseTransitionInFlight = false;
    app.chatroomService = {
      getNearbyRoomAssignment: jest.fn(() => child),
      setNearbyRootAssignment: jest.fn(),
    };

    app.observeNearbyRoomRoster(child.roomId, [{ userId: 'alice' }]);

    expect(app.chatroomService.setNearbyRootAssignment).not.toHaveBeenCalled();
    expect(app.nearbySparseState.sparseSinceMs).toBeNull();
  });
});
