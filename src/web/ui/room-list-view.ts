import { getFlatChatroomList } from '../../shared/chatroom-hierarchy';
import { getChatroomMapLocation } from '../../shared/chatroom-map-locations';
import { bearingDegrees, metersBetween, type ActiveRoomSort, type ActiveRoomSummary, type ActiveRoomsView } from '../../shared/active-rooms';
import type { UiTranslationKey } from './ui-translations';
import { formatDistance } from './distance-units';
import { otherRoomColor } from './chatroom-map-view';
import { isPlaceRoomId } from '../../shared/place-rooms';

/**
 * A room row in the flat list (and a pin on the map). A Nearby group is named by where it is from
 * you ("0.6 mi W"), with the nearest big city as context; a Place by its own name.
 */
export type RoomListRow = ActiveRoomSummary & {
  displayName: string;
  /** Second line: "near San Diego" for a Nearby group, "Place · 0.6 mi W" for a Place. */
  context: string;
  /** Places keep their type icon (🏪 / 💬); Nearby rows have none — it would carry no meaning. */
  icon: string;
  full: boolean;
};

type T = (key: UiTranslationKey) => string;

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const CITY_RADIUS_METERS = 150_000;

/**
 * "near San Diego": the nearest city in the app's built-in city table (src/shared/chatroom-hierarchy.ts)
 * within 150 km of the room's position; otherwise the rounded coordinates. Big cities only — it is
 * context, not a room name.
 */
export function nearbyRoomName(latitude: number, longitude: number, t: T): string {
  let best: { name: string; distance: number } | null = null;
  for (const node of getFlatChatroomList()) {
    if (node.hasChildren) continue;
    const at = getChatroomMapLocation(node.id);
    if (!at) continue;
    const distance = metersBetween({ latitude, longitude }, at);
    if (distance <= CITY_RADIUS_METERS && (!best || distance < best.distance)) best = { name: node.name, distance };
  }
  const place = best?.name
    ?? `${Math.abs(latitude).toFixed(1)}°${latitude >= 0 ? 'N' : 'S'} ${Math.abs(longitude).toFixed(1)}°${longitude >= 0 ? 'E' : 'W'}`;
  return t('roomListAround').replace('{place}', place);
}

/** "0.6 mi W" from the viewer, or "Here" within 500 m. */
export function relativeRoomLabel(room: Pick<ActiveRoomSummary, 'distanceMeters' | 'bearingDegrees'>, t: T): string | undefined {
  if (room.distanceMeters === undefined) return undefined;
  if (room.distanceMeters < 500) return t('roomListHere');
  return `${formatDistance(room.distanceMeters)} ${COMPASS[Math.round((room.bearingDegrees ?? 0) / 45) % 8]}`;
}

/**
 * Name every room and mark full ones. Two rows that would read the same get " · 2", " · 3"… so
 * they can be told apart without exposing any room id.
 */
export function roomListRows(
  view: ActiveRoomsView,
  input: { t: T; capacity: number; currentRoomId: string; currentName: string; placeIcon?: (roomId: string) => string },
): RoomListRow[] {
  const seen = new Map<string, number>();
  return view.rooms.map((room) => {
    const relative = relativeRoomLabel(room, input.t);
    const city = room.latitude !== undefined && room.longitude !== undefined
      ? nearbyRoomName(room.latitude, room.longitude, input.t)
      : '';
    const base = room.roomId === input.currentRoomId
      ? input.currentName
      : room.kind === 'place'
        ? room.name || input.t('roomListPlaceFallback')
        : relative || input.t('roomListNearbyFallback');
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return {
      ...room,
      displayName: count > 1 ? `${base} · ${count}` : base,
      context: room.kind === 'place'
        ? [input.t('roomListPlaceTag'), relative].filter(Boolean).join(' · ')
        : city,
      icon: room.kind === 'place' ? input.placeIcon?.(room.roomId) ?? '💬' : '',
      full: room.memberCount >= input.capacity,
    };
  });
}

/**
 * Places in the room list that the local catalogue does not know yet and have not already
 * triggered a refresh. The catalogue loads at boot; without this, a Place someone else made later
 * vanishes from "Places near you" once it empties (found by tests/e2e/phone-path/01).
 */
export function placesMissingFromCatalogue(
  listedRoomIds: Iterable<string>,
  catalogueIds: ReadonlySet<string>,
  alreadyRefreshedFor: ReadonlySet<string>,
): string[] {
  return [...listedRoomIds].filter((roomId) =>
    isPlaceRoomId(roomId) && !catalogueIds.has(roomId) && !alreadyRefreshedFor.has(roomId));
}

