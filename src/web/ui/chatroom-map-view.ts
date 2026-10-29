import { isNearbyRoomId } from '../../shared/nearby-rooms';
import type { FlatChatroomNode } from '../../shared/chatroom-hierarchy';
import { CONFIG } from '../../shared/config';
import { isPlaceRoomId } from '../../shared/place-rooms';
import {
  chatroomsToGeoJson,
  type ChatroomMapFeatureProperties,
} from '../../shared/chatroom-map-geojson';
import type { MapBounds, MapDensityCell, MapPresenceDot } from '../../shared/map-dots';
import type { PublicLocation } from '../../shared/public-location';
import {
  getChatroomMapLocation,
  type ChatroomMapLocation,
} from '../../shared/chatroom-map-locations';
import { MapBroadcastEffects, type MapBroadcastEvent, type MapEffectAnchors } from './map-broadcast-effects';
import { MapTalkConnections, type MapTalkConnection } from './map-talk-connections';
import { layoutMapUsers, selfMapPosition, type UserDotGroup } from './map-user-layout';
import { hideTransientMapHint, showTransientMapHint } from './transient-map-hint';
export { groupUserDots } from './map-user-layout';

type MapLibre = typeof import('maplibre-gl');
type MapLibreMap = import('maplibre-gl').Map;
type MapLibreMarker = import('maplibre-gl').Marker;

export type ChatroomMapRoom = FlatChatroomNode & {
  memberCount: number;
  visitCount: number;
  uniqueVisitorCount: number;
  /** Public room-level coordinate; never a member/user coordinate. */
  location?: ChatroomMapLocation;
};

type ChatroomMapOptions = {
  container: HTMLElement;
  rooms: ReadonlyArray<ChatroomMapRoom>;
  currentChatroom: string;
  openChatroom: (chatroomId: string) => void;
  /** Tap empty map space to preview and deliberately travel to Nearby around that point. */
  selectNearbyPoint?: (location: ChatroomMapLocation) => void;
  nearbyPointTitle?: string;
  nearbyPointAction?: string;
  mapLoadFailedText: string;
  /** Label of the "center on me" button under the zoom buttons. */
  locateSelfText?: string;
  membersText: (count: number) => string;
  visitsText: (count: number) => string;
  /** People on the map: a star for me, green for my Nearby list, heat for the crowd. */
  userDots?: MapUserDots;
  /** Incremented only when the person deliberately enters Map view, not on live-data refreshes. */
  userLegendHintSession?: number;
  /** Tap a green dot (someone in my room): a brief profile card with Message and Profile. */
  roomMemberCard?: RoomMemberCardSource;
  broadcastEvents?: readonly MapBroadcastEvent[];
};

/** Brief profile shown on the map for a member of my room. */
export type RoomMemberSummary = {
  stageName: string;
  online: boolean;
  matched: boolean;
  traveler: boolean;
};

export type RoomMemberProfile = {
  headshot?: string | null;
  languages: string[];
  /** Public profile lines ("Q: A"), already filtered to what any viewer may see. */
  highlights: string[];
};

export type RoomMemberCardSource = {
  describe: (userId: string) => RoomMemberSummary;
  loadProfile?: (userId: string) => Promise<RoomMemberProfile | null>;
  message: (userId: string, stageName: string) => void;
  contact?: (userId: string, stageName: string) => void;
  matchText?: (count: number) => string;
  navigation?: {
    me: () => void;
    talks: (userId: string, stageName: string) => void;
    meText: string;
    relationshipText: string;
    talksText: string;
    travelText: string;
    countText: (count: number) => string;
    withText: (name: string) => string;
  };
  profile: (userId: string, stageName: string) => void;
  text: { message: string; profile: string; online: string; away: string; matched: string; traveler: string };
};

/** Published points and viewport loader, plus an optional device-only fix for my own marker. */
export type MapUserDotSource = {
  selfPoint?: PublicLocation;
  /** Local display only. Never supplied to the hub or another user. */
  selfGpsPoint?: ChatroomMapLocation;
  selfTraveler?: boolean;
  /** Where the people on my Nearby list are: the map fits itself to them (§3.7). */
  listPoints?: () => ReadonlyArray<{ latitude: number; longitude: number }>;
  /**
   * Counted by my Nearby audience although not on my current page (OPEN-86 E3): green like the
   * people on it. Everyone else in view is yellow.
   */
  isCandidate?: (dot: MapPresenceDot) => boolean;
  load: (bounds: MapBounds) => Promise<{ dots: MapPresenceDot[]; density: MapDensityCell[] }>;
};

type MapUserDotTextKey =
  | 'mapUserSelf' | 'mapUserRoomOne' | 'mapUserRoomMany' | 'mapUserOtherOne' | 'mapUserOtherMany'
  | 'mapUserLegendSelf' | 'mapUserLegendRoom' | 'mapUserLegendOther'
  | 'mapBroadcastOutgoing' | 'mapBroadcastIncoming';

/** Combine the app's source with my id, my room roster (= green) and the UI text. */
export function createMapUserDots(
  source: MapUserDotSource,
  selfUserId: string,
  roomMembers: ReadonlyArray<{ userId: string; isTraveler?: boolean }>,
  t: (key: MapUserDotTextKey) => string,
): MapUserDots {
  const count = (one: MapUserDotTextKey, many: MapUserDotTextKey) => (n: number) =>
    n === 1 ? t(one) : t(many).replace('{count}', String(n));
  return {
    selfUserId,
    ...(source.selfPoint ? { selfPoint: source.selfPoint } : {}),
    ...(!source.selfTraveler && source.selfGpsPoint ? { selfGpsPoint: source.selfGpsPoint } : {}),
    selfTraveler: source.selfTraveler === true,
    ...(source.listPoints ? { listPoints: source.listPoints } : {}),
    ...(source.isCandidate ? { isCandidate: source.isCandidate } : {}),
    roomMemberIds: new Set(roomMembers.map((member) => member.userId)),
    roomTravelerIds: new Set(roomMembers.filter((member) => member.isTraveler).map((member) => member.userId)),
    load: source.load,
    selfText: t('mapUserSelf'),
    roomText: count('mapUserRoomOne', 'mapUserRoomMany'),
    otherText: count('mapUserOtherOne', 'mapUserOtherMany'),
    broadcastText: { outgoing: t('mapBroadcastOutgoing'), incoming: t('mapBroadcastIncoming') },
    legendText: { self: t('mapUserLegendSelf'), room: t('mapUserLegendRoom'), other: t('mapUserLegendOther') },
  };
}

