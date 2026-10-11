/** @jest-environment jsdom */

import { renderChatroomList, type CustomChatroomRow } from '../../web/ui/chatrooms-view';
import { uiText } from '../../web/ui/ui-translations';

const NEARBY_ID = 'nearby_v1_e1_p1000_g0_0123456789abcdef01234567';
const PLACE_ID = 'place_32.71_-117.17_abcdefabcdef';

function render(overrides: Record<string, unknown> = {}): void {
  document.body.innerHTML = `
    <button id="chatroom-list-view-btn"></button>
    <button id="chatroom-map-view-btn"></button>
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
  it('shows one current Nearby group and flat Place destinations without hierarchy controls', () => {
    render();

    expect(document.querySelector('[data-testid="current-group-section"]')?.textContent).toContain('Your current group');
    expect(document.querySelector('[data-testid="current-group-section"]')?.textContent).toContain('Nearby');
    expect(document.querySelector('[data-testid="current-group-section"]')?.textContent).toContain('342 people · up to 498');
    expect(document.querySelector('[data-testid="places-section"]')?.textContent).toContain('Bean There Café');
    expect(document.querySelector('[data-testid="places-section"]')?.textContent).toContain('46 people · up to 498');
    expect(document.querySelector('.chatroom-expand-icon')).toBeNull();
    expect(document.querySelector('[data-level]')).toBeNull();
  });

  it('labels a map-selected Nearby audience as travel without exposing its room id', () => {
    render({ travelModeActive: true });

    const current = document.querySelector('[data-testid="current-group-section"]');
    expect(current?.textContent).toContain('Traveler');
    expect(current?.textContent).toContain('Based on the map point you selected');
    expect(current?.textContent).not.toContain(NEARBY_ID);
  });
});
