import { gridLayerForZoom, tileAtTap, tileGridLines, tileSquares } from '../../shared/room-tile-grid';
import { parseTileId } from '../../shared/room-tiles';
import type { FlatChatroomNode } from '../../shared/chatroom-hierarchy';
import { CONFIG } from '../../shared/config';
import {
  chatroomsToGeoJson,
  type ChatroomMapFeatureProperties,
} from '../../shared/chatroom-map-geojson';
import {
  getChatroomMapLocation,
  type ChatroomMapLocation,
} from '../../shared/chatroom-map-locations';

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
  /**
   * Tap on open map: select the tile (of the grid layer drawn at this zoom) under the tap; its
   * "Enter" button opens that room. Without it, taps do nothing.
   */
  openTile?: (tileId: string) => void;
  /** Display title for a tile room ("📍 Around San Diego"). */
  tileTitle?: (tileId: string) => string;
  /** Tile to shade as "you are here" (the current room's tile), if any. */
  currentTileId?: string;
  enterTileText?: string;
  mapLoadFailedText: string;
  membersText: (count: number) => string;
  visitsText: (count: number) => string;
};

type MapState = {
  map: MapLibreMap;
  markers: MapLibreMarker[];
  selectedTile?: string | undefined;
  selectionMarker?: MapLibreMarker | undefined;
  focusedChatroom: string;
  loaded: boolean;
  options: ChatroomMapOptions;
  ready: Promise<void>;
};

const SOURCE_ID = 'iinpublic-chatrooms';
const CLUSTER_LAYER_ID = 'iinpublic-chatroom-clusters';
const ROOM_LAYER_ID = 'iinpublic-chatroom-points';
const GRID_SOURCE_ID = 'iinpublic-tile-grid';
const CURRENT_TILE_SOURCE_ID = 'iinpublic-tile-current';
const SELECTED_TILE_SOURCE_ID = 'iinpublic-tile-selected';
const stateByContainer = new WeakMap<HTMLElement, MapState>();
let mapLibrePromise: Promise<MapLibre> | undefined;

