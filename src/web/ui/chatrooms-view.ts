import { confirmMeetNewPeople } from './nearby-group-bar';
import { getEncounterLocation } from '../services/encounter-location';
import type { ActiveRoomSort, ActiveRoomsView } from '../../shared/active-rooms';
import { emptyPlaceRows, renderRoomListHeader, renderRoomListRow, roomListRows, type RoomListRow } from './room-list-view';
import { getRoomListSort, setRoomListSort } from '../services/active-rooms-client';
import { getActiveChatroomHierarchy, getFlatChatroomList, type FlatChatroomNode } from '../../shared/chatroom-hierarchy';
import type { PeerRelationshipStats } from '../../shared/peer-summary-types';
import { TECHSUPPORT_ROOT_USER_ID } from '../../shared/techsupport';
import { avatarInnerHtml } from './profile-avatar';
import type { UiTranslationKey } from './ui-translations';
import { readLocalTalkExchanges } from '../services/local-peer-derivation';
import { getChatroomMapLocation } from '../../shared/chatroom-map-locations';
import { getLocationChatroomPath } from '../../shared/location-to-chatroom';
import { isPlaceRoomId } from '../../shared/place-rooms';
import { CONTACTS_ONLY_SCOPE_ID, isNearbyRoomId, isPersonalListScope } from '../../shared/nearby-rooms';
import { getL1TileInfo, parseTileId, tileBounds, tileCenter, TILE_BOTTOM_LAYER } from '../../shared/room-tiles';
import type { ChatroomMapLocation } from '../../shared/chatroom-map-locations';
import { renderChatroomMap, type ChatroomMapRoom, type MapUserDots, type RoomMemberCardSource } from './chatroom-map-view';
import { hideTransientMapHint, showTransientMapHint } from './transient-map-hint';

type ChatroomMember = {
  userId: string;
  stageName: string;
  joinedAt?: string | Date;
  isTraveler?: boolean;
};

export type CustomChatroomRow = {
  id: string;
  name: string;
  type: string;
  description?: string;
  createdBy?: string;
  createdAt?: string | Date;
  businessInfo?: { headline?: string };
  /** Public room-level coordinate; never a member/user coordinate. */
  location?: ChatroomMapLocation;
};

type ChatroomsViewDeps = {
  currentChatroom: string;
  chatroomMemberCounts: Map<string, number>;
  chatroomVisitCounts: Map<string, { visitCount: number; uniqueVisitorCount: number }>;
  chatroomBrowseMode: 'list' | 'map';
  expandedChatrooms: Set<string>;
  matchedUserIds: Set<string>;
  customChatrooms: ReadonlyArray<CustomChatroomRow>;
  /** User dots on the map (★ me, green my Nearby list) and the crowd heat layer. */
  mapUserDots?: MapUserDots;
  /** Tap a green dot: brief profile card with Message (DM) and Profile. */
  roomMemberCard?: RoomMemberCardSource;
  /** The room list: every Place with ≥ 1 person, nearest first (shared/active-rooms.ts). */
  activeRooms?: ActiveRoomsView;
  /** The hub's count of everyone online in Nearby (§3.7 headcounts), once known. */
  nearbyOnline?: number;
  /** The latest Nearby broadcast: delivered so far, of the people on my list then. */
  nearbyBroadcastProgress?: { sent: number; total: number };
  /** Nearby v3 is a personal list. Show its people directly above the custom-room rows. */
  nearbyMembers?: ReadonlyArray<ChatroomMember>;
  /** The group of my order I am meeting here (§3.7 "Meeting new people in groups"). */
  nearbyGroup?: { group: number; exhausted: boolean };
  travelModeActive: boolean;
  setChatroomBrowseMode: (mode: 'list' | 'map') => void;
  setCurrentChatroom: (chatroomId: string) => void;
  setCurrentChatroomMembers: (members: ChatroomMember[]) => void;
  escapeHtml: (text: string) => string;
  renderChatroomList: () => void;
  openPeerDetail: (userId: string, stageName: string) => void;
  emit: (eventName: string, payload?: unknown) => void;
  currentUserId: string;
  apiBase: string;
  text: (key: UiTranslationKey) => string;
  formatDate: (date: Date) => string;
  /** Live peer presence is display-only and never changes room headcount. */
  isUserOnline: (userId: string) => boolean;
  /** A peer's profile photo already in the session cache (sync, never fetches), or null. */
  getCachedHeadshot?: (userId: string) => string | null;
  /** Fetch (or refresh) a peer's profile photo; non-blocking, called after the roster renders. */
  resolvePeerHeadshot?: (userId: string) => Promise<string | null>;
  /** Reflows action buttons after Nearby paging controls appear or disappear. */
  syncAppBarOverflow?: () => void;
  /**
   * Fired every time showChatroomDetail actually opens a room's detail panel — both the Tree
   * row click and the Map marker click (via the openChatroom callback below) go through this
   * one function, so this is the single place that needs to notify the caller, regardless of
   * which UI triggered it. Lets ui-manager.ts track which room's detail view is showing so it
   * can restore it after the user leaves and returns to the Chatrooms tab, instead of always
   * resetting to the room list.
   */
  onChatroomDetailOpened?: (chatroomId: string) => void;
};

