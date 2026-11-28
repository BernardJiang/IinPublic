/** @jest-environment jsdom */
import { RoomSessionEffects } from '../../core/room-session-effects';
import { registerRoomEventHandlers } from '../../web/app/room-event-handlers';

describe('registerRoomEventHandlers', () => {
  it('registers room and location commands', () => {
    const names: string[] = [];
    registerRoomEventHandlers({
      ui: { on: (name: string) => names.push(name) } as any,
      chatrooms: {} as any,
      session: new RoomSessionEffects({ isNearby: () => false, isPlace: () => false }),
      contactsOnlyRoomId: 'contacts',
      currentUser: () => undefined,
      state: () => ({
        currentRoomId: undefined,
        travelModeActive: false,
        travelHomeRoomId: undefined,
        travelRoomId: undefined,
        travelNearbyPoint: undefined,
        pendingNearbyTravel: undefined,
      }),
      commitState: jest.fn(), persistRoom: jest.fn(), persistTravel: jest.fn(), subscribeRoom: jest.fn(),
      activateRoom: jest.fn(), isLocalOnly: () => false, refreshNearbyPoint: jest.fn(), syncBackgroundAgent: jest.fn(),
      resolveHomeRoom: jest.fn(), updateLocation: jest.fn(), locationConfirmed: () => false,
      locationText: (kind) => kind, requestLocationPermission: jest.fn(), onLocationGranted: jest.fn(),
      meetNewPeople: jest.fn(), backToFirstGroup: jest.fn(), beginNearbyTravel: jest.fn(), createCustomRoom: jest.fn(),
      notifySwitchFailed: jest.fn(),
    });
    expect(names).toEqual([
      'requestLocationUpdate', 'requestLocationPermission', 'nearbyMeetNewPeople', 'nearbyBackToFirstGroup',
      'travelNearbyAtPoint', 'returnHomeFromTravel', 'createCustomChatroom', 'chatroomChanged',
    ]);
  });
});