export type MapUserDots = {
  selfUserId: string;
  /** My published snapped point defines the blurred box and what others see of me. */
  selfPoint?: PublicLocation;
  /** Local display only. Never supplied to the hub or another user. */
  selfGpsPoint?: ChatroomMapLocation;
  selfTraveler?: boolean;
  listPoints?: () => ReadonlyArray<{ latitude: number; longitude: number }>;
  /** Current room roster: these users can exchange Talks with me. */
  roomMemberIds: ReadonlySet<string>;
  matchCounts?: ReadonlyMap<string, number>;
  talkIdsByPeer?: ReadonlyMap<string, readonly string[]>;
  roomTravelerIds?: ReadonlySet<string>;
  isCandidate?: (dot: MapPresenceDot) => boolean;
  load: (bounds: MapBounds) => Promise<{ dots: MapPresenceDot[]; density: MapDensityCell[] }>;
  selfText: string;
  roomText: (count: number) => string;
  otherText: (count: number) => string;
  legendText: { self: string; room: string; other: string };
  broadcastText?: { outgoing: string; incoming: string };
};

type MapState = {
  map: MapLibreMap;
  markers: MapLibreMarker[];
  selectionMarker?: MapLibreMarker | undefined;
  /** Room id plus its Nearby area's scale at the last focus. */
  focusedChatroom: string;
  loaded: boolean;
  options: ChatroomMapOptions;
  ready: Promise<void>;
  userDotMarkers: MapLibreMarker[];
  userDotGroups?: UserDotGroup[];
  broadcastEffects?: MapBroadcastEffects;
  talkConnections?: MapTalkConnections;
  userDotTimer?: ReturnType<typeof setTimeout> | undefined;
  userDotRequest: number;
  /** Last dot query, reused for the same view for USER_DOT_REUSE_MS (the list re-renders often). */
  userDotCache?: { key: string; at: number; dots: MapPresenceDot[]; density: MapDensityCell[] };
  /** The room has no place of its own and my position was not known yet when it was focused. */
  awaitingSelfCenter: boolean;
  /** Nearby was focused before my list had anyone: fit to the list once it does. */
  awaitingListFit?: boolean;
  /** Zoom that fits my current room; "center on me" returns to it. */
  roomZoom?: number | undefined;
  /**
   * What the room markers, the room source and the people layer were last built from. The room
   * list re-renders the map often and MapLibre fires `sourcedata`/`idle` on every tile; rebuilding
   * every DOM marker each time kept a phone's WebView busy with the map open (OPEN-73).
   */
  markerSignature?: string | undefined;
  sourceSignature?: string | undefined;
  userDotSignature?: string | undefined;
};

/** A room with no area of its own (Contacts only, custom rooms) shows my neighbourhood. */
const SELF_ZOOM = 12;

const SOURCE_ID = 'iinpublic-chatrooms';
const CLUSTER_LAYER_ID = 'iinpublic-chatroom-clusters';
const ROOM_LAYER_ID = 'iinpublic-chatroom-points';
const USER_DENSITY_SOURCE_ID = 'iinpublic-user-density';
const USER_REGION_SOURCE_ID = 'iinpublic-user-region';

const stateByContainer = new WeakMap<HTMLElement, MapState>();
let mapLibrePromise: Promise<MapLibre> | undefined;

export function loadMapLibre(): Promise<MapLibre> {
  if (!mapLibrePromise) {
    mapLibrePromise = Promise.all([
      import('maplibre-gl'),
      import('maplibre-gl/dist/maplibre-gl.css'),
      import('pmtiles'),
    ])
      .then(([maplibre, , pmtiles]) => {
        // MapLibre v6 cannot reliably infer its ESM worker after Webpack rewrites
        // import.meta.url. Explicitly register the bundled worker before creating a map.
        // The worker imports maplibre-gl-shared.mjs by a relative path, so reference that
        // asset too and verify Webpack kept both files in the same emitted directory.
        const workerUrl = new URL(
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          require('maplibre-gl/dist/maplibre-gl-worker.mjs?maplibreWorkerAsset') as string,
          window.location.href,
        );
        const sharedUrl = new URL(
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          require('maplibre-gl/dist/maplibre-gl-shared.mjs?maplibreWorkerAsset') as string,
          window.location.href,
        );
        if (new URL('.', workerUrl).toString() !== new URL('.', sharedUrl).toString()) {
          throw new Error('MapLibre worker assets must be emitted as siblings');
        }
        maplibre.setWorkerUrl(workerUrl.toString());
        // docs/TODO.md "smaller independent work": registering the `pmtiles://` protocol
        // is a no-op unless a style/source actually references it, so this is safe to do
        // unconditionally rather than gating it on a config flag. It's what makes
        // `CHATROOM_MAP_STYLE_URL` (already self-hoster-overridable via
        // IINPUBLIC_MAP_STYLE_URL) usable with a single self-hosted/decentralized
        // `.pmtiles` archive: a self-hoster's own style.json can point a source at
        // `pmtiles://<url-or-local-path-to-file>.pmtiles`, needing no tile SERVER at
        // all — just one static file, servable from the same box (or IPFS) that already
        // hosts everything else. The default shipped style (OpenFreeMap Liberty) never
        // uses this scheme, so registering it changes nothing for the default config.
        const protocol = new pmtiles.Protocol();
        maplibre.addProtocol('pmtiles', protocol.tile);
        return maplibre;
      })
      .catch((error: unknown) => {
        // A temporary chunk/network failure should not permanently disable Map view.
        mapLibrePromise = undefined;
        throw error;
      });
  }
  return mapLibrePromise;
}

function directRoomLocation(room: ChatroomMapRoom): ChatroomMapLocation | undefined {
  return room.location ?? getChatroomMapLocation(room.id);
}

function roomLocation(
  room: ChatroomMapRoom,
  rooms: ReadonlyArray<ChatroomMapRoom>,
): ChatroomMapLocation | undefined {
  if (room.id === 'global') return { latitude: 20, longitude: 0 };
  const direct = directRoomLocation(room);
  if (direct) return direct;

  const childrenByParent = new Map<string, ChatroomMapRoom[]>();
  rooms.forEach((candidate) => {
    if (!candidate.parentId) return;
    const children = childrenByParent.get(candidate.parentId) || [];
    children.push(candidate);
    childrenByParent.set(candidate.parentId, children);
  });

  const descendantLocations: ChatroomMapLocation[] = [];
  const collect = (parentId: string): void => {
    (childrenByParent.get(parentId) || []).forEach((child) => {
      const location = directRoomLocation(child);
      if (location) descendantLocations.push(location);
      else collect(child.id);
    });
  };
  collect(room.id);
  if (descendantLocations.length === 0) return undefined;

  return {
    latitude:
      descendantLocations.reduce((sum, point) => sum + point.latitude, 0) /
      descendantLocations.length,
    longitude:
      descendantLocations.reduce((sum, point) => sum + point.longitude, 0) /
      descendantLocations.length,
  };
}

