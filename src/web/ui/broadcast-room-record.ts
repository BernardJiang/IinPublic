/**
 * Which rooms each of my Talks was deliberately broadcast in.
 *
 * A broadcast stays scoped to the room it was made in (docs/design/chatroom-scoped-p2p-traffic.md):
 * switching rooms never carries Talks along. Within that room, though, any peer this device links
 * to later (LAN, Wi-Fi Direct or relay) is owed the same Talks automatically. This record is what
 * lets catch-up send exactly the Talks broadcast in the current room, and nothing else.
 */

const STORAGE_KEY = 'iinpublic_talk_broadcast_rooms_v1';
const MAX_ROOMS_PER_TALK = 16;

type BroadcastRoomRecord = Record<string, string[]>;

function read(storage: Pick<Storage, 'getItem'>): BroadcastRoomRecord {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as BroadcastRoomRecord : {};
  } catch {
    return {};
  }
}

/** Remember that these Talks were broadcast in `roomId`. Talks no longer in `liveTalkIds` are dropped. */
export function recordTalksBroadcastInRoom(
  roomId: string,
  talkIds: string[],
  liveTalkIds: Iterable<string>,
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
): void {
  if (!roomId || talkIds.length === 0) return;
  const live = new Set(liveTalkIds);
  const record = read(storage);
  for (const talkId of Object.keys(record)) {
    if (!live.has(talkId)) delete record[talkId];
  }
  for (const talkId of talkIds) {
    const rooms = (Array.isArray(record[talkId]) ? record[talkId] : []).filter((room) => room !== roomId);
    rooms.push(roomId);
    record[talkId] = rooms.slice(-MAX_ROOMS_PER_TALK);
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    /* storage full — catch-up just has less to offer; deliberate broadcasts still work */
  }
}

/** Talk ids that were deliberately broadcast in `roomId`. */
export function talksBroadcastInRoom(
  roomId: string,
  storage: Pick<Storage, 'getItem'> = localStorage,
): Set<string> {
  const record = read(storage);
  return new Set(Object.entries(record)
    .filter(([, rooms]) => Array.isArray(rooms) && rooms.includes(roomId))
    .map(([talkId]) => talkId));
}