export function syncStatusBroadcastButtonVisibility(currentChatroom: string): void {
  const button = document.getElementById('broadcast-talk-btn') as HTMLButtonElement | null;
  if (!button) return;
  button.disabled = !currentChatroom;
}

export function markChatroomMemberMatched(
  userId: string,
  matchedUserIds: Set<string>,
  matchedText: string,
): void {
  matchedUserIds.add(userId);
  const item = document.getElementById('chatroom-members-list')
    ?.querySelector(`.chatroom-member-item[data-user-id="${userId}"]`);
  if (!item) return;
  item.classList.add('member-matched');
  (item as HTMLElement).dataset.matched = 'true';
  const status = item.querySelector('.chatroom-member-status');
  if (status) status.textContent = matchedText;
}

export function flashChatroomMemberForNewTalk(authorId: string): void {
  const item = document.getElementById('chatroom-members-list')
    ?.querySelector(`.chatroom-member-item[data-user-id="${authorId}"]`);
  if (!item) return;
  item.classList.remove('flash-new-talk');
  void (item as HTMLElement).offsetWidth;
  item.classList.add('flash-new-talk');
  setTimeout(() => item.classList.remove('flash-new-talk'), 1000);
}

function customRoomIcon(type: string): string {
  return type === 'business' ? '🏪' : '💬';
}

const ROOM_ICON = '🚪';

/** "12 near you · 345 online": my list, then the hub's count of everyone online (§3.7). */
export function nearbyHeadcountText(deps: Pick<ChatroomsViewDeps, 'text' | 'nearbyOnline'>, count: number): string {
  return deps.nearbyOnline !== undefined
    ? deps.text('nearbyCountOnline').replace('{count}', String(count)).replace('{online}', deps.nearbyOnline.toLocaleString('en-US'))
    : deps.text('nearbyCountNearYou').replace('{count}', String(count));
}

function formatMetrics(
  deps: ChatroomsViewDeps,
  memberCount: number,
  visits: { visitCount: number; uniqueVisitorCount: number },
): string {
  const formatCount = (count: number, singular: UiTranslationKey, plural: UiTranslationKey): string =>
    deps.text(count === 1 ? singular : plural).replace('{count}', String(count));

  return deps.text('chatroomMetrics')
    .replace('{members}', formatCount(memberCount, 'chatroomMemberOne', 'chatroomMembers'))
    .replace('{visits}', formatCount(visits.visitCount, 'chatroomVisitOne', 'chatroomVisits'))
    .replace('{unique}', formatCount(visits.uniqueVisitorCount, 'chatroomUniqueOne', 'chatroomUniqueVisitors'));
}

function renderCustomRoomMetadata(deps: ChatroomsViewDeps, custom: CustomChatroomRow | undefined): void {
  const container = document.getElementById('chatroom-metadata');
  if (!container) return;
  if (!custom) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  const memberCount = deps.chatroomMemberCounts.get(custom.id) || 0;
  const visits = deps.chatroomVisitCounts.get(custom.id) || { visitCount: 0, uniqueVisitorCount: 0 };
  const createdAt = custom.createdAt ? new Date(custom.createdAt) : null;
  const createdLabel = createdAt && !Number.isNaN(createdAt.getTime())
    ? deps.formatDate(createdAt)
    : deps.text('unavailable');
  const value = (text: string | number): string => deps.escapeHtml(String(text));
  const row = (label: UiTranslationKey, text: string | number): string => `
    <div class="chatroom-metadata-row">
      <span>${value(deps.text(label))}</span>
      <strong>${value(text)}</strong>
    </div>`;

  container.style.display = 'block';
  container.innerHTML = `
    <div class="chatroom-metadata-title">${value(deps.text('chatroomDetails'))}</div>
    ${row('chatroomType', deps.text(custom.type === 'business' ? 'chatroomTypeBusiness' : 'chatroomTypeCommunity'))}
    ${row('chatroomDescription', custom.description || deps.text('unavailable'))}
    ${custom.type === 'business' ? row('chatroomBusinessHeadlineLabel', custom.businessInfo?.headline || deps.text('unavailable')) : ''}
    ${row('chatroomCreatedDate', createdLabel)}
    ${row('chatroomActiveMembers', memberCount)}
    ${row('chatroomLifetimeVisits', visits.visitCount)}
    ${row('chatroomUniqueVisitorsLabel', visits.uniqueVisitorCount)}
  `;
}

/**
 * Titles for tiles below L1, by the named city nearest the tile's centre that lies inside it:
 * L2 "🗺️ Large region around Los Angeles", L3 "🗺️ Region around San Diego", L4 "📍 Around San
 * Diego"; otherwise the centre's coordinates. City names only — never a state or country.
 */
function deepTileTitle(id: string): string | null {
  const ref = parseTileId(id);
  if (!ref || ref.layer < 2) return null;
  const bounds = tileBounds(ref);
  const centre = tileCenter(ref);
  const names = new Map(getFlatChatroomList().filter((node) => !node.hasChildren).map((node) => [node.id, node.name] as const));
  let best: { name: string; distance: number } | null = null;
  for (const [cityId, name] of names) {
    const at = getChatroomMapLocation(cityId);
    if (!at || at.latitude < bounds.south || at.latitude >= bounds.north || at.longitude < bounds.west || at.longitude >= bounds.east) continue;
    const distance = (at.latitude - centre.latitude) ** 2 + (at.longitude - centre.longitude) ** 2;
    if (!best || distance < best.distance) best = { name, distance };
  }
  const coords = `${Math.abs(centre.latitude).toFixed(1)}°${centre.latitude >= 0 ? 'N' : 'S'} ${Math.abs(centre.longitude).toFixed(1)}°${centre.longitude >= 0 ? 'E' : 'W'}`;
  if (ref.layer === TILE_BOTTOM_LAYER) return best ? `📍 Around ${best.name}` : `📍 Area ${coords}`;
  const kind = ref.layer === 2 ? 'Large region' : 'Region';
  return best ? `🗺️ ${kind} around ${best.name}` : `🗺️ ${kind} ${coords}`;
}

