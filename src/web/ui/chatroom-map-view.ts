import type { FlatChatroomNode } from '../../shared/chatroom-hierarchy';
import {
  getChatroomMapLocation,
  type ChatroomMapLocation,
} from '../../shared/chatroom-map-locations';

type Leaflet = typeof import('leaflet');
type LeafletMap = import('leaflet').Map;
type LeafletLayerGroup = import('leaflet').LayerGroup;

export type ChatroomMapRoom = FlatChatroomNode & {
  memberCount: number;
  visitCount: number;
  uniqueVisitorCount: number;
};

type ChatroomMapOptions = {
  container: HTMLElement;
  rooms: ReadonlyArray<ChatroomMapRoom>;
  currentChatroom: string;
  openChatroom: (chatroomId: string) => void;
  mapLoadFailedText: string;
  membersText: (count: number) => string;
  visitsText: (count: number) => string;
};

type MapState = {
  map: LeafletMap;
  markers: LeafletLayerGroup;
  focusedChatroom: string;
};

const stateByContainer = new WeakMap<HTMLElement, MapState>();
let leafletPromise: Promise<Leaflet> | undefined;

function loadLeaflet(): Promise<Leaflet> {
  if (!leafletPromise) {
    leafletPromise = Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')])
      .then(([leaflet]) => leaflet)
      .catch((error: unknown) => {
        // A temporary chunk/network failure should not permanently disable Map view.
        leafletPromise = undefined;
        throw error;
      });
  }
  return leafletPromise;
}

function roomLocation(
  room: FlatChatroomNode,
  rooms: ReadonlyArray<FlatChatroomNode>,
): ChatroomMapLocation | undefined {
  if (room.id === 'global') return { latitude: 20, longitude: 0 };
  const direct = getChatroomMapLocation(room.id);
  if (direct) return direct;

  const childrenByParent = new Map<string, FlatChatroomNode[]>();
  rooms.forEach((candidate) => {
    if (!candidate.parentId) return;
    const children = childrenByParent.get(candidate.parentId) || [];
    children.push(candidate);
    childrenByParent.set(candidate.parentId, children);
  });

  const descendantLocations: ChatroomMapLocation[] = [];
  const collect = (parentId: string): void => {
    (childrenByParent.get(parentId) || []).forEach((child) => {
      const location = getChatroomMapLocation(child.id);
      if (location) descendantLocations.push(location);
      else collect(child.id);
    });
  };
  collect(room.id);
  if (descendantLocations.length === 0) return undefined;

  return {
    latitude: descendantLocations.reduce((sum, point) => sum + point.latitude, 0) / descendantLocations.length,
    longitude: descendantLocations.reduce((sum, point) => sum + point.longitude, 0) / descendantLocations.length,
  };
}

function zoomForRoom(room: FlatChatroomNode | undefined): number {
  if (!room) return 2;
  return [2, 3, 4, 6, 10][Math.min(room.level, 4)] || 10;
}

function markerTooltip(options: ChatroomMapOptions, room: ChatroomMapRoom): HTMLElement {
  const tooltip = document.createElement('div');
  tooltip.className = 'chatroom-map-tooltip';
  const name = document.createElement('strong');
  name.textContent = `${room.icon} ${room.name}`;
  const metrics = document.createElement('span');
  metrics.textContent = `${options.membersText(room.memberCount)} · ${options.visitsText(room.visitCount)}`;
  tooltip.append(name, metrics);
  return tooltip;
}

function makeMarkerIcon(leaflet: Leaflet, room: ChatroomMapRoom, isCurrent: boolean): import('leaflet').DivIcon {
  const countLabel = room.memberCount > 99 ? '99+' : String(room.memberCount);
  return leaflet.divIcon({
    className: `chatroom-map-marker${isCurrent ? ' current-room' : ''}`,
    html: `<span aria-hidden="true">${countLabel}</span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

function createMap(leaflet: Leaflet, container: HTMLElement): MapState {
  const map = leaflet.map(container, {
    worldCopyJump: true,
    zoomControl: true,
    attributionControl: true,
  }).setView([20, 0], 2);
  leaflet.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);
  const markers = leaflet.layerGroup().addTo(map);
  const state = { map, markers, focusedChatroom: '' };
  stateByContainer.set(container, state);
  return state;
}

/** Render public room locations. No user coordinates are accepted by this API. */
export async function renderChatroomMap(options: ChatroomMapOptions): Promise<void> {
  const isInitialRender = !stateByContainer.has(options.container);
  options.container.classList.remove('load-failed');
  if (isInitialRender) {
    options.container.classList.add('loading');
    options.container.setAttribute('aria-busy', 'true');
  }
  try {
    const leaflet = await loadLeaflet();
    if (!options.container.isConnected) return;
    let state = stateByContainer.get(options.container);
    if (!state) {
      options.container.textContent = '';
      state = createMap(leaflet, options.container);
    }
    state.markers.clearLayers();

    const geographicRooms = options.rooms.filter((room) => !!getChatroomMapLocation(room.id));
    geographicRooms.forEach((room) => {
      const point = getChatroomMapLocation(room.id);
      if (!point) return;
      const isCurrent = room.id === options.currentChatroom;
      const marker = leaflet.marker([point.latitude, point.longitude], {
        alt: room.name,
        title: room.name,
        keyboard: true,
        riseOnHover: true,
        icon: makeMarkerIcon(leaflet, room, isCurrent),
      });
      marker.bindTooltip(markerTooltip(options, room), { direction: 'top', offset: [0, -14] });
      marker.on('click', () => options.openChatroom(room.id));
      marker.addTo(state.markers);
    });

    const currentRoom = options.rooms.find((room) => room.id === options.currentChatroom);
    const focus = currentRoom ? roomLocation(currentRoom, options.rooms) : undefined;
    if (currentRoom && focus && !getChatroomMapLocation(currentRoom.id)) {
      const currentMarker = leaflet.marker([focus.latitude, focus.longitude], {
        alt: currentRoom.name,
        title: currentRoom.name,
        keyboard: true,
        riseOnHover: true,
        zIndexOffset: 1000,
        icon: makeMarkerIcon(leaflet, currentRoom, true),
      });
      currentMarker.bindTooltip(markerTooltip(options, currentRoom), { direction: 'top', offset: [0, -14] });
      currentMarker.on('click', () => options.openChatroom(currentRoom.id));
      currentMarker.addTo(state.markers);
    }
    if (options.currentChatroom !== state.focusedChatroom) {
      state.focusedChatroom = options.currentChatroom;
      state.map.setView(
        focus ? [focus.latitude, focus.longitude] : [20, 0],
        zoomForRoom(currentRoom),
      );
    }
    requestAnimationFrame(() => state.map.invalidateSize());
  } catch {
    options.container.textContent = options.mapLoadFailedText;
    options.container.classList.add('load-failed');
  } finally {
    if (isInitialRender) {
      options.container.classList.remove('loading');
      options.container.removeAttribute('aria-busy');
    }
  }
}
