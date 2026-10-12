import { getFlatChatroomList } from '../../shared/chatroom-hierarchy';
import { getChatroomMapLocation } from '../../shared/chatroom-map-locations';
import { metersBetween, type ActiveRoomSort, type ActiveRoomSummary, type ActiveRoomsView } from '../../shared/active-rooms';
import type { UiTranslationKey } from './ui-translations';
import { formatDistance } from './distance-units';

/** A room row in the flat list (and a pin on the map), with its display name and meta line. */
export type RoomListRow = ActiveRoomSummary & { displayName: string; icon: string; full: boolean };

type T = (key: UiTranslationKey) => string;

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const CITY_RADIUS_METERS = 150_000;

/** "Around San Diego": the named city nearest the room's position, else its rounded coordinates. */
export function nearbyRoomName(latitude: number, longitude: number, t: T): string {
  let best: { name: string; distance: number } | null = null;
  for (const node of getFlatChatroomList()) {
    if (node.hasChildren) continue;
    const at = getChatroomMapLocation(node.id);
    if (!at) continue;
    const distance = metersBetween({ latitude, longitude }, at);
    if (distance <= CITY_RADIUS_METERS && (!best || distance < best.distance)) best = { name: node.name, distance };
  }
  if (best) return t('roomListAround').replace('{place}', best.name);
  const coords = `${Math.abs(latitude).toFixed(1)}°${latitude >= 0 ? 'N' : 'S'} ${Math.abs(longitude).toFixed(1)}°${longitude >= 0 ? 'E' : 'W'}`;
  return t('roomListAround').replace('{place}', coords);
}

/**
 * Name every room and mark full ones. Rooms that would share a name get " · 2", " · 3"… in list
 * order, so two groups of the same area are told apart without exposing any room id.
 */
export function roomListRows(
  view: ActiveRoomsView,
  input: { t: T; capacity: number; currentRoomId: string; currentName: string },
): RoomListRow[] {
  const seen = new Map<string, number>();
  return view.rooms.map((room) => {
    const base = room.roomId === input.currentRoomId
      ? input.currentName
      : room.kind === 'place'
        ? room.name || input.t('roomListPlaceFallback')
        : room.latitude !== undefined && room.longitude !== undefined
          ? nearbyRoomName(room.latitude, room.longitude, input.t)
          : input.t('roomListNearbyFallback');
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return {
      ...room,
      displayName: count > 1 ? `${base} · ${count}` : base,
      icon: room.kind === 'place' ? '📌' : '📍',
      full: room.memberCount >= input.capacity,
    };
  });
}

/** "2 / 3 · 4 km NE" (or "2 / 3 · here"). */
export function roomMetaText(row: RoomListRow, capacity: number, t: T): string {
  const parts = [`${row.memberCount} / ${capacity}`];
  if (row.distanceMeters !== undefined) {
    parts.push(row.distanceMeters < 500
      ? t('roomListHere')
      : `${formatDistance(row.distanceMeters)} ${COMPASS[Math.round((row.bearingDegrees ?? 0) / 45) % 8]}`);
  }
  if (row.full) parts.push(t('roomListFull'));
  return parts.join(' · ');
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
  return `<div class="chatroom-item room-list-row ${row.full ? 'room-list-full' : ''}"
       data-chatroom-id="${escapeHtml(row.roomId)}"
       data-room-kind="${row.kind === 'place' ? 'place' : 'nearby-other'}"
       data-testid="room-list-row"
       ${row.latitude !== undefined ? `data-lat="${row.latitude}" data-lng="${row.longitude}"` : ''}
       ${row.full ? 'aria-disabled="true"' : 'role="button" tabindex="0"'}>
      <div class="chatroom-icon">${row.icon}</div>
      <div class="chatroom-info">
        <div class="chatroom-name">${escapeHtml(row.displayName)}</div>
        <div class="chatroom-flat-metrics"><span class="chatroom-headcount">${escapeHtml(roomMetaText(row, capacity, t))}</span></div>
      </div>
      <div class="chatroom-arrow">${row.full ? '' : '›'}</div>
    </div>`;
}