/** Split a resolved title ("📍 Near San Diego") into its leading icon and the name. */
function splitTitleIcon(title: string): { icon: string; name: string } {
  const match = /^(\S+)\s+(.+)$/u.exec(title);
  if (match && !/[\p{L}\p{N}]/u.test(match[1])) return { icon: match[1], name: match[2] };
  return { icon: '📍', name: title };
}

function syncNearbyPagingActions(deps: ChatroomsViewDeps, people: number): void {
  const meet = document.getElementById('nearby-meet-new-people-btn') as HTMLButtonElement | null;
  const back = document.getElementById('nearby-back-to-first-group-btn') as HTMLButtonElement | null;
  const detailOpen = document.body.dataset.chatroomDetail === 'open'
    || !document.getElementById('chatroom-list');
  const onNearbyList = !detailOpen && isNearbyRoomId(deps.currentChatroom) && deps.chatroomBrowseMode === 'list';
  const inPersonalRoom = detailOpen && isPersonalListScope(deps.currentChatroom);
  const pagingVisible = onNearbyList || inPersonalRoom;
  const place = inPersonalRoom && !isNearbyRoomId(deps.currentChatroom);
  const group = deps.nearbyGroup?.group ?? 1;
  const meetVisible = pagingVisible && people > 0;
  const backVisible = pagingVisible && group > 1;

  if (meet) {
    meet.style.display = meetVisible ? 'inline-flex' : 'none';
    meet.disabled = !meetVisible;
    meet.title = deps.text('nearbyMeetNewPeople');
    meet.setAttribute('aria-label', deps.text('nearbyMeetNewPeople'));
    meet.onclick = meetVisible
      ? () => {
          void confirmMeetNewPeople({ text: deps.text, emit: deps.emit }, people, place).then((confirmed) => {
            if (confirmed) deps.emit('nearbyMeetNewPeople');
          });
        }
      : null;
  }
  if (back) {
    back.style.display = backVisible ? 'inline-flex' : 'none';
    back.disabled = !backVisible;
    back.title = deps.text('nearbyBackToFirstGroup');
    back.setAttribute('aria-label', deps.text('nearbyBackToFirstGroup'));
    back.onclick = backVisible ? () => deps.emit('nearbyBackToFirstGroup') : null;
  }
  deps.syncAppBarOverflow?.();
}