/** Focus zoom for a room pin by its tree level (Places sit at the finest level). */
function zoomForRoom(room: FlatChatroomNode | undefined): number {
  if (!room) return 2;
  return [2, 2.5, 4, 6, 9][Math.min(room.level, 4)] || 9;
}

function clearSelection(state: MapState): void {
  state.selectionMarker?.remove();
  state.selectionMarker = undefined;
}

function handleMapTap(maplibre: MapLibre, state: MapState, latitude: number, longitude: number): void {
  clearSelection(state);
  state.talkConnections?.select();
  if (state.options.selectNearbyPoint) selectNearbyPoint(maplibre, state, { latitude, longitude });
}

/** Brief profile card for the member(s) at a green dot, with Message and Profile actions. */
function showRoomMemberCard(maplibre: MapLibre, state: MapState, group: UserDotGroup): void {
  const source = state.options.roomMemberCard;
  if (!source) return;
  state.awaitingListFit = false;
  clearSelection(state);
  const card = document.createElement('div');
  card.className = 'chatroom-map-tile-card chatroom-map-member-card';
  card.setAttribute('data-testid', 'map-member-card');
  card.addEventListener('click', (event) => event.stopPropagation());
  card.addEventListener('dblclick', (event) => { event.preventDefault(); event.stopPropagation(); });
  for (const userId of group.userIds) {
    const summary = source.describe(userId);
    const row = document.createElement('div');
    row.className = 'chatroom-map-member';
    row.setAttribute('data-testid', 'map-member');
    row.dataset.userId = userId;
    const avatar = document.createElement('div');
    avatar.className = 'chatroom-map-member-avatar';
    avatar.textContent = summary.stageName.charAt(0).toUpperCase();
    const info = document.createElement('div');
    info.className = 'chatroom-map-member-info';
    const matchCount = state.options.userDots?.matchCounts?.get(userId) ?? 0;
    const name = document.createElement(matchCount && source.contact ? 'button' : 'strong');
    name.textContent = matchCount ? `${summary.stageName} · ♥ ${matchCount}` : summary.stageName;
    if (name instanceof HTMLButtonElement) {
      name.type = 'button';
      name.className = 'chatroom-map-member-contact';
      name.addEventListener('click', () => { clearSelection(state); source.contact?.(userId, summary.stageName); });
    }
    const status = document.createElement('span');
    status.className = 'chatroom-map-member-status';
    status.textContent = [
      summary.online ? source.text.online : source.text.away,
      summary.matched ? source.text.matched : '',
      summary.traveler ? `✈ ${source.text.traveler}` : '',
    ].filter(Boolean).join(' · ');
    const details = document.createElement('div');
    details.className = 'chatroom-map-member-details';
    details.setAttribute('data-testid', 'map-member-details');
    info.append(name, status, details);
    const actions = document.createElement('div');
    actions.className = 'chatroom-map-member-actions';
    const message = document.createElement('button');
    message.type = 'button';
    message.className = 'chatroom-map-tile-enter';
    message.setAttribute('data-testid', 'map-member-message');
    message.textContent = `💬 ${source.text.message}`;
    message.addEventListener('click', (event) => {
      event.stopPropagation();
      clearSelection(state);
      source.message(userId, summary.stageName);
    });
    const profile = document.createElement('button');
    profile.type = 'button';
    profile.className = 'chatroom-map-member-profile';
    profile.setAttribute('data-testid', 'map-member-profile');
    profile.textContent = `👤 ${source.navigation?.relationshipText ?? source.text.profile}`;
    profile.addEventListener('click', (event) => {
      event.stopPropagation();
      clearSelection(state);
      source.profile(userId, summary.stageName);
    });
    actions.append(message, profile);
    if (source.navigation) {
      const talks = document.createElement('button');
      talks.type = 'button';
      talks.className = 'chatroom-map-member-profile';
      talks.dataset.testid = 'map-member-talks';
      talks.textContent = source.navigation.talksText;
      talks.addEventListener('click', () => {
        clearSelection(state);
        state.awaitingListFit = false;
        source.navigation!.talks(userId, summary.stageName);
      });
      actions.appendChild(talks);
      if (group.kind === 'other' && state.options.selectNearbyPoint) {
        const travel = document.createElement('button');
        travel.type = 'button';
        travel.className = 'chatroom-map-member-profile';
        travel.dataset.testid = 'map-member-travel';
        travel.textContent = source.navigation.travelText;
        travel.addEventListener('click', () => handleMapTap(maplibre, state, group.latitude, group.longitude));
        actions.appendChild(travel);
      }
    }
    row.append(avatar, info, actions);
    card.appendChild(row);
    void source.loadProfile?.(userId).then((loaded) => {
      if (!loaded || !row.isConnected) return;
      if (loaded.headshot) {
        const image = document.createElement('img');
        image.src = loaded.headshot;
        image.alt = '';
        avatar.textContent = '';
        avatar.appendChild(image);
      }
      const lines = [
        loaded.languages.length ? `🗣 ${loaded.languages.join(', ')}` : '',
        ...loaded.highlights.slice(0, 3),
      ].filter(Boolean);
      for (const line of lines) {
        const item = document.createElement('span');
        item.textContent = line;
        details.appendChild(item);
      }
    }).catch(() => undefined);
  }
  state.selectionMarker = new maplibre.Marker({ element: card, anchor: 'bottom', offset: [0, -14] })
    .setLngLat([group.displayPoint?.longitude ?? group.longitude, group.displayPoint?.latitude ?? group.latitude])
    .addTo(state.map);
}

function showSelfCard(maplibre: MapLibre, state: MapState, group: UserDotGroup): void {
  const navigation = state.options.roomMemberCard?.navigation;
  if (!navigation) return;
  clearSelection(state);
  state.talkConnections?.select();
  const card = document.createElement('div');
  card.className = 'chatroom-map-tile-card';
  card.dataset.testid = 'map-self-card';
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'chatroom-map-member-profile';
  open.textContent = navigation.meText;
  open.dataset.testid = 'map-self-open';
  open.addEventListener('click', (event) => {
    event.stopPropagation(); clearSelection(state); state.awaitingListFit = false; navigation.me();
  });
  card.addEventListener('dblclick', (event) => { event.preventDefault(); event.stopPropagation(); });
  card.appendChild(open);
  const point = group.displayPoint ?? group;
  state.selectionMarker = new maplibre.Marker({ element: card, anchor: 'bottom', offset: [0, -20] })
    .setLngLat([point.longitude, point.latitude]).addTo(state.map);
}