/** How many empty Places "Places near you" lists (docs/design/nearby-and-place-chatrooms.md §4.2). */
export const EMPTY_PLACES_NEAR_LIMIT = 5;

/**
 * "Places near you": the nearest live Places nobody is in right now, so an empty Place can still be
 * entered from the list. The hub lists only live Places, so every row here is live.
 */
export function emptyPlaceRows(
  places: ReadonlyArray<{ id: string; name: string; type?: string; location?: { latitude: number; longitude: number } }>,
  input: {
    t: T;
    origin?: { latitude: number; longitude: number };
    /** Rooms already shown (the current room and rooms with people). */
    excludeIds: ReadonlySet<string>;
    memberCount: (roomId: string) => number;
    placeIcon: (type: string | undefined) => string;
  },
): RoomListRow[] {
  const rows = places
    .filter((place) => place.location && !input.excludeIds.has(place.id) && input.memberCount(place.id) === 0)
    .map((place) => {
      const at = place.location!;
      const distanceMeters = input.origin ? metersBetween(input.origin, at) : undefined;
      const summary: ActiveRoomSummary = {
        roomId: place.id,
        kind: 'place',
        memberCount: 0,
        latitude: at.latitude,
        longitude: at.longitude,
        name: place.name,
        ...(distanceMeters !== undefined ? { distanceMeters, bearingDegrees: bearingDegrees(input.origin!, at) } : {}),
      };
      return {
        ...summary,
        displayName: place.name || input.t('roomListPlaceFallback'),
        context: [input.t('roomListPlaceTag'), relativeRoomLabel(summary, input.t)].filter(Boolean).join(' · '),
        icon: input.placeIcon(place.type),
        full: false,
      };
    });
  rows.sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity));
  return rows.slice(0, EMPTY_PLACES_NEAR_LIMIT);
}

/** "1 / 3 people" (· "Full"). */
export function roomMetaText(row: RoomListRow, capacity: number, t: T): string {
  const people = t('roomListPeople').replace('{count}', String(row.memberCount)).replace('{capacity}', String(capacity));
  return row.full ? `${people} · ${t('roomListFull')}` : people;
}

/** Header: everyone online, how many rooms, and the sort choice. */
export function renderRoomListHeader(view: ActiveRoomsView | undefined, sort: ActiveRoomSort, t: T): string {
  const total = view ? t('roomListOnline')
    .replace('{people}', view.totalOnline.toLocaleString('en-US'))
    .replace('{rooms}', view.totalRooms.toLocaleString('en-US')) : t('roomListLoading');
  const option = (value: ActiveRoomSort, key: UiTranslationKey) =>
    `<option value="${value}" ${sort === value ? 'selected' : ''}>${t(key)}</option>`;
  return `<div class="room-list-header" data-testid="room-list-header">
      <span class="room-list-total" data-testid="room-list-total">${total}</span>
      <label class="room-list-sort">${t('roomListSort')}
        <select id="room-list-sort" data-testid="room-list-sort">
          ${option('nearest', 'roomListSortNearest')}
          ${option('busiest', 'roomListSortBusiest')}
          ${option('most-room', 'roomListSortMostRoom')}
        </select>
      </label>
    </div>`;
}

/** One row; full rooms are shown but cannot be entered. */
export function renderRoomListRow(row: RoomListRow, capacity: number, t: T, escapeHtml: (value: string) => string): string {
  // Same colour as the room's square on the map, so list and map line up.
  const stripe = row.kind === 'nearby' ? ` style="border-left: 5px solid ${otherRoomColor(row.roomId)}"` : '';
  return `<div class="chatroom-item room-list-row ${row.full ? 'room-list-full' : ''}"${stripe}
       data-chatroom-id="${escapeHtml(row.roomId)}"
       data-room-kind="${row.kind === 'place' ? 'place' : 'nearby-other'}"
       data-testid="room-list-row"
       ${row.latitude !== undefined ? `data-lat="${row.latitude}" data-lng="${row.longitude}"` : ''}
       ${row.full ? 'aria-disabled="true"' : 'role="button" tabindex="0"'}>
      ${row.icon ? `<div class="chatroom-icon">${row.icon}</div>` : ''}
      <div class="chatroom-info">
        <div class="chatroom-name">${escapeHtml(row.displayName)}</div>
        ${row.context ? `<div class="chatroom-description">${escapeHtml(row.context)}</div>` : ''}
        <div class="chatroom-flat-metrics"><span class="chatroom-headcount">${escapeHtml(roomMetaText(row, capacity, t))}</span></div>
      </div>
      <div class="chatroom-arrow">${row.full ? '' : '›'}</div>
    </div>`;
}