export function renderChatroomList(deps: ChatroomsViewDeps): void {
  // The product model is intentionally flat: Nearby people live directly on this screen, while
  // only custom Places are enterable rooms. Geographic subdivision, the Nearby delivery scope,
  // and capacity shards are protocol details, never rooms a person has to understand or open.
  const customNodes = deps.customChatrooms
    .filter((c) => isPlaceRoomId(c.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      icon: customRoomIcon(c.type),
      level: 0,
      description: c.description || '',
      hasChildren: false as const,
    }));
  const currentCustom = deps.customChatrooms.find((room) => room.id === deps.currentChatroom);
  const currentTitle = splitTitleIcon(resolveChatroomTitle(deps.currentChatroom, deps.customChatrooms));
  const currentNode: FlatChatroomNode | null = isPlaceRoomId(deps.currentChatroom)
    ? {
        id: deps.currentChatroom,
        name: currentCustom?.name || currentTitle.name,
        icon: ROOM_ICON,
        level: 0,
        description: currentCustom?.description || deps.text('chatroomPlaceDescriptionFallback'),
        hasChildren: false,
      }
    : null;
  const allChatrooms = Array.from(new Map(
    [...(currentNode ? [currentNode] : []), ...customNodes].map((room) => [room.id, room]),
  ).values());
  // Nearby is my own v3 people list. It is not a room row or a map destination.
  const selfPoint = deps.mapUserDots?.selfPoint;
  const roomRows = deps.activeRooms
    ? roomListRows(deps.activeRooms, {
        t: deps.text,
        currentRoomId: deps.currentChatroom,
        currentName: currentNode?.name || '',
        placeIcon: () => ROOM_ICON,
      }).filter((row) => row.roomId !== deps.currentChatroom && row.memberCount > 0)
    : [];
  const placedPoint = getEncounterLocation();
  const emptyPlaces = emptyPlaceRows(deps.customChatrooms, {
    t: deps.text,
    ...(selfPoint
      ? { origin: { latitude: selfPoint.latitude, longitude: selfPoint.longitude } }
      : placedPoint ? { origin: { latitude: placedPoint.latitude, longitude: placedPoint.longitude } } : {}),
    excludeIds: new Set([deps.currentChatroom, ...roomRows.map((row) => row.roomId)]),
    // The hub's room list says who is in a Place now (rows with people are excluded above); this
    // phone's own count for a Place it left can be stale and hid the emptied Place (phone-path 01).
    memberCount: (roomId) => (deps.activeRooms ? 0 : deps.chatroomMemberCounts.get(roomId) || 0),
    placeIcon: () => ROOM_ICON,
  });
  const sort = getRoomListSort();
  const nearbyPeople = (deps.nearbyMembers ?? [])
    .filter((member) => member.userId !== deps.currentUserId && member.userId !== TECHSUPPORT_ROOT_USER_ID);
  const visibleRoomRows = [...roomRows, ...emptyPlaces];
  const showRoomsSection = Boolean(currentNode || visibleRoomRows.length || deps.activeRooms?.hasMore);

  const chatroomList = document.getElementById('chatroom-list');
  if (!chatroomList) return;

  const renderRoomRow = (room: FlatChatroomNode, isCurrentRoom: boolean): string => {
      const memberCount = deps.chatroomMemberCounts.get(room.id) || 0;
      const visitCounts = deps.chatroomVisitCounts.get(room.id) || { visitCount: 0, uniqueVisitorCount: 0 };
      const showCount = room.id !== CONTACTS_ONLY_SCOPE_ID;
      return `
        <div class="chatroom-item ${isCurrentRoom ? 'current-room' : ''}" 
             data-chatroom-id="${room.id}" 
             data-room-kind="${isPlaceRoomId(room.id) ? 'place' : 'current'}"
             role="button" tabindex="0">
          ${room.icon ? `<div class="chatroom-icon">${room.icon}</div>` : ''}
          <div class="chatroom-info">
            <div class="chatroom-name">
              ${deps.escapeHtml(room.name)}
              ${isCurrentRoom ? `<span class="current-room-badge">${deps.text('chatroomCurrent')}</span>` : ''}
              ${isCurrentRoom && deps.travelModeActive ? `<span class="current-room-badge">${deps.text('chatroomTraveler')}</span>` : ''}
            </div>
            <div class="chatroom-description">${deps.escapeHtml(room.description || '')}</div>
            <div class="chatroom-flat-metrics">
              ${showCount ? `<span class="chatroom-headcount">${deps.text('roomListPeople')
                .replace('{count}', String(memberCount))}</span>` : ''}
              ${isPlaceRoomId(room.id) ? `<span class="chatroom-visitcount">${deps.text('chatroomVisits').replace('{count}', String(visitCounts.visitCount))}</span>` : ''}
            </div>
          </div>
        </div>
      `;
  };

  chatroomList.innerHTML = `
    ${renderRoomListHeader(deps.activeRooms, sort, deps.text, nearbyPeople.length, showRoomsSection, deps.nearbyOnline)}
    <div class="nearby-browser-list" data-testid="nearby-browser-list">
    <section class="chatroom-flat-section nearby-browser-people" data-testid="nearby-people-section">
      <div id="nearby-browser-members">
        ${nearbyPeople.length
          ? nearbyPeople.map((member) => renderOrdinaryMemberRow(member, deps, true)).join('')
          : `<p class="chatroom-flat-empty">${deps.text('chatroomNoOtherUsers')}</p>`}
      </div>
    </section>
    ${showRoomsSection ? `<section class="chatroom-flat-section nearby-browser-rooms" data-testid="rooms-near-you-section">
        <h2 class="chatroom-flat-heading">${deps.text('roomListNearHeading')}</h2>
        ${currentNode ? renderRoomRow(currentNode, true) : ''}
        ${visibleRoomRows.map((row) => renderRoomListRow(row, deps.text, deps.escapeHtml)).join('')}
        ${deps.activeRooms?.hasMore ? `<button type="button" class="btn" id="room-list-more" data-testid="room-list-more">${deps.text('roomListShowMore')}</button>` : ''}
      </section>` : ''}
    </div>`;

  syncNearbyPagingActions(deps, nearbyPeople.length);

  document.getElementById('room-list-sort')?.addEventListener('change', (event) => {
    setRoomListSort((event.currentTarget as HTMLSelectElement).value as ActiveRoomSort);
    deps.emit('activeRoomsQueryChanged', {});
  });
  document.getElementById('room-list-more')?.addEventListener('click', () => {
    deps.emit('activeRoomsQueryChanged', { showMore: true });
  });
  chatroomList.querySelectorAll<HTMLElement>('.chatroom-item').forEach((item) => {
    item.addEventListener('click', () => {
      const chatroomId = item.getAttribute('data-chatroom-id');
      if (chatroomId) {
        enterRoom(deps, chatroomId, visibleRoomRows.find((row) => row.roomId === chatroomId));
      }
    });
    item.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      item.click();
    });
  });
  chatroomList.querySelectorAll<HTMLElement>('.nearby-person-item').forEach((item) => {
    item.addEventListener('click', () => {
      const userId = item.dataset.userId;
      if (userId) deps.openPeerDetail(userId, item.dataset.stageName || 'User');
    });
  });
  hydrateMemberHeadshots(chatroomList, nearbyPeople, deps);

  const listButton = document.getElementById('chatroom-list-view-btn') as HTMLButtonElement | null;
  const mapButton = document.getElementById('chatroom-map-view-btn') as HTMLButtonElement | null;
  const mapContainer = document.getElementById('chatroom-map');
  const mapStatus = document.getElementById('chatroom-map-status');
  const listContainer = document.getElementById('chatroom-list-container');
  if (!listButton || !mapButton || !mapContainer || !mapStatus || !listContainer) return;

  const isMap = deps.chatroomBrowseMode === 'map';
  const previousBrowseMode = listContainer.dataset.chatroomBrowseMode;
  const startedMapVisit = isMap && previousBrowseMode !== 'map';
  const priorHintSession = Number(listContainer.dataset.mapHintSession || '0');
  const mapHintSession = priorHintSession + (startedMapVisit ? 1 : 0);
  listContainer.dataset.chatroomBrowseMode = deps.chatroomBrowseMode;
  listContainer.dataset.mapHintSession = String(mapHintSession);
  listButton.setAttribute('aria-pressed', String(!isMap));
  mapButton.setAttribute('aria-pressed', String(isMap));
  chatroomList.hidden = isMap;
  mapContainer.hidden = !isMap;
  if (!isMap) hideTransientMapHint(mapStatus);
  listContainer.classList.toggle('map-mode', isMap);

  const activateBrowseMode = (mode: 'list' | 'map'): void => {
    const detailContainer = document.getElementById('chatroom-detail-container');
    const isAlreadyBrowsing = detailContainer?.style.display === 'none';
    if (deps.chatroomBrowseMode === mode && isAlreadyBrowsing) return;
    listContainer.style.display = 'flex';
    if (detailContainer) detailContainer.style.display = 'none';
    const backButton = document.getElementById('back-to-chatrooms') as HTMLElement | null;
    if (backButton) backButton.style.display = 'none';
    delete document.body.dataset.chatroomDetail;
    deps.setChatroomBrowseMode(mode);
    deps.renderChatroomList();
  };
  listButton.onclick = () => activateBrowseMode('list');
  mapButton.onclick = () => activateBrowseMode('map');

  if (isMap) {
    // The map is as flat as the list: public Place pins only. Internal Nearby delivery scopes,
    // partition cells, parents, children, and capacity shards never become map destinations.
    const mapRooms: ChatroomMapRoom[] = allChatrooms.map((room) => {
      const visits = deps.chatroomVisitCounts.get(room.id) || { visitCount: 0, uniqueVisitorCount: 0 };
      const custom = deps.customChatrooms.find((candidate) => candidate.id === room.id);
      const location = custom?.location;
      return {
        ...room,
        ...(location ? { location } : {}),
        memberCount: deps.chatroomMemberCounts.get(room.id) || 0,
        visitCount: visits.visitCount,
        uniqueVisitorCount: visits.uniqueVisitorCount,
      };
    });
    const mappedCount = mapRooms.filter((room) => !!room.location && isPlaceRoomId(room.id)).length;
    const unmappedCustomCount = customNodes.filter((room) => !deps.customChatrooms.find((candidate) => candidate.id === room.id)?.location).length;
    const customNote = unmappedCustomCount > 0
      ? ` ${deps.text('chatroomMapCustomRoomsNote').replace('{count}', String(unmappedCustomCount))}`
      : '';
    const summary = deps.text('chatroomMapSummary').replace('{count}', String(mappedCount));
    mapStatus.textContent = `${summary}${customNote}`;
    if (startedMapVisit) showTransientMapHint(mapStatus);
    if (!mapContainer.classList.contains('maplibregl-map')) {
      mapContainer.textContent = deps.text('chatroomMapLoading');
    }
    void renderChatroomMap({
      container: mapContainer,
      rooms: mapRooms,
      currentChatroom: deps.currentChatroom,
      ...(deps.mapUserDots ? { userDots: deps.mapUserDots } : {}),
      ...(deps.roomMemberCard ? { roomMemberCard: deps.roomMemberCard } : {}),
      userLegendHintSession: mapHintSession,
      openChatroom: (chatroomId) => enterRoom(deps, chatroomId, roomRows.find((row) => row.roomId === chatroomId)),
      selectNearbyPoint: (location) => deps.emit('travelNearbyAtPoint', location),
      nearbyPointTitle: deps.text('chatroomNearbyPointTitle'),
      nearbyPointAction: deps.text('chatroomNearbyPointAction'),
      mapLoadFailedText: deps.text('chatroomMapLoadFailed'),
      locateSelfText: deps.text('chatroomMapLocateSelf'),
      membersText: (count) => deps.text(count === 1 ? 'chatroomMemberOne' : 'chatroomMembers').replace('{count}', String(count)),
      visitsText: (count) => deps.text(count === 1 ? 'chatroomVisitOne' : 'chatroomVisits').replace('{count}', String(count)),
    });
  }
}