/** Preview a map point as a flat Nearby destination; no internal tile or room id is exposed. */
function selectNearbyPoint(
  maplibre: MapLibre,
  state: MapState,
  location: ChatroomMapLocation,
): void {
  clearSelection(state);
  const card = document.createElement('div');
  card.className = 'chatroom-map-tile-card';
  card.dataset.testid = 'map-nearby-point-card';
  card.setAttribute('data-testid', 'map-nearby-point-card');
  const name = document.createElement('strong');
  name.textContent = state.options.nearbyPointTitle ?? 'Nearby around this point';
  const enter = document.createElement('button');
  enter.type = 'button';
  enter.className = 'chatroom-map-tile-enter';
  enter.setAttribute('data-testid', 'map-nearby-point-enter');
  enter.textContent = state.options.nearbyPointAction ?? 'Join as traveler';
  enter.addEventListener('click', (event) => {
    event.stopPropagation();
    clearSelection(state);
    state.options.selectNearbyPoint?.(location);
  });
  card.addEventListener('click', (event) => event.stopPropagation());
  card.append(name, enter);
  state.selectionMarker = new maplibre.Marker({ element: card, anchor: 'bottom' })
    .setLngLat([location.longitude, location.latitude])
    .addTo(state.map);
}

function tooltipElement(options: ChatroomMapOptions, room: ChatroomMapRoom): HTMLElement {
  const tooltip = document.createElement('span');
  tooltip.className = 'chatroom-map-tooltip';
  tooltip.setAttribute('aria-hidden', 'true');
  const name = document.createElement('strong');
  name.textContent = `${room.icon} ${room.name}`;
  const metrics = document.createElement('span');
  metrics.textContent = `${options.membersText(room.memberCount)} · ${options.visitsText(room.visitCount)}`;
  tooltip.append(name, metrics);
  return tooltip;
}

/** Zoom (about city level) from which empty Places are drawn. */
export const EMPTY_PLACE_MIN_ZOOM = 9;

function isEmptyPlace(room: ChatroomMapRoom): boolean {
  return isPlaceRoomId(room.id) && room.memberCount === 0;
}

function roomMarkerElement(options: ChatroomMapOptions, room: ChatroomMapRoom): HTMLButtonElement {
  const marker = document.createElement('button');
  marker.type = 'button';
  marker.className = `chatroom-map-marker${room.id === options.currentChatroom ? ' current-room' : ''}`
    + (room.id !== options.currentChatroom && isEmptyPlace(room) ? ' empty-place' : '');
  marker.dataset.chatroomId = room.id;
  marker.title = room.name;
  marker.setAttribute(
    'aria-label',
    `${room.name}. ${options.membersText(room.memberCount)}. ${options.visitsText(room.visitCount)}`,
  );
  const count = document.createElement('span');
  count.className = 'chatroom-map-marker-count';
  count.setAttribute('aria-hidden', 'true');
  count.textContent = room.memberCount > 99 ? '99+' : String(room.memberCount);
  marker.append(count, tooltipElement(options, room));
  marker.addEventListener('click', (event) => {
    event.stopPropagation();
    options.openChatroom(room.id);
  });
  return marker;
}

function clusterMarkerElement(
  state: MapState,
  clusterId: number,
  count: number,
  label: string,
  coordinates: [number, number],
): HTMLButtonElement {
  const marker = document.createElement('button');
  marker.type = 'button';
  marker.className = 'chatroom-map-cluster';
  marker.dataset.clusterId = String(clusterId);
  marker.textContent = label;
  marker.setAttribute('aria-label', `${count} chatrooms. Zoom in to explore.`);
  marker.addEventListener('click', (event) => {
    event.stopPropagation();
    const source = state.map.getSource(SOURCE_ID) as import('maplibre-gl').GeoJSONSource | undefined;
    if (!source) return;
    void source.getClusterExpansionZoom(clusterId).then((zoom) => {
      state.map.easeTo({ center: coordinates, zoom });
    });
  });
  return marker;
}

function clearMarkers(state: MapState): void {
  state.markers.forEach((marker) => marker.remove());
  state.markers = [];
  state.markerSignature = undefined;
}

/**
 * The current room never joins a cluster: a nearby region pin (e.g. "Asia · Pacific" beside a
 * Tokyo grid room) would otherwise swallow it. It is always drawn as its own marker below.
 */
function clusteredRooms(options: ChatroomMapOptions): ChatroomMapRoom[] {
  return options.rooms.filter((room) => room.id !== options.currentChatroom);
}

function addCurrentHierarchyMarker(maplibre: MapLibre, state: MapState): void {
  const currentRoom = state.options.rooms.find((room) => room.id === state.options.currentChatroom);
  if (!currentRoom) return;
  const focus = roomLocation(currentRoom, state.options.rooms);
  if (!focus) return;
  const marker = new maplibre.Marker({
    element: roomMarkerElement(state.options, currentRoom),
    // Keep the Place's enter button clear of the centered self star.
    offset: isPlaceRoomId(currentRoom.id) ? [0, -36] : [0, 0],
  })
    .setLngLat([focus.longitude, focus.latitude])
    .addTo(state.map);
  state.markers.push(marker);
}

