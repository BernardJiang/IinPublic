/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { renderChatroomList, type CustomChatroomRow } from '../../web/ui/chatrooms-view';
import { uiText } from '../../web/ui/ui-translations';
import type { ActiveRoomsView } from '../../shared/active-rooms';
import { NEARBY_V3_ROOM_ID } from '../../shared/nearby-rooms';

const NEARBY_ID = NEARBY_V3_ROOM_ID;
const PLACE_ID = 'place_32.71_-117.17_abcdefabcdef';

const LA_PLACE_ID = 'place_34.05_-118.24_abcdefabcdef';
const FULL_ID = 'place_36.17_-115.14_abcdefabcdef';
// The hub's room list holds Places only: Nearby is my own list, never a listed room (§3.7).
const ROOMS: ActiveRoomsView = {
  totalOnline: 49,
  totalRooms: 2,
  hasMore: false,
  rooms: [
    { roomId: PLACE_ID, kind: 'place', name: 'Bean There Café', memberCount: 46, latitude: 32.71, longitude: -117.17, distanceMeters: 1_200, bearingDegrees: 225 },
    { roomId: LA_PLACE_ID, kind: 'place', name: 'Echo Park', memberCount: 3, latitude: 34.05, longitude: -118.24, distanceMeters: 179_000, bearingDegrees: 315 },
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
  it('shows Nearby first, then every Place with people, with the Places total', () => {
    render({ activeRooms: ROOMS });

    expect(document.querySelector('[data-testid="room-list-total"]')?.textContent).toBe('49 online · 2 rooms');
    const current = document.querySelector('[data-testid="current-group-section"]');
    expect(current?.querySelector(`.chatroom-item[data-chatroom-id="${NEARBY_ID}"]`)).not.toBeNull();
    expect(current?.querySelector('.chatroom-icon')).toBeNull(); // no meaningless pin
    const rows = Array.from(document.querySelectorAll('[data-testid="room-list-row"]'));
    expect(rows.map((row) => row.querySelector('.chatroom-name')?.textContent?.trim())).toEqual(['Bean There Café', 'Echo Park']);
    expect(rows[0]?.textContent).toContain('46 / 498 people');
    expect(rows[0]?.querySelector('.chatroom-description')?.textContent).toMatch(/^Place · [\d.]+ (km|mi) SW$/);
    expect(rows.every((row) => row.getAttribute('data-room-kind') === 'place')).toBe(true);
    expect(document.querySelector('.chatroom-expand-icon')).toBeNull();
    expect(document.querySelector('[data-level]')).toBeNull();
    expect(document.querySelector('[data-testid="cohort-status"]')).toBeNull();
  });

  it('labels a map-selected Nearby audience as travel', () => {
    render({ travelModeActive: true });

    const current = document.querySelector('[data-testid="current-group-section"]');
    expect(current?.textContent).toContain('Traveler');
    expect(current?.textContent).toContain('Based on the map point you selected');
  });

  it('tapping Nearby or a Place enters it', () => {
    const emit = jest.fn();
    render({ activeRooms: ROOMS, emit });
    document.body.insertAdjacentHTML('beforeend', '<div id="chatroom-members-list"></div><div id="current-chatroom-title"></div>');

    (document.querySelector(`.chatroom-item[data-chatroom-id="${NEARBY_ID}"]`) as HTMLElement).click();
    expect(emit).toHaveBeenCalledWith('chatroomChanged', NEARBY_ID);

    (document.querySelector(`.chatroom-item[data-chatroom-id="${LA_PLACE_ID}"]`) as HTMLElement).click();
    expect(emit).toHaveBeenCalledWith('chatroomChanged', LA_PLACE_ID);
    expect(emit).not.toHaveBeenCalledWith('travelNearbyAtPoint', expect.anything());
  });

  it('shows a full Place greyed out and does not enter it', () => {
    const emit = jest.fn();
    render({ activeRooms: { ...ROOMS, rooms: [...ROOMS.rooms, { roomId: FULL_ID, kind: 'place', name: 'Arena', memberCount: 498, latitude: 36.17, longitude: -115.14, distanceMeters: 400_000, bearingDegrees: 45 }] }, emit });
    const full = document.querySelector(`.chatroom-item[data-chatroom-id="${FULL_ID}"]`) as HTMLElement;
    expect(full.getAttribute('aria-disabled')).toBe('true');
    expect(full.textContent).toContain('Full');
    full.click();
    expect(emit).not.toHaveBeenCalled();
  });

  it('shows the Place as the current group while inside it', () => {
    render({ currentChatroom: PLACE_ID });

    expect(document.querySelector('[data-testid="current-group-section"]')?.textContent).toContain('Bean There Café');
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