export function toggleChatroomExpanded(deps: ChatroomsViewDeps, chatroomId: string): void {
  if (deps.expandedChatrooms.has(chatroomId)) {
    deps.expandedChatrooms.delete(chatroomId);
  } else {
    deps.expandedChatrooms.add(chatroomId);
  }
  deps.renderChatroomList();
}

/** Tap a room (list row or map pin): enter it and show its members. */
function enterRoom(deps: ChatroomsViewDeps, chatroomId: string, _row: RoomListRow | undefined): void {
  showChatroomDetail(deps, chatroomId);
}

export function showChatroomDetail(deps: ChatroomsViewDeps, chatroomId: string): void {
  const listContainer = document.getElementById('chatroom-list-container');
  const detailContainer = document.getElementById('chatroom-detail-container');
  const createRoomButton = document.getElementById('create-custom-chatroom-btn');
  const broadcastButton = document.getElementById('broadcast-talk-btn');
  const nearbyMeetButton = document.getElementById('nearby-meet-new-people-btn');
  const nearbyBackButton = document.getElementById('nearby-back-to-first-group-btn');

  if (listContainer) listContainer.style.display = 'none';
  // Keep flex column layout from CSS (#chatroom-detail-container) so #chatroom-members-list can scroll.
  if (detailContainer) detailContainer.style.display = 'flex';
  if (createRoomButton) createRoomButton.style.display = 'none';
  if (broadcastButton) broadcastButton.style.display = 'inline-flex';
  if (nearbyMeetButton) nearbyMeetButton.style.display = 'none';
  if (nearbyBackButton) nearbyBackButton.style.display = 'none';
  document.body.dataset.chatroomDetail = 'open';
  const backBtn = document.getElementById('back-to-chatrooms') as HTMLElement | null;
  if (backBtn) backBtn.style.display = 'inline-flex';
  deps.onChatroomDetailOpened?.(chatroomId);

  const custom = deps.customChatrooms.find((c) => c.id === chatroomId);
  const roomName = custom
    ? `${customRoomIcon(custom.type)} ${custom.name}`
    : resolveChatroomTitle(chatroomId, deps.customChatrooms);

  // Room name already appears in #status-bar-text (persistent) and #current-chatroom-title
  // (this view's own heading) — leave #header-title blank here too, same as showChatroomList().
  const chatroomTitle = document.getElementById('current-chatroom-title');
  const chatroomStatus = document.getElementById('current-chatroom-status');

  if (chatroomTitle) chatroomTitle.textContent = roomName;
  if (chatroomStatus) chatroomStatus.textContent = deps.text('chatroomLoadingMembers');
  renderCustomRoomMetadata(deps, custom);

  deps.setCurrentChatroom(chatroomId);
  syncStatusBroadcastButtonVisibility(chatroomId);

  const ownerBar = document.getElementById('chatroom-owner-bar');
  if (ownerBar) {
    ownerBar.style.display = 'none';
    ownerBar.innerHTML = '';
  }

  const membersList = document.getElementById('chatroom-members-list');
  if (membersList) {
    membersList.innerHTML =
      `<div style="padding: 20px; text-align: center; color: #999;">${deps.text('chatroomLoadingOnlineUsers')}</div>`;
    deps.emit('chatroomChanged', chatroomId);
  }
}