function rebuildHtmlMarkers(maplibre: MapLibre, state: MapState): number {
  if (!state.loaded) return 0;
  const renderedFeatures = state.map.queryRenderedFeatures({
    layers: [CLUSTER_LAYER_ID, ROOM_LAYER_ID],
  });
  const signature = JSON.stringify([
    state.options.currentChatroom,
    state.map.getZoom() < EMPTY_PLACE_MIN_ZOOM,
    state.options.rooms.map((room) => [room.id, room.name, room.memberCount, room.visitCount, room.uniqueVisitorCount, room.location]),
    renderedFeatures.map((feature) => [
      feature.geometry.type === 'Point' ? feature.geometry.coordinates : null,
      feature.properties?.cluster_id ?? feature.properties?.chatroomId,
      feature.properties?.point_count,
    ]),
  ]);
  if (signature === state.markerSignature && renderedFeatures.length > 0) return renderedFeatures.length;
  state.markerSignature = signature;
  clearMarkers(state);
  const roomsById = new Map(state.options.rooms.map((room) => [room.id, room]));
  const seen = new Set<string>();
  state.options.container.dataset.mapRenderedFeatureCount = String(renderedFeatures.length);
  for (const feature of renderedFeatures) {
    if (feature.geometry.type !== 'Point') continue;
    const coordinates = feature.geometry.coordinates as [number, number];
    const properties = (feature.properties || {}) as Partial<ChatroomMapFeatureProperties> & {
      cluster?: boolean;
      cluster_id?: number;
      point_count?: number;
      point_count_abbreviated?: string | number;
    };

    if (properties.cluster) {
      const clusterId = Number(properties.cluster_id);
      const key = `cluster:${clusterId}`;
      if (!Number.isFinite(clusterId) || seen.has(key)) continue;
      seen.add(key);
      const count = Number(properties.point_count) || 0;
      const element = clusterMarkerElement(
        state,
        clusterId,
        count,
        String(properties.point_count_abbreviated ?? count),
        coordinates,
      );
      state.markers.push(new maplibre.Marker({ element }).setLngLat(coordinates).addTo(state.map));
      continue;
    }

    const chatroomId = String(properties.chatroomId || '');
    const key = `room:${chatroomId}`;
    const room = roomsById.get(chatroomId);
    if (!room || seen.has(key)) continue;
    // An empty Place is drawn only from city zoom in (docs/design/nearby-and-place-chatrooms.md §4.2).
    if (isEmptyPlace(room) && state.map.getZoom() < EMPTY_PLACE_MIN_ZOOM) continue;
    seen.add(key);
    const element = roomMarkerElement(state.options, room);
    state.markers.push(new maplibre.Marker({ element }).setLngLat(coordinates).addTo(state.map));
  }

  addCurrentHierarchyMarker(maplibre, state);
  return renderedFeatures.length;
}

function updateSource(state: MapState): void {
  if (!state.loaded) return;
  const source = state.map.getSource(SOURCE_ID) as import('maplibre-gl').GeoJSONSource | undefined;
  const data = chatroomsToGeoJson(clusteredRooms(state.options), state.options.currentChatroom);
  const signature = JSON.stringify(data);
  // Unchanged rooms: setData would only re-cluster and fire another round of marker rebuilds.
  if (!source || signature === state.sourceSignature) return;
  state.sourceSignature = signature;
  source.setData(data);
}

/** Fit the view to me and the people on my list; false while there is no one to fit. */
function fitToList(state: MapState): boolean {
  const dots = state.options.userDots;
  const points = [...(dots?.listPoints?.() ?? [])];
  if (points.length === 0) return false;
  const self = dots ? selfMapPosition(dots) : undefined;
  if (self) points.push(self);
  const lats = points.map((point) => point.latitude);
  const lngs = points.map((point) => point.longitude);
  const [south, north, west, east] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  state.options.container.dataset.mapFitPoints = String(points.length);
  if (south === north && west === east) {
    state.map.jumpTo({ center: [west, south], zoom: SELF_ZOOM });
  } else {
    state.map.fitBounds([[west, south], [east, north]], { padding: 48, maxZoom: 14, duration: 0 });
  }
  state.roomZoom = state.map.getZoom();
  return true;
}

function currentPlaceLocation(state: MapState): (ChatroomMapLocation & { memberCount: number }) | undefined {
  if (!isPlaceRoomId(state.options.currentChatroom)) return undefined;
  const room = state.options.rooms.find((item) => item.id === state.options.currentChatroom);
  const location = room ? directRoomLocation(room) : undefined;
  return location && room ? { ...location, memberCount: room.memberCount } : undefined;
}

function selfCenter(state: MapState): [number, number] | undefined {
  const dots = state.options.userDots;
  const self = dots ? selfMapPosition(dots, currentPlaceLocation(state)) : currentPlaceLocation(state);
  return self ? [self.longitude, self.latitude] : undefined;
}

function centerOnSelf(state: MapState): void {
  const center = selfCenter(state);
  if (!center) return;
  state.map.easeTo({ center, zoom: state.roomZoom ?? state.map.getZoom() });
}

function focusCurrentRoom(state: MapState): void {
  const focusKey = state.options.currentChatroom;
  if (focusKey === state.focusedChatroom) {
    if (state.awaitingListFit && fitToList(state)) {
      state.awaitingListFit = false;
      state.awaitingSelfCenter = false;
      return;
    }
    // My position landed after the first paint (first-launch permission, slow fix): go there once.
    const self = state.awaitingSelfCenter ? selfCenter(state) : undefined;
    if (self) {
      state.awaitingSelfCenter = false;
      state.map.jumpTo({ center: self, zoom: state.roomZoom ?? SELF_ZOOM });
    }
    return;
  }
  state.focusedChatroom = focusKey;
  const currentRoom = state.options.rooms.find((room) => room.id === state.options.currentChatroom);
  const focus = currentRoom ? roomLocation(currentRoom, state.options.rooms) : undefined;
  // A Place shows its pin; Nearby fits itself to me and my list (§3.7); Contacts only shows my
  // neighbourhood.
  const nearby = !focus && isNearbyRoomId(state.options.currentChatroom);
  state.awaitingListFit = nearby;
  if (nearby && fitToList(state)) {
    state.awaitingListFit = false;
    state.awaitingSelfCenter = false;
    return;
  }
  const self = focus ? undefined : selfCenter(state);
  state.roomZoom = focus ? zoomForRoom(currentRoom) : SELF_ZOOM;
  state.awaitingSelfCenter = !focus && !self;
  state.map.jumpTo({
    center: focus ? [focus.longitude, focus.latitude] : self ?? [0, 20],
    zoom: focus || self ? state.roomZoom : zoomForRoom(currentRoom),
  });
}

/** "Center on me" button, styled as MapLibre's own geolocate control, under the zoom buttons. */
function locateSelfControl(state: MapState): import('maplibre-gl').IControl {
  const group = document.createElement('div');
  group.className = 'maplibregl-ctrl maplibregl-ctrl-group';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'maplibregl-ctrl-geolocate chatroom-map-locate-self';
  const label = state.options.locateSelfText || 'Center on me';
  button.title = label;
  button.setAttribute('aria-label', label);
  const icon = document.createElement('span');
  icon.className = 'maplibregl-ctrl-icon';
  icon.setAttribute('aria-hidden', 'true');
  button.appendChild(icon);
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    centerOnSelf(state);
  });
  group.appendChild(button);
  return {
    onAdd: () => group,
    onRemove: () => group.remove(),
  };
}

