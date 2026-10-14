/** @jest-environment jsdom */

import { renderChatroomList } from '../../web/ui/chatrooms-view';
import { renderChatroomMap } from '../../web/ui/chatroom-map-view';
import { uiText } from '../../web/ui/ui-translations';
import { createLocalCohortTraversalViewModel } from '../../web/ui/cohort-traversal-view-model';
import { MAP_HINT_VISIBLE_MS } from '../../web/ui/transient-map-hint';

jest.mock('../../web/ui/chatroom-map-view', () => ({ renderChatroomMap: jest.fn() }));

const mapRenderer = renderChatroomMap as jest.MockedFunction<typeof renderChatroomMap>;
const NEARBY_ID = 'nearby_v1_e1_p1000_g0_0123456789abcdef01234567';
const PLACE_ID = 'place_32.71_-117.17_abcdefabcdef';

describe('flat chatroom map', () => {
  it('renders only the current group plus Place pins and emits deliberate point travel', () => {
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
      nearbyMapArea: {
        north: 32.72,
        south: 32.70,
        east: -117.16,
        west: -117.18,
        approximateDiameterMeters: 1_000,
      },
      travelModeActive: false,
      cohortTraversal: createLocalCohortTraversalViewModel({ groupCount: 6 }),
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
    expect(options.rooms.map((room) => room.id)).toEqual([NEARBY_ID, PLACE_ID]);
    expect(options.rooms.find((room) => room.id === PLACE_ID)?.location).toEqual({
      latitude: 32.71,
      longitude: -117.17,
    });
    options.selectNearbyPoint?.({ latitude: 40.71, longitude: -74.0 });
    expect(emit).toHaveBeenCalledWith('travelNearbyAtPoint', { latitude: 40.71, longitude: -74.0 });
    expect(options).not.toHaveProperty('openTile');
    expect(options.nearbyMapArea).toEqual({
      north: 32.72,
      south: 32.70,
      east: -117.16,
      west: -117.18,
      approximateDiameterMeters: 1_000,
    });
    expect(options.rooms).toHaveLength(2);
    expect(options.nearbyPointAction).toBe('Join as traveler');
    expect(document.getElementById('chatroom-map-status')?.textContent).toContain(
      '6 groups share the same shaded area.',
    );
    const status = document.getElementById('chatroom-map-status') as HTMLElement;
    expect(status.hidden).toBe(false);
    jest.advanceTimersByTime(MAP_HINT_VISIBLE_MS);
    expect(status.hidden).toBe(true);
    jest.useRealTimers();
  });
});