export function updateChatroomMembers(
  deps: ChatroomsViewDeps,
  members: ChatroomMember[],
  currentUserId: string,
): void {
  const chatroomMembersList = document.getElementById('chatroom-members-list');
  const chatroomStatus = document.getElementById('current-chatroom-status');
  // TechSupport is a built-in Contact only. Filter legacy rows before count, detail state, and
  // rendering so stale relay/Gun data cannot resurrect a support room presence.
  const roomMembers = members.filter((member) => member.userId !== TECHSUPPORT_ROOT_USER_ID);
  const otherMembers = roomMembers.filter((member) => member.userId !== currentUserId);
  // Nearby counts the people on my list (§3.7 "498 near you"); a Place counts everyone in it.
  const nearby = isNearbyRoomId(deps.currentChatroom);
  const memberCount = nearby ? otherMembers.length : roomMembers.length;

  deps.chatroomMemberCounts.set(deps.currentChatroom, memberCount);
  deps.setCurrentChatroomMembers(otherMembers);
  deps.renderChatroomList();
  renderCustomRoomMetadata(deps, deps.customChatrooms.find((custom) => custom.id === deps.currentChatroom));

  if (chatroomMembersList) {
    if (chatroomStatus) {
      const visits = deps.chatroomVisitCounts.get(deps.currentChatroom) || { visitCount: 0, uniqueVisitorCount: 0 };
      chatroomStatus.textContent = nearby ? nearbyHeadcountText(deps, memberCount) : formatMetrics(deps, memberCount, visits);
    }
    const detailOpen = document.body.dataset.chatroomDetail === 'open'
      || !document.getElementById('chatroom-list');
    if (detailOpen) {
      // Nearby and Places share the compact AppBar paging controls. Never put the former large
      // green action bar back above a room's people list.
      document.getElementById('nearby-group-bar')?.remove();
      syncNearbyPagingActions(deps, otherMembers.length);
    }

    if (otherMembers.length === 0) {
      chatroomMembersList.innerHTML = `
        <div class="empty-state" style="padding: 40px 20px; text-align: center;">
          <p style="font-size: 1.2em; margin-bottom: 8px;">${deps.text('chatroomNoOtherUsers')}</p>
          <p style="font-size: 0.9em; color: #999;">${deps.text('chatroomFirstHere')}</p>
        </div>
      `;
    } else {
      renderMemberList(chatroomMembersList, otherMembers, deps);
      hydrateMemberHeadshots(chatroomMembersList, otherMembers, deps);
      if (deps.apiBase && currentUserId) {
        void loadMemberStats(chatroomMembersList, otherMembers, currentUserId, deps);
      }
    }
  }

  syncStatusBroadcastButtonVisibility(deps.currentChatroom);
}