function createMap(maplibre: MapLibre, options: ChatroomMapOptions): MapState {
  const map = new maplibre.Map({
    container: options.container,
    style: CONFIG.CHATROOM_MAP_STYLE_URL,
    center: [0, 20],
    zoom: 2,
    attributionControl: false,
  });
  (options.container as HTMLElement & { __iinpublicMap?: MapLibreMap }).__iinpublicMap = map;
  map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(
    new maplibre.AttributionControl({
      compact: true,
      customAttribution:
        '<a href="https://openfreemap.org/" target="_blank" rel="noopener">OpenFreeMap</a> · ' +
        '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }),
  );

  let resolveReady!: () => void;
  let rejectReady!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const state: MapState = {
    map,
    markers: [],
    focusedChatroom: '',
    loaded: false,
    options,
    ready,
    userDotMarkers: [],
    userDotRequest: 0,
    awaitingSelfCenter: false,
  };
  stateByContainer.set(options.container, state);
  map.addControl(locateSelfControl(state), 'top-right');

  const failBeforeLoad = (event: { error?: unknown }): void => {
    if (!state.loaded) rejectReady(event.error || new Error('MapLibre style failed to load'));
  };
  map.once('error', failBeforeLoad);
  map.on('click', (event) => {
    // Room/cluster markers and user dots stop propagation, so this only fires on open map.
    handleMapTap(maplibre, state, event.lngLat.lat, event.lngLat.lng);
  });
  map.once('load', () => {
    state.loaded = true;
    state.talkConnections = new MapTalkConnections(map.getCanvasContainer());
    map.on('render', () => syncTalkConnections(state));
    state.broadcastEffects = new MapBroadcastEffects(options.container, () => mapEffectAnchors(state), () => state.options.userDots?.broadcastText, map.getCanvasContainer());
    map.on('remove', () => { state.broadcastEffects?.destroy(); state.talkConnections?.destroy(); });
    map.off('error', failBeforeLoad);
    map.on('error', (event) => {
      state.options.container.dataset.mapError = String(event.error?.message || event.error || 'unknown');
    });
    let refreshRetry = 0;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const refreshMarkers = (): void => {
      if (!map.getSource(SOURCE_ID)) return;
      if (refreshTimer) clearTimeout(refreshTimer);
      const renderedCount = rebuildHtmlMarkers(maplibre, state);
      // GeoJSON clustering runs in MapLibre's worker. On a cold lazy chunk, the source can
      // become queryable shortly after the first style/source events, so use a short bounded
      // readiness retry instead of leaving the map blank if those first events race.
      if (renderedCount === 0 && refreshRetry < 40) {
        refreshRetry++;
        refreshTimer = setTimeout(refreshMarkers, 50);
      } else {
        refreshRetry = 0;
        refreshTimer = undefined;
      }
    };
    // Register before addSource so the first fast in-memory GeoJSON load event cannot be missed.
    // Only my room source: basemap tiles fire `sourcedata` constantly while they load.
    map.on('sourcedata', (event: { sourceId?: string }) => { if (event.sourceId === SOURCE_ID) refreshMarkers(); });
    map.on('idle', refreshMarkers);
    map.on('moveend', refreshMarkers);
    map.on('moveend', () => scheduleUserDots(maplibre, state));
    map.on('resize', () => scheduleUserDots(maplibre, state));
    map.addSource(USER_REGION_SOURCE_ID, { type: 'geojson', data: regionGeoJson([]) });
    map.addLayer({
      id: 'iinpublic-user-region-fill', type: 'fill', source: USER_REGION_SOURCE_ID,
      paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.05 },
    });
    map.addLayer({
      id: 'iinpublic-user-region-outline', type: 'line', source: USER_REGION_SOURCE_ID,
      paint: { 'line-color': '#2563eb', 'line-width': 2, 'line-dasharray': [3, 2] },
    });
    // Where the crowd is: the hub's anonymous headcount per cell, drawn as heat.
    map.addSource(USER_DENSITY_SOURCE_ID, { type: 'geojson', data: densityGeoJson([]) as never });
    map.addLayer({
      id: 'iinpublic-user-density-heat',
      type: 'heatmap',
      source: USER_DENSITY_SOURCE_ID,
      paint: {
        'heatmap-weight': ['interpolate', ['linear'], ['get', 'count'], 1, 0.5, 10, 0.9, 100, 1],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1.5, 10, 2.5, 14, 3],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 26, 8, 36, 14, 46],
        'heatmap-opacity': 0.75,
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(250, 204, 21, 0)',
          0.2, 'rgba(250, 204, 21, 0.55)',
          0.5, 'rgba(249, 115, 22, 0.7)',
          0.8, 'rgba(220, 38, 38, 0.8)',
          1, 'rgba(153, 27, 27, 0.85)',
        ],
      },
    });
    const initialData = chatroomsToGeoJson(clusteredRooms(state.options), state.options.currentChatroom);
    state.options.container.dataset.mapGeojsonFeatureCount = String(initialData.features.length);
    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: initialData,
      cluster: true,
      clusterMaxZoom: 12,
      clusterRadius: 60,
    });
    state.options.container.dataset.mapClustering = 'true';
    map.addLayer({
      id: CLUSTER_LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#0f766e',
        'circle-radius': ['step', ['get', 'point_count'], 21, 20, 25, 100, 30],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 3,
      },
    });
    map.addLayer({
      id: ROOM_LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': ['case', ['get', 'current'], '#16803c', '#2563eb'],
        'circle-radius': 17,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 3,
      },
    });
    refreshMarkers();
    focusCurrentRoom(state);
    resolveReady();
  });

  return state;
}

function mapEffectAnchors(state: MapState): MapEffectAnchors {
  const result: MapEffectAnchors = { peers: new Map(), nearby: [] };
  for (const group of state.userDotGroups ?? []) {
    const position = group.displayPoint ?? group;
    const pixel = state.map.project([position.longitude, position.latitude]);
    const point = { x: pixel.x + (group.offset?.[0] ?? 0), y: pixel.y + (group.offset?.[1] ?? 0) };
    if (group.kind === 'self') result.self = point;
    else {
      for (const userId of group.userIds) result.peers.set(userId, point);
      if (group.kind === 'room') result.nearby.push(point);
    }
  }
  return result;
}

function syncBroadcastEffects(state: MapState): void {
  state.broadcastEffects?.sync((state.options.broadcastEvents ?? []).filter((event) => event.roomId === state.options.currentChatroom));
}

