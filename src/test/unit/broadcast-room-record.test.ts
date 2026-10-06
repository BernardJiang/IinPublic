import { recordTalksBroadcastInRoom, talksBroadcastInRoom } from '../../web/ui/broadcast-room-record';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe('broadcast room record', () => {
  it('owes a Talk only to the rooms it was deliberately broadcast in', () => {
    const storage = memoryStorage();
    recordTalksBroadcastInRoom('room-a', ['t1', 't2'], ['t1', 't2', 't3'], storage);
    recordTalksBroadcastInRoom('room-b', ['t3'], ['t1', 't2', 't3'], storage);
    expect([...talksBroadcastInRoom('room-a', storage)].sort()).toEqual(['t1', 't2']);
    expect([...talksBroadcastInRoom('room-b', storage)]).toEqual(['t3']);
    expect(talksBroadcastInRoom('room-c', storage).size).toBe(0);
  });

  it('keeps every room a Talk was broadcast in and forgets deleted Talks', () => {
    const storage = memoryStorage();
    recordTalksBroadcastInRoom('room-a', ['t1', 't2'], ['t1', 't2'], storage);
    recordTalksBroadcastInRoom('room-b', ['t1'], ['t1'], storage);
    expect(talksBroadcastInRoom('room-a', storage)).toEqual(new Set(['t1']));
    expect(talksBroadcastInRoom('room-b', storage)).toEqual(new Set(['t1']));
  });

  it('survives a corrupt record', () => {
    const storage = memoryStorage();
    storage.setItem('iinpublic_talk_broadcast_rooms_v1', '[not json');
    expect(talksBroadcastInRoom('room-a', storage).size).toBe(0);
    recordTalksBroadcastInRoom('room-a', ['t1'], ['t1'], storage);
    expect(talksBroadcastInRoom('room-a', storage)).toEqual(new Set(['t1']));
  });
});