/**
 * Profile photos are not part of the room roster record (a photo is a full base64 payload), so the
 * roster first renders whatever the session cache already holds and then, non-blocking, resolves
 * each member's photo and patches the avatar in place — the same approach the Contacts tab uses.
 * Re-resolving on every render is cheap: the resolver caches with a short TTL, which is also what
 * lets a peer's NEW photo appear without a reload.
 */
function hydrateMemberHeadshots(container: HTMLElement, members: ChatroomMember[], deps: ChatroomsViewDeps): void {
  const resolve = deps.resolvePeerHeadshot;
  if (!resolve) return;
  for (const member of members) {
    void resolve(member.userId)
      .then((headshot) => {
        const escapeId = window.CSS?.escape ?? ((value: string) => value);
        const avatar = container.querySelector(
          `[data-user-id="${escapeId(member.userId)}"] .chatroom-member-avatar`,
        ) as HTMLElement | null;
        if (!avatar) return;
        const signature = headshot ? String(headshot.length) : '';
        if ((avatar.dataset.headshotSig || '') === signature) return;
        avatar.dataset.headshotSig = signature;
        avatar.innerHTML = avatarInnerHtml(headshot ?? undefined, member.stageName.charAt(0).toUpperCase(), deps.escapeHtml);
      })
      .catch(() => undefined);
  }
}

function renderOrdinaryMemberRow(
  member: ChatroomMember,
  deps: ChatroomsViewDeps,
  browserRow = false,
  statsMap?: Map<string, PeerRelationshipStats>,
): string {
  const isMatched = deps.matchedUserIds.has(member.userId);
  const stats = statsMap?.get(member.userId);
  const statusText = buildMemberStatusText(isMatched, stats, deps);
  const relationClass = stats
    ? (stats.sent.talks + stats.received.talks === 0 ? 'member-stranger' : 'member-known')
    : '';
  // K1 item 3: liveness, never headcount — the member row itself is unconditional (item 1),
  // this dot is purely presence and defaults to away until a real signal says otherwise.
  // Same real-presence signal as TechSupport's own dot, generalized to every member — same
  // .presence-indicator treatment the Contacts tab uses (contacts-view.ts).
  const online = deps.isUserOnline(member.userId);
  const onlineIndicator = `<span class="presence-indicator ${online ? 'online' : 'away'}" data-user-id="${deps.escapeHtml(member.userId)}" aria-label="${deps.text(online ? 'presenceOnline' : 'presenceAway')}"></span>`;
  const travelerBadge = member.isTraveler
    ? `<span class="chatroom-member-traveler-badge" title="${deps.text('chatroomTraveler')}" aria-label="${deps.text('chatroomTraveler')}">✈ ${deps.text('chatroomTraveler')}</span>`
    : '';
  return `
    <div class="${browserRow ? 'nearby-person-item' : 'chatroom-member-item'} ${isMatched ? 'member-matched' : ''} ${relationClass}" ${browserRow ? 'data-testid="nearby-person-row"' : ''} data-user-id="${deps.escapeHtml(member.userId)}" data-stage-name="${deps.escapeHtml(member.stageName)}" data-traveler="${member.isTraveler === true}"${isMatched ? ' data-matched="true"' : ''}>
      <div class="chatroom-member-avatar">${avatarInnerHtml(deps.getCachedHeadshot?.(member.userId) ?? undefined, member.stageName.charAt(0).toUpperCase(), deps.escapeHtml)}</div>
      <div class="chatroom-member-info">
        <div class="chatroom-member-name">${deps.escapeHtml(member.stageName)}${travelerBadge}${onlineIndicator}</div>
        <div class="chatroom-member-status">${statusText}</div>
      </div>
      <div class="chatroom-member-arrow">›</div>
    </div>
  `;
}

function renderMemberList(
  container: HTMLElement,
  members: ChatroomMember[],
  deps: ChatroomsViewDeps,
  statsMap?: Map<string, PeerRelationshipStats>,
): void {
  // The v3 service already supplies its protocol ranking: public distance, established identity,
  // then the daily per-viewer hash. Preserve that exact order in both the browser and room detail;
  // relationship statistics decorate a row but must not silently reshuffle it.
  container.innerHTML = members.map((member) => renderOrdinaryMemberRow(member, deps, false, statsMap)).join('');

  container.querySelectorAll('.chatroom-member-item').forEach((item) => {
    item.addEventListener('click', () => {
      const targetUserId = (item as HTMLElement).dataset.userId;
      const stageName = (item as HTMLElement).dataset.stageName || 'User';
      if (targetUserId) {
        deps.openPeerDetail(targetUserId, stageName);
      }
    });
  });
}

function buildMemberStatusText(isMatched: boolean, stats: PeerRelationshipStats | undefined, deps: ChatroomsViewDeps): string {
  if (!stats) return isMatched ? deps.text('chatroomMatched') : deps.text('chatroomOnlineNow');
  const total = stats.sent.talks + stats.received.talks;
  if (total === 0) return deps.text('stranger');
  const parts: string[] = [];
  if (stats.sent.talks > 0) parts.push(`${deps.text('sent')} ${stats.sent.talks}/${stats.sent.matches} ${deps.text('chatroomMatchedCount')}`);
  if (stats.received.talks > 0) parts.push(`${deps.text('received')} ${stats.received.talks}/${stats.received.matches} ${deps.text('chatroomMatchedCount')}`);
  if (stats.mutualTagCount > 0) {
    parts.push(`${stats.mutualTagCount} ${deps.text(stats.mutualTagCount === 1 ? 'chatroomMutualTag' : 'chatroomMutualTags')}`);
  }
  return parts.join(' · ') || deps.text('chatroomOnlineNow');
}

