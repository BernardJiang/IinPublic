/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { nearbyHeadcountText, renderChatroomList, updateChatroomMembers, type CustomChatroomRow } from '../../web/ui/chatrooms-view';
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
    <button id="nearby-meet-new-people-btn" data-testid="nearby-meet-new-people-action" style="display:none"></button>
    <button id="nearby-back-to-first-group-btn" data-testid="nearby-back-to-first-group-action" style="display:none"></button>
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
  it('shows Nearby people and custom rooms in one compact browser list', () => {
    render({
      activeRooms: ROOMS,
      nearbyMembers: [
        { userId: 'me', stageName: 'Me' },
        { userId: 'alice', stageName: 'Alice' },
        { userId: 'bob', stageName: 'Bob' },
      ],
    });

    expect(document.querySelector('[data-testid="room-list-total"]')).toBeNull();
    expect(document.querySelector('[data-testid="current-group-section"]')).toBeNull();
    expect(document.querySelector(`.chatroom-item[data-chatroom-id="${NEARBY_ID}"]`)).toBeNull();
    const rows = Array.from(document.querySelectorAll('[data-testid="room-list-row"]'));
    expect(rows.map((row) => row.querySelector('.chatroom-name')?.textContent?.trim())).toEqual(['Bean There Café', 'Echo Park']);
    expect(rows.every((row) => row.querySelector('.chatroom-icon')?.textContent === '🚪')).toBe(true);
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
    const browserSections = Array.from(document.querySelectorAll('[data-testid="nearby-browser-list"] > section'));
    expect(browserSections.map((section) => section.getAttribute('data-testid')))
      .toEqual(['nearby-people-section', 'rooms-near-you-section']);
    expect(rows.every((row) => row.querySelector('button') === null)).toBe(true);
    expect(document.querySelector('[data-testid="nearby-group-bar"]')).toBeNull();
    expect((document.querySelector('[data-testid="nearby-meet-new-people-action"]') as HTMLElement).style.display)
      .toBe('inline-flex');
    expect(document.body.textContent).not.toContain('People near you');
    expect(document.body.textContent).not.toContain('Loading rooms');
  });

  it('does not turn a map-selected Nearby audience into a visible room', () => {
    render({ travelModeActive: true });

    expect(document.querySelector(`.chatroom-item[data-chatroom-id="${NEARBY_ID}"]`)).toBeNull();
    expect(document.querySelector('[data-testid="nearby-people-section"]')).not.toBeNull();
  });

  it('puts Meet new people in the action bar and changes groups immediately', async () => {
    const emit = jest.fn();
    render({
      emit,
      nearbyMembers: [{ userId: 'alice', stageName: 'Alice' }, { userId: 'bob', stageName: 'Bob' }],
    });

    const action = document.querySelector('[data-testid="nearby-meet-new-people-action"]') as HTMLButtonElement;
    expect(action.style.display).toBe('inline-flex');
    expect(action.getAttribute('aria-label')).toBe('Meet new people');
    action.click();
    await Promise.resolve();
    expect(document.querySelector('[data-testid="nearby-meet-confirm"]')).toBeNull();
    expect(emit).toHaveBeenCalledWith('nearbyMeetNewPeople');
  });

  it('tapping a room enters it and tapping a person opens that person', () => {
    const emit = jest.fn();
    const openPeerDetail = jest.fn();
    render({ activeRooms: ROOMS, emit, openPeerDetail, nearbyMembers: [{ userId: 'alice', stageName: 'Alice' }] });
    document.body.insertAdjacentHTML('beforeend', '<div id="chatroom-members-list"></div><div id="current-chatroom-title"></div>');

    expect(document.querySelector(`.chatroom-item[data-chatroom-id="${NEARBY_ID}"]`)).toBeNull();

    (document.querySelector(`.chatroom-item[data-chatroom-id="${LA_PLACE_ID}"]`) as HTMLElement).click();
    expect(emit).toHaveBeenCalledWith('chatroomChanged', LA_PLACE_ID);
    expect(emit).not.toHaveBeenCalledWith('travelNearbyAtPoint', expect.anything());
    (document.querySelector('[data-testid="nearby-person-row"]') as HTMLElement).click();
    expect(openPeerDetail).toHaveBeenCalledWith('alice', 'Alice');
  });

  it('enters a room from the whole row with keyboard activation and renders no Enter control', () => {
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
  it('formats my list count and the broader online count for the AppBar', () => {
    const nearbyMembers = Array.from({ length: 12 }, (_, index) => ({ userId: `person-${index}`, stageName: `Person ${index}` }));
    render({ activeRooms: ROOMS, nearbyMembers, nearbyOnline: 12_345 });
    expect(document.querySelector(`.chatroom-item[data-chatroom-id="${NEARBY_ID}"]`)).toBeNull();
    expect(nearbyHeadcountText({ text: (key) => uiText('en', key), nearbyOnline: 12_345 }, 12))
      .toBe('12 nearby · 12,345 online');
    expect(document.querySelector('[data-testid="nearby-headcount"]')).toBeNull();
    expect(document.querySelector('[data-testid="room-list-total"]')).toBeNull();
  });

  it('omits the rooms section when no custom room exists', () => {
    render({
      customChatrooms: [],
      activeRooms: { rooms: [], totalOnline: 1, totalRooms: 0, hasMore: false },
      nearbyMembers: [{ userId: 'alice', stageName: 'Alice' }],
    });
    expect(document.querySelector('[data-testid="rooms-near-you-section"]')).toBeNull();
    expect(document.querySelector('[data-testid="room-list-header"]')).toBeNull();
    expect(document.querySelector('[data-testid="room-list-sort"]')).toBeNull();
    expect(document.querySelector('[data-testid="nearby-person-row"]')?.textContent).toContain('Alice');
  });

  it('says only "N nearby" until the hub reports who is online', () => {
    render({ chatroomMemberCounts: new Map([[NEARBY_ID, 0]]) });
    expect(nearbyHeadcountText({ text: (key) => uiText('en', key) }, 0)).toBe('0 nearby');
    expect(document.querySelector('[data-testid="nearby-headcount"]')).toBeNull();
  });

  it('keeps broadcast progress out of the file-browser list', () => {
    render({ nearbyBroadcastProgress: { sent: 120, total: 498 } });
    expect(document.querySelector('[data-testid="nearby-broadcast-progress"]')).toBeNull();
  });

  it('lists the people on my group without me, with an immediate AppBar page switch', async () => {
    document.body.innerHTML = `
      <button id="nearby-meet-new-people-btn" data-testid="nearby-meet-new-people-action" style="display:none"></button>
      <button id="nearby-back-to-first-group-btn" data-testid="nearby-back-to-first-group-action" style="display:none"></button>
      <div id="current-chatroom-status"></div><div id="chatroom-members-list"></div>`;
    const emit = jest.fn();
    const counts = new Map<string, number>();
    updateChatroomMembers({
      currentChatroom: NEARBY_ID,
      chatroomMemberCounts: counts,
      chatroomVisitCounts: new Map(),
      matchedUserIds: new Set(),
      customChatrooms: [],
      nearbyOnline: 7,
      nearbyCount: 6,
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
    expect(document.getElementById('current-chatroom-status')?.textContent).toBe('6 nearby · 7 online');
    expect(document.querySelectorAll('.chatroom-member-item')).toHaveLength(2);
    expect(document.querySelector('[data-testid="nearby-group-bar"]')).toBeNull();
    expect((document.querySelector('[data-testid="nearby-back-to-first-group-action"]') as HTMLElement).style.display).toBe('none');
    (document.querySelector('[data-testid="nearby-meet-new-people-action"]') as HTMLButtonElement).click();
    expect(document.querySelector('[data-testid="nearby-meet-confirm"]')).toBeNull();
    await Promise.resolve();
    expect(emit).toHaveBeenCalledWith('nearbyMeetNewPeople');
  });

  it('shows "Back to group 1" in the AppBar at the end of the groups', () => {
    document.body.innerHTML = `
      <button id="nearby-meet-new-people-btn" data-testid="nearby-meet-new-people-action" style="display:none"></button>
      <button id="nearby-back-to-first-group-btn" data-testid="nearby-back-to-first-group-action" style="display:none"></button>
      <div id="current-chatroom-status"></div><div id="chatroom-members-list"></div>`;
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
    expect(document.querySelector('[data-testid="nearby-group-bar"]')).toBeNull();
    expect((document.querySelector('[data-testid="nearby-meet-new-people-action"]') as HTMLElement).style.display).toBe('none');
    expect((document.querySelector('[data-testid="nearby-back-to-first-group-action"]') as HTMLElement).style.display).toBe('inline-flex');
    (document.querySelector('[data-testid="nearby-back-to-first-group-action"]') as HTMLButtonElement).click();
    expect(emit).toHaveBeenCalledWith('nearbyBackToFirstGroup');
  });

  it('uses the same AppBar paging action inside a Place', async () => {
    document.body.innerHTML = `
      <button id="nearby-meet-new-people-btn" data-testid="nearby-meet-new-people-action" style="display:none"></button>
      <button id="nearby-back-to-first-group-btn" data-testid="nearby-back-to-first-group-action" style="display:none"></button>
      <div id="current-chatroom-status"></div><div id="chatroom-members-list"></div>`;
    const emit = jest.fn();
    updateChatroomMembers({
      currentChatroom: PLACE_ID,
      chatroomMemberCounts: new Map(),
      chatroomVisitCounts: new Map(),
      matchedUserIds: new Set(),
      customChatrooms: [],
      nearbyGroup: { group: 1, exhausted: false },
      setCurrentChatroomMembers: jest.fn(),
      renderChatroomList: jest.fn(),
      escapeHtml: (value: string) => value,
      emit,
      text: (key: string) => uiText('en', key as never),
      isUserOnline: () => false,
      formatDate: () => '',
      currentUserId: 'me',
      apiBase: '',
    } as never, [
      { userId: 'me', stageName: 'Me' },
      { userId: 'ann', stageName: 'Ann' },
      { userId: 'bo', stageName: 'Bo' },
    ], 'me');

    expect(document.querySelector('[data-testid="nearby-group-bar"]')).toBeNull();
    (document.querySelector('[data-testid="nearby-meet-new-people-action"]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(document.querySelector('[data-testid="nearby-meet-confirm"]')).toBeNull();
    expect(emit).toHaveBeenCalledWith('nearbyMeetNewPeople');
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
