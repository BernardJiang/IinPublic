import type { ActiveRoomSort, ActiveRoomsView } from '../../shared/active-rooms';
import { settingsStorage } from './core-storage';

/** Reads the hub's room list (shared/active-rooms.ts). */
export async function fetchActiveRooms(
  apiBase: string,
  query: { origin?: { latitude: number; longitude: number }; currentRoomId?: string; sort: ActiveRoomSort; limit: number },
  fetchFn: typeof fetch = fetch.bind(globalThis),
): Promise<ActiveRoomsView> {
  const params = new URLSearchParams({ sort: query.sort, limit: String(query.limit) });
  if (query.origin) {
    params.set('lat', String(query.origin.latitude));
    params.set('lng', String(query.origin.longitude));
  }
  if (query.currentRoomId) params.set('current', query.currentRoomId);
  const response = await fetchFn(`${apiBase}/api/active-rooms?${params}`);
  if (!response.ok) throw new Error(`room list failed: ${response.status}`);
  const body = await response.json() as Partial<ActiveRoomsView>;
  return {
    totalOnline: Number(body.totalOnline) || 0,
    totalRooms: Number(body.totalRooms) || 0,
    rooms: Array.isArray(body.rooms) ? body.rooms : [],
    hasMore: body.hasMore === true,
  };
}

const SORT_KEY = 'iinpublic_room_list_sort';

export function getRoomListSort(): ActiveRoomSort {
  try {
    const saved = settingsStorage.getItem(SORT_KEY);
    if (saved === 'busiest' || saved === 'most-room' || saved === 'nearest') return saved;
  } catch { /* storage blocked */ }
  return 'nearest';
}

export function setRoomListSort(sort: ActiveRoomSort): void {
  try {
    settingsStorage.setItem(SORT_KEY, sort);
  } catch { /* storage blocked: this session only */ }
}