function loadMapLibre(): Promise<MapLibre> {
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
          require('maplibre-gl/dist/maplibre-gl-worker.mjs?maplibreWorkerAsset') as string,
          window.location.href,
        );
        const sharedUrl = new URL(
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

/** Focus zoom per tree level, chosen so the grid drawn there is the room's own tile layer. */
function zoomForRoom(room: FlatChatroomNode | undefined): number {
  if (!room) return 2;
  return [2, 2.5, 4, 6, 9][Math.min(room.level, 4)] || 9;
}

/** Redraw the grid lines of the layer that fits the current zoom, over the visible area. */
function updateTileGrid(state: MapState): void {
  const source = state.map.getSource(GRID_SOURCE_ID) as import('maplibre-gl').GeoJSONSource | undefined;
  if (!source) return;
  const layer = gridLayerForZoom(state.map.getZoom());
  const b = state.map.getBounds();
  const lines = tileGridLines(layer, { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
  source.setData(lines as never);
  state.options.container.dataset.gridLayer = String(layer);
  state.options.container.dataset.gridLineCount = String(lines.features.length);
}

function updateCurrentTile(state: MapState): void {
  const source = state.map.getSource(CURRENT_TILE_SOURCE_ID) as import('maplibre-gl').GeoJSONSource | undefined;
  source?.setData(tileSquares(state.options.currentTileId ? [state.options.currentTileId] : []) as never);
}

function clearTileSelection(state: MapState): void {
  state.selectionMarker?.remove();
  state.selectionMarker = undefined;
  state.selectedTile = undefined;
  delete state.options.container.dataset.selectedTile;
  const source = state.map.getSource(SELECTED_TILE_SOURCE_ID) as import('maplibre-gl').GeoJSONSource | undefined;
  source?.setData(tileSquares([]) as never);
}

/** Highlight the tapped tile and offer to enter it (a label with an Enter button at the tap). */
function selectTile(maplibre: MapLibre, state: MapState, tileId: string, at: [number, number]): void {
  clearTileSelection(state);
  state.selectedTile = tileId;
  state.options.container.dataset.selectedTile = tileId;
  const source = state.map.getSource(SELECTED_TILE_SOURCE_ID) as import('maplibre-gl').GeoJSONSource | undefined;
  source?.setData(tileSquares([tileId]) as never);

  const card = document.createElement('div');
  card.className = 'chatroom-map-tile-card';
  card.dataset.testid = 'map-tile-card';
  card.setAttribute('data-testid', 'map-tile-card');
  const name = document.createElement('strong');
  name.textContent = state.options.tileTitle?.(tileId) ?? tileId;
  const enter = document.createElement('button');
  enter.type = 'button';
  enter.className = 'chatroom-map-tile-enter';
  enter.setAttribute('data-testid', 'map-tile-enter');
  enter.textContent = state.options.enterTileText ?? 'Enter ›';
  enter.addEventListener('click', (event) => {
    event.stopPropagation();
    const id = state.selectedTile;
    clearTileSelection(state);
    if (id) state.options.openTile?.(id);
  });
  card.addEventListener('click', (event) => event.stopPropagation());
  card.append(name, enter);
  state.selectionMarker = new maplibre.Marker({ element: card, anchor: 'bottom' }).setLngLat(at).addTo(state.map);
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

function roomMarkerElement(options: ChatroomMapOptions, room: ChatroomMapRoom): HTMLButtonElement {
  const marker = document.createElement('button');
  marker.type = 'button';
  marker.className = `chatroom-map-marker${room.id === options.currentChatroom ? ' current-room' : ''}`;
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
  const marker = new maplibre.Marker({ element: roomMarkerElement(state.options, currentRoom) })
    .setLngLat([focus.longitude, focus.latitude])
    .addTo(state.map);
  state.markers.push(marker);
}

function rebuildHtmlMarkers(maplibre: MapLibre, state: MapState): number {
  if (!state.loaded) return 0;
  clearMarkers(state);
  const roomsById = new Map(state.options.rooms.map((room) => [room.id, room]));
  const seen = new Set<string>();

  const renderedFeatures = state.map.queryRenderedFeatures({
    layers: [CLUSTER_LAYER_ID, ROOM_LAYER_ID],
  });
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
  source?.setData(chatroomsToGeoJson(clusteredRooms(state.options), state.options.currentChatroom));
}

function focusCurrentRoom(state: MapState): void {
  if (state.options.currentChatroom === state.focusedChatroom) return;
  state.focusedChatroom = state.options.currentChatroom;
  const currentRoom = state.options.rooms.find((room) => room.id === state.options.currentChatroom);
  const focus = currentRoom ? roomLocation(currentRoom, state.options.rooms) : undefined;
  state.map.jumpTo({
    center: focus ? [focus.longitude, focus.latitude] : [0, 20],
    zoom: zoomForRoom(currentRoom),
  });
}

function createMap(maplibre: MapLibre, options: ChatroomMapOptions): MapState {
  const map = new maplibre.Map({
    container: options.container,
    style: CONFIG.CHATROOM_MAP_STYLE_URL,
    center: [0, 20],
    zoom: 2,
    attributionControl: false,
  });
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
  };
  stateByContainer.set(options.container, state);

  const failBeforeLoad = (event: { error?: unknown }): void => {
    if (!state.loaded) rejectReady(event.error || new Error('MapLibre style failed to load'));
  };
  map.once('error', failBeforeLoad);
  map.on('click', (event) => {
    // Room/cluster markers stop propagation, so this only fires on open map.
    if (!state.options.openTile) return;
    selectTile(maplibre, state, tileAtTap(event.lngLat.lat, event.lngLat.lng, map.getZoom()), [event.lngLat.lng, event.lngLat.lat]);
  });
  map.once('load', () => {
    state.loaded = true;
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
    map.on('sourcedata', refreshMarkers);
    map.on('idle', refreshMarkers);
    map.on('moveend', refreshMarkers);
    if (state.options.openTile || state.options.currentTileId) {
      // Compatibility path for legacy callers. The Nearby + Places UI omits `openTile`, so its
      // map contains meaningful Place pins without exposing the retired geographic room tree.
      map.addSource(GRID_SOURCE_ID, { type: 'geojson', data: tileGridLines(1, { west: -180, south: -85, east: 180, north: 85 }) as never });
      map.addSource(CURRENT_TILE_SOURCE_ID, { type: 'geojson', data: tileSquares([]) as never });
      map.addSource(SELECTED_TILE_SOURCE_ID, { type: 'geojson', data: tileSquares([]) as never });
      map.addLayer({ id: 'iinpublic-tile-current-fill', type: 'fill', source: CURRENT_TILE_SOURCE_ID, paint: { 'fill-color': '#16a34a', 'fill-opacity': 0.12 } });
      map.addLayer({ id: 'iinpublic-tile-current-line', type: 'line', source: CURRENT_TILE_SOURCE_ID, paint: { 'line-color': '#16803c', 'line-width': 2, 'line-opacity': 0.7 } });
      map.addLayer({ id: 'iinpublic-tile-selected-fill', type: 'fill', source: SELECTED_TILE_SOURCE_ID, paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.14 } });
      map.addLayer({ id: 'iinpublic-tile-selected-line', type: 'line', source: SELECTED_TILE_SOURCE_ID, paint: { 'line-color': '#2563eb', 'line-width': 2 } });
      map.addLayer({ id: 'iinpublic-tile-grid-line', type: 'line', source: GRID_SOURCE_ID, paint: { 'line-color': '#475569', 'line-width': 1, 'line-opacity': 0.35 } });
      map.on('moveend', () => updateTileGrid(state));
      map.on('zoomend', () => {
        if (state.selectedTile && parseTileId(state.selectedTile)?.layer !== gridLayerForZoom(map.getZoom())) clearTileSelection(state);
      });
    }

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
    updateCurrentTile(state);
    updateTileGrid(state);
    resolveReady();
  });

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
    const maplibre = await loadMapLibre();
    if (!options.container.isConnected) return;
    let state = stateByContainer.get(options.container);
    if (!state) {
      options.container.textContent = '';
      state = createMap(maplibre, options);
    } else {
      state.options = options;
    }
    await state.ready;
    updateSource(state);
    updateCurrentTile(state);
    focusCurrentRoom(state);
    updateTileGrid(state);
    requestAnimationFrame(() => state.map.resize());
  } catch {
    const state = stateByContainer.get(options.container);
    if (state) {
      clearMarkers(state);
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