/**
 * Derive PeerRelationshipStats for a chatroom member from localTalkExchanges.
 * P0 step 5: no server call to /relationship.
 * Formula mirrors peer-routes.ts#computeRelationshipStats.
 */
function localMemberStats(memberId: string): PeerRelationshipStats {
  const stats: PeerRelationshipStats = {
    sent: { talks: 0, matches: 0 },
    received: { talks: 0, matches: 0 },
    mutualMatchedTalks: 0,
    mutualTagCount: 0,
    totalTalks: 0,
  };
  for (const exchange of readLocalTalkExchanges()) {
    if (String(exchange?.peerId || '').trim() !== memberId) continue;
    stats.sent.talks += 1;
    if (String(exchange?.outcome || '').toLowerCase() === 'match') {
      stats.sent.matches += 1;
      stats.mutualMatchedTalks += 1;
    }
  }
  stats.totalTalks = stats.sent.talks + stats.received.talks;
  return stats;
}

async function loadMemberStats(
  container: HTMLElement,
  members: ChatroomMember[],
  currentUserId: string,
  deps: ChatroomsViewDeps,
): Promise<void> {
  // P0 step 5: relationship stats derived locally — no server call.
  const statsMap = new Map<string, PeerRelationshipStats>();
  for (const member of members) {
    if (!member.userId || member.userId === currentUserId) continue;
    const stats = localMemberStats(member.userId);
    // Only populate the map if there are known interactions (avoids "Stranger" flicker
    // when stats are all zeros — buildMemberStatusText handles undefined correctly).
    if (stats.totalTalks > 0) {
      statsMap.set(member.userId, stats);
    }
  }
  // Re-render with relationship labels while preserving the v3 roster order.
  renderMemberList(container, members, deps, statsMap);
}

/**
 * Resolves a chatroom id to its display title: a custom room (🏪/💬 + name), then the flat
 * hierarchy list's icon + name, then a depth-first search of the tree (for a room present in
 * the tree but not the flat list), then a title-cased fallback derived from the id itself.
 */
/**
 * Automatic coarse-coordinate cell rooms (`region_<lat>_<lng>_room_<lane>`, FR-CR-2) have no entry
 * in the named hierarchy; title them by the most specific named place covering the cell —
 * "📍 Near San Diego" — instead of the raw id. Later lanes add "· Group N".
 */
const COARSE_CELL_ID = /^region_(-?\d+(?:\.\d+)?)_(-?\d+(?:\.\d+)?)(?:_room_(\d+))?$/;

function coarseCellTitle(chatroomId: string): string | null {
  const cell = COARSE_CELL_ID.exec(chatroomId);
  if (!cell) return null;
  const latitude = Number(cell[1]);
  const longitude = Number(cell[2]);
  const path = getLocationChatroomPath({ latitude, longitude, accuracy: 0, timestamp: new Date() });
  // City names only: never label a grid cell by its continent/country/state (no borders in the UI).
  const cities = new Map(getFlatChatroomList().filter((node) => !node.hasChildren).map((node) => [node.id, node.name] as const));
  const place = [...path].reverse().map((id) => cities.get(id)).find(Boolean);
  const coords = `${Math.abs(latitude).toFixed(1)}°${latitude >= 0 ? 'N' : 'S'} ${Math.abs(longitude).toFixed(1)}°${longitude >= 0 ? 'E' : 'W'}`;
  const label = place ? `📍 Near ${place}` : `📍 ${coords}`;
  const lane = Number(cell[3] || 0);
  return lane > 0 ? `${label} · Group ${lane + 1}` : label;
}

export function resolveChatroomTitle(chatroomId: string, customChatrooms: readonly CustomChatroomRow[]): string {
  if (chatroomId === CONTACTS_ONLY_SCOPE_ID) return '👥 Contacts only';
  if (isNearbyRoomId(chatroomId)) return '📍 Nearby';
  const tile = getL1TileInfo(chatroomId);
  if (tile) return `${tile.icon} ${tile.name}`;
  const deepTile = deepTileTitle(chatroomId);
  if (deepTile) return deepTile;
  const custom = customChatrooms.find((c) => c.id === chatroomId);
  if (custom) {
    const icon = custom.type === 'business' ? '🏪' : '💬';
    return `${icon} ${custom.name}`;
  }
  const flat = getFlatChatroomList();
  const node = flat.find((n) => n.id === chatroomId);
  if (node) return `${node.icon} ${node.name}`;
  const findInTree = (node: ReturnType<typeof getActiveChatroomHierarchy>): string | null => {
    if (node.id === chatroomId) return node.name;
    if (node.children) {
      for (const ch of node.children) {
        const r = findInTree(ch);
        if (r) return r;
      }
    }
    return null;
  };
  const treeName = findInTree(getActiveChatroomHierarchy());
  if (treeName) return treeName;
  const cellTitle = coarseCellTitle(chatroomId);
  if (cellTitle) return cellTitle;
  return chatroomId
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
