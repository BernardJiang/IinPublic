/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { renderChatroomList, updateChatroomMembers, type CustomChatroomRow } from '../../web/ui/chatrooms-view';
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
  it('shows Nearby people and chatroom folders in one compact browser list', () => {
    render({
      activeRooms: ROOMS,
      nearbyMembers: [
        { userId: 'me', stageName: 'Me' },
        { userId: 'alice', stageName: 'Alice' },
        { userId: 'bob', stageName: 'Bob' },
      ],
    });

    expect(document.querySelector('[data-testid="room-list-total"]')?.textContent).toBe('49 online · 2 rooms');
    expect(document.querySelector('[data-testid="current-group-section"]')).toBeNull();
    expect(document.querySelector(`.chatroom-item[data-chatroom-id="${NEARBY_ID}"] .chatroom-icon`)?.textContent).toBe('📁');
    const rows = Array.from(document.querySelectorAll('[data-testid="room-list-row"]'));
    expect(rows.map((row) => row.querySelector('.chatroom-name')?.textContent?.trim())).toEqual(['Bean There Café', 'Echo Park']);
    expect(rows.every((row) => row.querySelector('.chatroom-icon')?.textContent === '📁')).toBe(true);
    expect(rows[0]?.textContent).toContain('46 people');
    expect(rows[0]?.querySelector('.chatroom-description')?.textContent).toMatch(/^Place · [\d.]+ (km|mi) SW$/);
    expect(rows.every((row) => row.getAttribute('data-room-kind') === 'place')).toBe(true);
    expect(document.querySelector('.chatroom-arrow')).toBeNull();
    expect(document.querySelector('.chatroom-expand-icon')).toBeNull();
    expect(document.querySelector('[data-level]')).toBeNull();
    expect(document.querySelector('[data-testid="cohort-status"]')).toBeNull();
    expect(Array.from(document.querySelectorAll('[data-testid="nearby-person-row"]'), (row) => row.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Alice'), expect.stringContaining('Bob')]),
    );
    expect(document.querySelector('[data-testid="nearby-browser-list"] button')).toBeNull();
  });

  it('labels a map-selected Nearby audience as travel', () => {
    render({ travelModeActive: true });

    const current = document.querySelector('.chatroom-item.current-room');
    expect(current?.textContent).toContain('Traveler');
    expect(current?.textContent).toContain('Based on the map point you selected');
  });

  it('tapping a folder enters it and tapping a person opens that person', () => {
    const emit = jest.fn();
    const openPeerDetail = jest.fn();
    render({ activeRooms: ROOMS, emit, openPeerDetail, nearbyMembers: [{ userId: 'alice', stageName: 'Alice' }] });
    document.body.insertAdjacentHTML('beforeend', '<div id="chatroom-members-list"></div><div id="current-chatroom-title"></div>');

    (document.querySelector(`.chatroom-item[data-chatroom-id="${NEARBY_ID}"]`) as HTMLElement).click();
    expect(emit).toHaveBeenCalledWith('chatroomChanged', NEARBY_ID);

    (document.querySelector(`.chatroom-item[data-chatroom-id="${LA_PLACE_ID}"]`) as HTMLElement).click();
    expect(emit).toHaveBeenCalledWith('chatroomChanged', LA_PLACE_ID);
    expect(emit).not.toHaveBeenCalledWith('travelNearbyAtPoint', expect.anything());
    (document.querySelector('[data-testid="nearby-person-row"]') as HTMLElement).click();
    expect(openPeerDetail).toHaveBeenCalledWith('alice', 'Alice');
  });

  it('enters a folder from the whole row with keyboard activation and renders no Enter control', () => {
    const emit = jest.fn();
    render({ activeRooms: ROOMS, emit });
    document.body.insertAdjacentHTML('beforeend', '<div id="chatroom-members-list"></div><div id="current-chatroom-title"></div>');
    const row = document.querySelector(`[data-testid="room-list-row"][data-chatroom-id="${LA_PLACE_ID}"]`) as HTMLElement;

    expect(row.getAttribute('role')).toBe('button');
    expect(row.getAttribute('tabindex')).toBe('0');
    expect(row.querySelector('button')).toBeNull();
    expect(row.textContent).not.toContain('Enter');

    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(emit).toHaveBeenCalledWith('chatroomChanged', LA_PLACE_ID);
  });

  it('never shows a Place as full: a busy one is entered like any other (§3.7 "Places in v3")', () => {
    const emit = jest.fn();
    render({ activeRooms: { ...ROOMS, rooms: [...ROOMS.rooms, { roomId: FULL_ID, kind: 'place', name: 'Arena', memberCount: 2_000, latitude: 36.17, longitude: -115.14, distanceMeters: 400_000, bearingDegrees: 45 }] }, emit });
    const busy = document.querySelector(`.chatroom-item[data-chatroom-id="${FULL_ID}"]`) as HTMLElement;
    expect(busy.getAttribute('aria-disabled')).toBeNull();
    expect(busy.textContent).toContain('2000 people');
    expect(busy.textContent).not.toContain('Full');
    document.body.insertAdjacentHTML('beforeend', '<div id="chatroom-members-list"></div><div id="current-chatroom-title"></div>');
    busy.click();
    expect(emit).toHaveBeenCalledWith('chatroomChanged', FULL_ID);
  });

  it('shows the Place as the current group while inside it', () => {
    render({ currentChatroom: PLACE_ID });

    expect(document.querySelector('.chatroom-item.current-room')?.textContent).toContain('Bean There Café');
  });

  it('does not put match-collection controls or status cards in the room browser', () => {
    render({ nearbyBroadcastProgress: { sent: 3, total: 7 } });
    expect(document.querySelector('[data-testid="match-collection-card"]')).toBeNull();
    expect(document.querySelector('[data-testid="match-collection-toggle"]')).toBeNull();
    expect(document.querySelector('[data-testid="nearby-broadcast-progress"]')).toBeNull();
  });
});