function syncTalkConnections(state: MapState): void {
  const card = state.options.roomMemberCard;
  const nav = card?.navigation;
  const source = state.options.userDots;
  if (!card || !nav || !source || state.map.getZoom() < 14 || !isMapOnScreen(state.options.container)) {
    state.talkConnections?.clear(); return;
  }
  const anchors = mapEffectAnchors(state);
  if (!anchors.self) { state.talkConnections?.clear(); return; }
  const { clientWidth: width, clientHeight: height } = state.options.container;
  const links: MapTalkConnection[] = [];
  for (const group of state.userDotGroups ?? []) {
    if (group.kind === 'self' || group.count !== 1 || group.userIds.length !== 1) continue;
    const peerId = group.userIds[0]!;
    const count = source.talkIdsByPeer?.get(peerId)?.length ?? 0;
    const to = anchors.peers.get(peerId);
    if (!count || !to || to.x < 0 || to.y < 0 || to.x > width || to.y > height) continue;
    if (Math.hypot(to.x - anchors.self.x, to.y - anchors.self.y) < 64) continue;
    links.push({ peerId, count, name: card.describe(peerId).stageName, from: anchors.self, to });
  }
  // Bound dense views; count-first order keeps the strongest exchange histories discoverable.
  links.sort((a, b) => b.count - a.count || a.peerId.localeCompare(b.peerId));
  const obstacles = [...anchors.peers.values(), anchors.self];
  const place = currentPlaceLocation(state);
  if (place) {
    const pin = state.map.project([place.longitude, place.latitude]);
    obstacles.push({ x: pin.x, y: pin.y - 36 });
  }
  state.talkConnections?.sync(links.slice(0, 12), { count: nav.countText, with: nav.withText, open: nav.talksText }, (id, name) => {
    clearSelection(state); state.awaitingListFit = false; nav.talks(id, name);
  }, obstacles);
}

function regionGeoJson(boundary: [number, number][]): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  return {
    type: 'FeatureCollection',
    features: boundary.length ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [boundary] } }] : [],
  };
}

function densityGeoJson(cells: ReadonlyArray<MapDensityCell>) {
  return {
    type: 'FeatureCollection' as const,
    features: cells.map((cell) => ({
      type: 'Feature' as const,
      properties: { count: cell.count },
      geometry: { type: 'Point' as const, coordinates: [cell.longitude, cell.latitude] },
    })),
  };
}

function clearUserDots(state: MapState): void {
  state.userDotRequest++;
  state.broadcastEffects?.clear();
  state.talkConnections?.clear();
  state.userDotGroups = [];
  (state.map.getSource(USER_REGION_SOURCE_ID) as import('maplibre-gl').GeoJSONSource | undefined)?.setData(regionGeoJson([]));
  if (state.userDotTimer) clearTimeout(state.userDotTimer);
  state.userDotTimer = undefined;
  state.userDotMarkers.forEach((marker) => marker.remove());
  state.userDotMarkers = [];
  state.userDotSignature = undefined;
  (state.map.getSource(USER_DENSITY_SOURCE_ID) as import('maplibre-gl').GeoJSONSource | undefined)
    ?.setData(densityGeoJson([]) as never);
  const legend = state.options.container.querySelector<HTMLElement>('.chatroom-map-user-legend');
  if (legend) {
    hideTransientMapHint(legend);
    legend.remove();
  }
}

/** Debounced: a pan or zoom settles before the visible area is queried. */
function scheduleUserDots(maplibre: MapLibre, state: MapState, delayMs = 400): void {
  if (!state.options.userDots) {
    clearUserDots(state);
    return;
  }
  if (state.userDotTimer) clearTimeout(state.userDotTimer);
  state.userDotTimer = setTimeout(() => {
    state.userDotTimer = undefined;
    void refreshUserDots(maplibre, state);
  }, delayMs);
}

/** Overview mode must keep the world-map context visible: far yellow dots show the broader
 * nearby audience before the map tightens around the local cluster. At the true world scale the
 * map still needs to show these out-of-range peers, otherwise a wide-view demo collapses to just
 * green in-range members. */
const STRANGER_DOT_MIN_ZOOM = 0.5;

function userDotElement(source: MapUserDots, group: UserDotGroup, onTap?: () => void, card?: RoomMemberCardSource, onDoubleTap?: () => void): HTMLElement {
  const element = document.createElement('div');
  element.className = `chatroom-map-user-dot chatroom-map-user-dot-${group.kind}`;
  element.dataset.testid = `map-user-dot-${group.kind}`;
  element.setAttribute('data-testid', `map-user-dot-${group.kind}`);
  element.dataset.count = String(group.count);
  let label = group.kind === 'self'
    ? source.selfText
    : group.kind === 'room' ? source.roomText(group.count) : source.otherText(group.count);
  if (group.userIds.length === 1) element.dataset.userId = group.userIds[0]!;
  if (group.matchCount) {
    const name = card?.describe(group.userIds[0]!).stageName;
    label = [name, card?.matchText?.(group.matchCount) ?? `${group.matchCount} ${card?.text.matched ?? ''}`].filter(Boolean).join(' · ');
    element.dataset.matchCount = String(group.matchCount);
    element.classList.add('chatroom-map-user-dot-matched');
  }
  element.title = label;
  element.setAttribute('aria-label', label);
  element.setAttribute('role', onTap ? 'button' : 'img');
  if (onTap) {
    element.tabIndex = 0;
    element.addEventListener('pointerdown', (event) => event.stopPropagation());
    element.addEventListener('dblclick', (event) => {
      event.preventDefault(); event.stopPropagation(); onDoubleTap?.();
    });
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        onTap();
      }
    });
    element.addEventListener('click', (event) => {
      event.stopPropagation();
      onTap();
    });
  }
  element.textContent = group.kind === 'self' ? '★' : group.matchCount ? `♥ ${group.matchCount}` : group.count > 1 ? `👥 ${group.count}` : '';
  // ✈ badge: everyone at this dot is a Traveler (a chosen point, not blurred GPS).
  if (group.travelers > 0 && group.travelers === group.count) {
    element.dataset.traveler = 'true';
    const badge = document.createElement('span');
    badge.className = 'chatroom-map-user-dot-traveler';
    badge.textContent = '✈';
    element.appendChild(badge);
  }
  return element;
}

function ensureUserDotLegend(state: MapState, source: MapUserDots): void {
  let legend = state.options.container.querySelector<HTMLElement>('.chatroom-map-user-legend');
  if (!legend) {
    legend = document.createElement('div');
    legend.className = 'chatroom-map-user-legend';
    legend.setAttribute('data-testid', 'map-user-legend');
    for (const [kind, text] of [['self', source.legendText.self], ['room', source.legendText.room], ['other', source.legendText.other]] as const) {
      const row = document.createElement('span');
      const swatch = document.createElement('span');
      swatch.className = `chatroom-map-user-dot chatroom-map-user-dot-${kind} chatroom-map-user-legend-swatch`;
      swatch.textContent = kind === 'self' ? '★' : '';
      row.append(swatch, document.createTextNode(text));
      legend.appendChild(row);
    }
    state.options.container.appendChild(legend);
  }
  const session = state.options.userLegendHintSession;
  if (session === undefined) {
    legend.hidden = false;
    return;
  }
  if (legend.dataset.hintSession !== String(session)) {
    legend.dataset.hintSession = String(session);
    showTransientMapHint(legend);
  }
}

