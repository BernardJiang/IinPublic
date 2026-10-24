/** @jest-environment jsdom */

import { renderChatroomList } from '../../web/ui/chatrooms-view';
import { renderChatroomMap } from '../../web/ui/chatroom-map-view';
import { uiText } from '../../web/ui/ui-translations';
import { NEARBY_V3_ROOM_ID } from '../../shared/nearby-rooms';
import { MAP_HINT_VISIBLE_MS } from '../../web/ui/transient-map-hint';

jest.mock('../../web/ui/chatroom-map-view', () => ({ renderChatroomMap: jest.fn() }));

const mapRenderer = renderChatroomMap as jest.MockedFunction<typeof renderChatroomMap>;
const NEARBY_ID = NEARBY_V3_ROOM_ID;
const PLACE_ID = 'place_32.71_-117.17_abcdefabcdef';

describe('flat chatroom map', () => {
  it('renders only Place pins (no Nearby pin) and emits deliberate point travel', () => {
    jest.useFakeTimers();
    document.body.innerHTML = `
      <button id="chatroom-list-view-btn"></button>
      <button id="chatroom-map-view-btn"></button>
      <div id="chatroom-list-container">
        <div id="chatroom-map-status"></div>
        <div id="chatroom-list"></div>
        <div id="chatroom-map"></div>
      </div>`;
    const emit = jest.fn();

    renderChatroomList({
      currentChatroom: NEARBY_ID,
      chatroomMemberCounts: new Map(),
      chatroomVisitCounts: new Map(),
      chatroomBrowseMode: 'map',
      expandedChatrooms: new Set(),
      matchedUserIds: new Set(),
      customChatrooms: [{
        id: PLACE_ID,
        name: 'Bean There Café',
        type: 'business',
        location: { latitude: 32.71, longitude: -117.17 },
      }],
      travelModeActive: false,
      setChatroomBrowseMode: jest.fn(),
      setCurrentChatroom: jest.fn(),
      setCurrentChatroomMembers: jest.fn(),
      escapeHtml: (value) => value,
      renderChatroomList: jest.fn(),
      openPeerDetail: jest.fn(),
      emit,
      currentUserId: 'me',
      apiBase: '',
      text: (key) => uiText('en', key),
      formatDate: () => '',
      isUserOnline: () => false,
    });

    expect(mapRenderer).toHaveBeenCalledTimes(1);
    const options = mapRenderer.mock.calls[0]![0];
    // Nearby is my own people list, never a map destination (§3.7, OPEN-86 E3): only Place pins.
    expect(options.rooms.map((room) => room.id)).toEqual([PLACE_ID]);
    expect(options.rooms.find((room) => room.id === PLACE_ID)?.location).toEqual({
      latitude: 32.71,
      longitude: -117.17,
    });
    options.selectNearbyPoint?.({ latitude: 40.71, longitude: -74.0 });
    expect(emit).toHaveBeenCalledWith('travelNearbyAtPoint', { latitude: 40.71, longitude: -74.0 });
    expect(options).not.toHaveProperty('openTile');
    expect(options.rooms).toHaveLength(1);
    expect(options.nearbyPointAction).toBe('Join as traveler');
    expect(document.getElementById('chatroom-map-status')?.textContent).not.toContain('groups share');
    const status = document.getElementById('chatroom-map-status') as HTMLElement;
    expect(status.hidden).toBe(false);
    jest.advanceTimersByTime(MAP_HINT_VISIBLE_MS);
    expect(status.hidden).toBe(true);
    jest.useRealTimers();
  });
});