describe('Nearby screens (§3.7 "Map, list and headcounts")', () => {
  it('shows Nearby as a folder and counts my list, then everyone online', () => {
    render({ activeRooms: ROOMS, chatroomMemberCounts: new Map([[NEARBY_ID, 12], [PLACE_ID, 46]]), nearbyOnline: 12_345 });
    const current = document.querySelector('.chatroom-item.current-room');
    expect(current?.querySelector('.chatroom-name')?.textContent).toContain('Nearby');
    expect(current?.querySelector('[data-testid="nearby-headcount"]')?.textContent).toBe('12 near you · 12,345 online');
    expect(document.querySelector('[data-testid="room-list-total"]')?.textContent).toBe('12,345 online · 2 rooms');
  });

  it('says only "N near you" until the hub reports who is online', () => {
    render({ chatroomMemberCounts: new Map([[NEARBY_ID, 0]]) });
    expect(document.querySelector('[data-testid="nearby-headcount"]')?.textContent).toBe('0 near you');
  });

  it('keeps broadcast progress out of the file-browser list', () => {
    render({ nearbyBroadcastProgress: { sent: 120, total: 498 } });
    expect(document.querySelector('[data-testid="nearby-broadcast-progress"]')).toBeNull();
  });

  it('lists the people on my group without me, with the group bar and its confirmed switch', async () => {
    document.body.innerHTML = '<div id="current-chatroom-status"></div><div id="chatroom-members-list"></div>';
    const emit = jest.fn();
    const counts = new Map<string, number>();
    updateChatroomMembers({
      currentChatroom: NEARBY_ID,
      chatroomMemberCounts: counts,
      chatroomVisitCounts: new Map(),
      matchedUserIds: new Set(),
      customChatrooms: [],
      nearbyOnline: 7,
      setCurrentChatroomMembers: jest.fn(),
      renderChatroomList: jest.fn(),
      escapeHtml: (value: string) => value,
      emit,
      text: (key: string) => uiText('en', key as never),
      isUserOnline: () => false,
      formatDate: () => '',
      currentUserId: 'me',
      apiBase: '',
    } as never, [{ userId: 'me', stageName: 'Me' }, { userId: 'ann', stageName: 'Ann' }, { userId: 'bo', stageName: 'Bo' }], 'me');
    expect(counts.get(NEARBY_ID)).toBe(2);
    expect(document.getElementById('current-chatroom-status')?.textContent).toBe('2 near you · 7 online');
    expect(document.querySelectorAll('.chatroom-member-item')).toHaveLength(2);
    // The group bar (§3.7 "Meeting new people in groups"): group 1, and a confirmed switch.
    expect(document.querySelector('[data-testid="nearby-group-title"]')?.textContent).toBe('Group 1 · the people nearest you');
    expect(document.querySelector('[data-testid="nearby-back-to-first-group"]')).toBeNull();
    (document.querySelector('[data-testid="nearby-meet-new-people"]') as HTMLButtonElement).click();
    expect(document.querySelector('[data-testid="nearby-meet-confirm"]')?.textContent).toContain('Swap these 2 people for the next people near you.');
    (document.querySelector('[data-testid="nearby-meet-cancel"]') as HTMLButtonElement).click();
    expect(document.querySelector('[data-testid="nearby-meet-confirm"]')).toBeNull();
    expect(emit).not.toHaveBeenCalledWith('nearbyMeetNewPeople');
    (document.querySelector('[data-testid="nearby-meet-new-people"]') as HTMLButtonElement).click();
    (document.querySelector('[data-testid="nearby-meet-confirm-action"]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(emit).toHaveBeenCalledWith('nearbyMeetNewPeople');
  });

  it('shows the group, "Back to group 1" and the end of the groups', () => {
    const emit = jest.fn();
    const deps = {
      currentChatroom: NEARBY_ID,
      chatroomMemberCounts: new Map(),
      chatroomVisitCounts: new Map(),
      matchedUserIds: new Set(),
      customChatrooms: [],
      nearbyGroup: { group: 3, exhausted: true },
      setCurrentChatroomMembers: jest.fn(),
      renderChatroomList: jest.fn(),
      escapeHtml: (value: string) => value,
      emit,
      text: (key: string) => uiText('en', key as never),
      isUserOnline: () => false,
      formatDate: () => '',
      currentUserId: 'me',
      apiBase: '',
    } as never;
    updateChatroomMembers(deps, [{ userId: 'me', stageName: 'Me' }], 'me');
    expect(document.querySelector('[data-testid="nearby-group-title"]')?.textContent).toBe('Group 3 · the next people near you');
    expect(document.querySelector('[data-testid="nearby-group-note"]')?.textContent).toBe("You've met everyone here for now.");
    expect(document.querySelector('[data-testid="nearby-meet-new-people"]')).toBeNull();
    (document.querySelector('[data-testid="nearby-back-to-first-group"]') as HTMLButtonElement).click();
    expect(emit).toHaveBeenCalledWith('nearbyBackToFirstGroup');
  });

  it('preserves the v3 roster order inside the opened room', () => {
    document.body.innerHTML = '<div id="current-chatroom-status"></div><div id="chatroom-members-list"></div>';
    const deps = {
      currentChatroom: NEARBY_ID,
      chatroomMemberCounts: new Map(),
      chatroomVisitCounts: new Map(),
      matchedUserIds: new Set(),
      customChatrooms: [],
      setCurrentChatroomMembers: jest.fn(),
      renderChatroomList: jest.fn(),
      escapeHtml: (value: string) => value,
      emit: jest.fn(),
      text: (key: string) => uiText('en', key as never),
      isUserOnline: () => false,
      formatDate: () => '',
      currentUserId: 'me',
      apiBase: '',
    } as never;
    updateChatroomMembers(deps, [
      { userId: 'me', stageName: 'Me' },
      { userId: 'farther', stageName: 'First by v3', joinedAt: '2020-01-01T00:00:00.000Z' },
      { userId: 'newer', stageName: 'Second by v3', joinedAt: '2030-01-01T00:00:00.000Z' },
    ], 'me');

    expect(Array.from(document.querySelectorAll('.chatroom-member-name'), (row) => row.textContent?.trim()))
      .toEqual(['First by v3', 'Second by v3']);
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