/**
 * The room list re-renders the map on every headcount callback; on a phone each dot query is a
 * request through the embedded node (about one every 1.5 s while idle, measured 2026-10-18).
 */
const USER_DOT_REUSE_MS = 20_000;

async function refreshUserDots(maplibre: MapLibre, state: MapState): Promise<void> {
  const source = state.options.userDots;
  if (!source) return;
  const request = ++state.userDotRequest;
  const view = state.map.getBounds();
  let dots: MapPresenceDot[] = [];
  let density: MapDensityCell[] = [];
  const bounds = {
    west: Math.max(-180, view.getWest()),
    south: Math.max(-90, view.getSouth()),
    east: Math.min(180, view.getEast()),
    north: Math.min(90, view.getNorth()),
  };
  const key = JSON.stringify([state.options.currentChatroom, source.selfPoint, Object.values(bounds).map((value) => value.toFixed(4))]);
  const cached = state.userDotCache;
  if (cached && cached.key === key && Date.now() - cached.at < USER_DOT_REUSE_MS) {
    // Same view, recent answer: redraw with the current roster without asking the hub again.
    ({ dots, density } = cached);
  } else {
    try {
      ({ dots, density } = await source.load(bounds));
      state.userDotCache = { key, at: Date.now(), dots, density };
    } catch {
      dots = [];
      density = [];
    }
  }
  if (request !== state.userDotRequest || stateByContainer.get(state.options.container) !== state) return;
  const showStrangers = state.map.getZoom() >= STRANGER_DOT_MIN_ZOOM;
  const { groups: laidOut, boundary } = layoutMapUsers(source, dots, {
    zoom: state.map.getZoom(),
    project: (point) => state.map.project(point),
    unproject: (point) => state.map.unproject(point),
  }, currentPlaceLocation(state));
  const groups = laidOut.filter((group) => showStrangers || group.kind !== 'other' || group.displayPoint);
  state.userDotGroups = groups;
  syncTalkConnections(state);
  const signature = JSON.stringify([groups, density, boundary]);
  if (signature === state.userDotSignature && state.userDotMarkers.length === groups.length) {
    ensureUserDotLegend(state, source);
    syncBroadcastEffects(state);
    return;
  }
  state.userDotSignature = signature;
  state.userDotMarkers.forEach((marker) => marker.remove());
  // Green dot: who is it (card). Yellow dot: they are outside my room, so it is a tap on that point.
  const onTap = (group: UserDotGroup): (() => void) | undefined => {
    const card = state.options.roomMemberCard;
    if (group.kind === 'self' && card?.navigation) return () => showSelfCard(maplibre, state, group);
    if (group.matchCount && group.userIds.length === 1 && card?.contact) return () => {
      const userId = group.userIds[0]!;
      clearSelection(state);
      state.awaitingListFit = false;
      card.contact!(userId, card.describe(userId).stageName);
    };
    if (group.userIds.length && card) return () => {
      state.talkConnections?.select(group.count === 1 ? group.userIds[0] : undefined);
      showRoomMemberCard(maplibre, state, group);
    };
    if (group.kind === 'other') return () => handleMapTap(maplibre, state, group.latitude, group.longitude);
    return undefined;
  };
  const onDoubleTap = (group: UserDotGroup): (() => void) => () => {
    const card = state.options.roomMemberCard;
    clearSelection(state);
    state.awaitingListFit = false;
    if (group.kind === 'self') { card?.navigation?.me(); return; }
    if (group.count === 1 && group.userIds.length === 1 && card) {
      const id = group.userIds[0]!;
      (card.contact ?? card.profile)(id, card.describe(id).stageName);
      return;
    }
    const point = group.displayPoint ?? group;
    state.map.easeTo({ center: [point.longitude, point.latitude], zoom: Math.min(19, state.map.getZoom() + 2) });
  };
  state.userDotMarkers = groups.map((group) =>
    new maplibre.Marker({ element: userDotElement(source, group, onTap(group), state.options.roomMemberCard, onDoubleTap(group)), offset: group.offset ?? [0, 0] })
      .setLngLat([group.displayPoint?.longitude ?? group.longitude, group.displayPoint?.latitude ?? group.latitude])
      .addTo(state.map));
  (state.map.getSource(USER_DENSITY_SOURCE_ID) as import('maplibre-gl').GeoJSONSource | undefined)
    ?.setData(densityGeoJson(density) as never);
  (state.map.getSource(USER_REGION_SOURCE_ID) as import('maplibre-gl').GeoJSONSource | undefined)?.setData(regionGeoJson(boundary));
  ensureUserDotLegend(state, source);
  syncBroadcastEffects(state);
  state.options.container.dataset.userDotCount = String(dots.length);
  state.options.container.dataset.userDensityCells = String(density.length);
}

function isMapOnScreen(container: HTMLElement): boolean {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
  return container.isConnected && container.getClientRects().length > 0;
}

export async function renderChatroomMap(options: ChatroomMapOptions): Promise<void> {
  const isInitialRender = !stateByContainer.has(options.container);
  options.container.classList.remove('load-failed');
  if (isInitialRender) {
    options.container.classList.add('loading');
    options.container.setAttribute('aria-busy', 'true');
  }
  try {
    const maplibre = await loadMapLibre();
    if (!options.container.isConnected) return;
    let state = stateByContainer.get(options.container);
    if (!state) {
      options.container.textContent = '';
      state = createMap(maplibre, options);
    } else {
      if (state.options.currentChatroom !== options.currentChatroom) {
        clearSelection(state);
        state.broadcastEffects?.clear();
        state.talkConnections?.clear();
        state.userDotGroups = [];
      }
      state.options = options;
      // Not on screen (another tab, the list view, the page hidden): nothing to draw now. The next
      // render once it is shown uses these options.
      if (!isMapOnScreen(options.container)) { state.broadcastEffects?.clear(); return; }
    }
    await state.ready;
    updateSource(state);
    focusCurrentRoom(state);
    syncBroadcastEffects(state);
    scheduleUserDots(maplibre, state, 0);
    requestAnimationFrame(() => state.map.resize());
  } catch {
    const state = stateByContainer.get(options.container);
    if (state) {
      clearMarkers(state);
      clearUserDots(state);
      state.map.remove();
    }
    stateByContainer.delete(options.container);
    options.container.textContent = options.mapLoadFailedText;
    options.container.classList.add('load-failed');
  } finally {
    if (isInitialRender) {
      options.container.classList.remove('loading');
      options.container.removeAttribute('aria-busy');
    }
  }
}
