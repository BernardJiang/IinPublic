/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { renderChatroomList, type CustomChatroomRow } from '../../web/ui/chatrooms-view';
import { uiText } from '../../web/ui/ui-translations';
import { createLocalCohortTraversalViewModel } from '../../web/ui/cohort-traversal-view-model';
import type { ActiveRoomsView } from '../../shared/active-rooms';

const NEARBY_ID = 'nearby_v1_e1_p1000_g0_0123456789abcdef01234567';
const PLACE_ID = 'place_32.71_-117.17_abcdefabcdef';

const LA_ID = 'nearby_v2_e1_aaaaaaaaaaaaaaaaaaaaaaaa';
const FULL_ID = 'nearby_v2_e1_bbbbbbbbbbbbbbbbbbbbbbbb';
const ROOMS: ActiveRoomsView = {
  totalOnline: 351,
  totalRooms: 3,
  hasMore: false,
  rooms: [
    { roomId: NEARBY_ID, kind: 'nearby', memberCount: 302, latitude: 32.72, longitude: -117.16, distanceMeters: 0, bearingDegrees: 0 },
    { roomId: PLACE_ID, kind: 'place', name: 'Bean There Café', memberCount: 46, latitude: 32.71, longitude: -117.17, distanceMeters: 1_200, bearingDegrees: 225 },
    { roomId: LA_ID, kind: 'nearby', memberCount: 3, latitude: 34.05, longitude: -118.24, distanceMeters: 179_000, bearingDegrees: 315 },
  ],
};

function render(overrides: Record<string, unknown> = {}): void {
  document.body.innerHTML = `
    <button id="chatroom-list-view-btn"></button>
    <button id="chatroom-map-view-btn"></button>
    <button id="return-home-btn">Return Home</button>
    <div id="chatroom-list-container">
      <div id="chatroom-map-status"></div>
      <div id="chatroom-list"></div>
      <div id="chatroom-map"></div>
    </div>`;
  const places: CustomChatroomRow[] = [{
    id: PLACE_ID,
    name: 'Bean There Café',
    type: 'business',
    description: 'Coffee and conversation',
    location: { latitude: 32.71, longitude: -117.17 },
  }];
  renderChatroomList({
    currentChatroom: NEARBY_ID,
    chatroomMemberCounts: new Map([[NEARBY_ID, 342], [PLACE_ID, 46]]),
    chatroomVisitCounts: new Map([[PLACE_ID, { visitCount: 12, uniqueVisitorCount: 8 }]]),
    chatroomBrowseMode: 'list',
    expandedChatrooms: new Set(),
    matchedUserIds: new Set(),
    customChatrooms: places,
    travelModeActive: false,
    cohortTraversal: createLocalCohortTraversalViewModel(),
    setChatroomBrowseMode: jest.fn(),
    setCurrentChatroom: jest.fn(),
    setCurrentChatroomMembers: jest.fn(),
    escapeHtml: (value) => value,
    renderChatroomList: jest.fn(),
    openPeerDetail: jest.fn(),
    emit: jest.fn(),
    currentUserId: 'me',
    apiBase: '',
    text: (key) => uiText('en', key),
    formatDate: () => '',
    isUserOnline: () => false,
    ...overrides,
  });
}

describe('flat Nearby and Places list', () => {
  it('lists your room first, then every other room with people, with the online total', () => {
    render({ activeRooms: ROOMS });

    expect(document.querySelector('[data-testid="room-list-total"]')?.textContent).toBe('351 online · 3 rooms');
    expect(document.querySelector('[data-testid="current-group-section"]')?.textContent).toContain('Nearby');
    const rows = Array.from(document.querySelectorAll('[data-testid="room-list-row"]'));
    expect(rows.map((row) => row.querySelector('.chatroom-name')?.textContent?.trim())).toEqual([
      'Bean There Café',
      'Around Los Angeles',
    ]);
    expect(rows[0]?.textContent).toContain('46 / 498');
    expect(rows[1]?.textContent).toMatch(/3 \/ 498 · \d+ (km|mi) NW/);
    expect(document.querySelector('.chatroom-expand-icon')).toBeNull();
    expect(document.querySelector('[data-level]')).toBeNull();
    expect(document.querySelector('[data-testid="cohort-controls"]')).toBeNull();
    expect(document.body.textContent).not.toContain(NEARBY_ID);
  });

  it('labels a map-selected Nearby audience as travel without exposing its room id', () => {
    render({ travelModeActive: true });

    const current = document.querySelector('[data-testid="current-group-section"]');
    expect(current?.textContent).toContain('Traveler');
    expect(current?.textContent).toContain('Based on the map point you selected');
    expect(current?.textContent).not.toContain(NEARBY_ID);
  });

  it('tapping a room enters it: your own and Places show members; another Nearby group travels there', () => {
    const emit = jest.fn();
    render({ activeRooms: ROOMS, emit });
    document.body.insertAdjacentHTML('beforeend', '<div id="chatroom-members-list"></div><div id="current-chatroom-title"></div>');

    (document.querySelector(`.chatroom-item[data-chatroom-id="${NEARBY_ID}"]`) as HTMLElement).click();
    expect(emit).toHaveBeenCalledWith('chatroomChanged', NEARBY_ID);

    (document.querySelector(`.chatroom-item[data-chatroom-id="${PLACE_ID}"]`) as HTMLElement).click();
    expect(emit).toHaveBeenCalledWith('chatroomChanged', PLACE_ID);

    (document.querySelector(`.chatroom-item[data-chatroom-id="${LA_ID}"]`) as HTMLElement).click();
    expect(emit).toHaveBeenCalledWith('travelNearbyAtPoint', { latitude: 34.05, longitude: -118.24 });
    expect(document.getElementById('current-chatroom-title')?.textContent).toBe('Around Los Angeles');
  });

  it('shows a full room greyed out and does not enter it', () => {
    const emit = jest.fn();
    render({ activeRooms: { ...ROOMS, rooms: [...ROOMS.rooms, { roomId: FULL_ID, kind: 'nearby', memberCount: 498, latitude: 36.17, longitude: -115.14, distanceMeters: 400_000, bearingDegrees: 45 }] }, emit });
    const full = document.querySelector(`.chatroom-item[data-chatroom-id="${FULL_ID}"]`) as HTMLElement;
    expect(full.getAttribute('aria-disabled')).toBe('true');
    expect(full.textContent).toContain('Full');
    full.click();
    expect(emit).not.toHaveBeenCalled();
  });

  it('does not offer Nearby cohort switching while the current group is a Place', () => {
    render({ currentChatroom: PLACE_ID });

    expect(document.querySelector('[data-testid="current-group-section"]')?.textContent).toContain('Bean There Café');
    expect(document.querySelector('[data-testid="cohort-status"]')).toBeNull();
  });
});

describe('room list sort', () => {
  it('re-queries the hub when the sort changes and when more rooms are requested', () => {
    const emit = jest.fn();
    render({ activeRooms: { ...ROOMS, hasMore: true }, emit });
    const select = document.getElementById('room-list-sort') as HTMLSelectElement;
    expect(select.value).toBe('nearest');
    select.value = 'busiest';
    select.dispatchEvent(new Event('change'));
    expect(localStorage.getItem('iinpublic_room_list_sort')).toBe('busiest');
    expect(emit).toHaveBeenCalledWith('activeRoomsQueryChanged', {});
    (document.getElementById('room-list-more') as HTMLButtonElement).click();
    expect(emit).toHaveBeenCalledWith('activeRoomsQueryChanged', { showMore: true });
    localStorage.removeItem('iinpublic_room_list_sort');
  });
});
