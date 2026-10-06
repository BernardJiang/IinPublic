import {
  ACTIVE_EXCHANGE_ROOM_STORAGE_KEY,
  ActiveExchangeRoomController,
  BASELINE_ROOM_PROTOCOL_CHECKPOINT,
  activeRoomScope,
  deriveRoomRendezvousToken,
  roomScopeMatches,
  roomDeliveryMatchesActiveRoom,
} from '../../shared/active-exchange-room';

function memoryStorage(initial?: string) {
  const records = new Map<string, string>();
  if (initial) records.set(ACTIVE_EXCHANGE_ROOM_STORAGE_KEY, initial);
  return {
    records,
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => { records.set(key, value); },
    removeItem: (key: string) => { records.delete(key); },
  };
}

describe('ActiveExchangeRoomController', () => {
  it('stops the old room before starting the new room and persists exactly one active audience', async () => {
    const storage = memoryStorage();
    const events: string[] = [];
    const controller = new ActiveExchangeRoomController(storage, {
      stopRoom: async (room) => { events.push(`stop:${room.roomId}`); },
      startRoom: async (room) => { events.push(`start:${room.roomId}`); },
    }, () => new Date('2026-10-04T12:00:00.000Z'));

    await controller.activate({ roomId: 'hall-a', ...BASELINE_ROOM_PROTOCOL_CHECKPOINT });
    await controller.activate({ roomId: 'hall-b', ...BASELINE_ROOM_PROTOCOL_CHECKPOINT });

    expect(events).toEqual(['start:hall-a', 'stop:hall-a', 'start:hall-b']);
    expect(controller.getSnapshot()).toEqual(expect.objectContaining({
      active: expect.objectContaining({ roomId: 'hall-b', exchangeState: 'active' }),
      rememberedRoomIds: ['hall-a', 'hall-b'],
      transition: null,
    }));
    expect(JSON.parse(storage.records.get(ACTIVE_EXCHANGE_ROOM_STORAGE_KEY)!)).toEqual(controller.getSnapshot());
  });

  it('exposes the starting room scope to the startRoom hook, and none while paused', async () => {
    let scopeDuringStart: string | null | undefined;
    const controller: ActiveExchangeRoomController = new ActiveExchangeRoomController(memoryStorage(), {
      stopRoom: async () => undefined,
      // Presence and nearby discovery are built inside this hook and need the room's scope.
      startRoom: async () => { scopeDuringStart = controller.getScope()?.roomId ?? null; },
    }, () => new Date('2026-10-04T12:00:00.000Z'));

    await controller.activate({ roomId: 'hall-a', ...BASELINE_ROOM_PROTOCOL_CHECKPOINT });
    expect(scopeDuringStart).toBe('hall-a');
    expect(controller.getScope()?.roomId).toBe('hall-a');
    await controller.pause();
    expect(controller.getScope()).toBeNull();
  });

  it('does not silently restore the old room if starting the new room fails', async () => {
    const storage = memoryStorage();
    const events: string[] = [];
    const controller = new ActiveExchangeRoomController(storage, {
      stopRoom: (room) => { events.push(`stop:${room.roomId}`); },
      startRoom: (room) => {
        events.push(`start:${room.roomId}`);
        if (room.roomId === 'broken') throw new Error('radio unavailable');
      },
    });
    await controller.activate({ roomId: 'old', ...BASELINE_ROOM_PROTOCOL_CHECKPOINT });
    await expect(controller.activate({ roomId: 'broken', ...BASELINE_ROOM_PROTOCOL_CHECKPOINT })).rejects.toThrow('radio unavailable');
    expect(events).toEqual(['start:old', 'stop:old', 'start:broken']);
    expect(controller.getActiveRoom()).toEqual(expect.objectContaining({
      roomId: 'broken',
      exchangeState: 'disconnected',
      lastError: 'radio unavailable',
    }));
  });

  it('preserves FIFO admission time while restarting the same room at a new protocol checkpoint', async () => {
    const storage = memoryStorage();
    const events: string[] = [];
    let now = new Date('2026-10-04T12:00:00.000Z');
    const controller = new ActiveExchangeRoomController(storage, {
      stopRoom: async (room) => { events.push(`stop:${room.manifestSequence}`); },
      startRoom: async (room) => { events.push(`start:${room.manifestSequence}`); },
    }, () => now);

    const first = await controller.activate({ roomId: 'hall-a', ...BASELINE_ROOM_PROTOCOL_CHECKPOINT });
    now = new Date('2026-10-05T12:00:00.000Z');
    const transitioned = await controller.transitionTo({
      roomId: 'hall-a',
      ...BASELINE_ROOM_PROTOCOL_CHECKPOINT,
      protocolEpoch: 2,
      manifestSequence: 2,
      manifestHash: 'b'.repeat(64),
      chatroomCapacity: 1_000,
    });

    expect(events).toEqual(['start:1', 'stop:1', 'start:2']);
    expect(transitioned.enteredAt).toBe(first.enteredAt);
    expect(transitioned).toEqual(expect.objectContaining({
      roomId: 'hall-a',
      protocolEpoch: 2,
      manifestSequence: 2,
      chatroomCapacity: 1_000,
      exchangeState: 'active',
    }));
  });

  it('recovers an interrupted transition as disconnected instead of running two rooms', () => {
    const active = {
      version: 1,
      roomId: 'new-room',
      enteredAt: '2026-10-04T12:00:00.000Z',
      transitionId: 't1',
      neighborLimit: 12,
      exchangeState: 'starting',
      ...BASELINE_ROOM_PROTOCOL_CHECKPOINT,
    };
    const storage = memoryStorage(JSON.stringify({
      version: 1,
      active,
      rememberedRoomIds: ['old-room', 'new-room'],
      transition: {
        id: 't1',
        fromRoomId: 'old-room',
        toRoomId: 'new-room',
        phase: 'starting-new',
        startedAt: '2026-10-04T12:00:00.000Z',
      },
    }));
    const controller = new ActiveExchangeRoomController(storage, { stopRoom: () => {}, startRoom: () => {} });
    expect(controller.getActiveRoom()).toEqual(expect.objectContaining({
      roomId: 'new-room',
      exchangeState: 'disconnected',
      lastError: 'interrupted room transition',
    }));
    expect(controller.getSnapshot().transition).toBeNull();
  });

  it('creates rotating opaque room scope and rejects expired or mismatched scope', () => {
    const room = {
      version: 1 as const,
      roomId: 'hall-a',
      enteredAt: '2026-10-04T12:00:00.000Z',
      transitionId: 't1',
      neighborLimit: 12,
      exchangeState: 'active' as const,
      ...BASELINE_ROOM_PROTOCOL_CHECKPOINT,
    };
    const now = Date.parse('2026-10-04T12:01:00.000Z');
    const scope = activeRoomScope(room, now);
    expect(scope.roomToken).toMatch(/^[a-f0-9]{32}$/);
    expect(scope.roomToken).not.toContain(room.roomId);
    expect(roomScopeMatches(scope, scope, new Date(now))).toBe(true);
    expect(roomScopeMatches(scope, { ...scope, roomId: 'hall-b' }, new Date(now))).toBe(false);
    expect(roomScopeMatches(scope, { ...scope, tokenExpiresAt: '2026-10-04T11:00:00.000Z' }, new Date(now))).toBe(false);
    expect(deriveRoomRendezvousToken(room, room.roomId, now + 16 * 60_000).token).not.toBe(scope.roomToken);
    expect(activeRoomScope({
      ...room,
      manifestSequence: room.manifestSequence + 1,
      manifestHash: 'b'.repeat(64),
    }, now).roomToken).toBe(scope.roomToken);
  });

  it('accepts a room-bound delivery only while that room is active without comparing device clocks', () => {
    const active = {
      version: 1 as const,
      roomId: 'hall-a',
      enteredAt: '2026-10-04T12:00:00.000Z',
      transitionId: 't1',
      neighborLimit: 12,
      exchangeState: 'active' as const,
      ...BASELINE_ROOM_PROTOCOL_CHECKPOINT,
    };
    expect(roomDeliveryMatchesActiveRoom({
      roomId: 'hall-a',
      broadcastAt: '2026-10-04T12:01:00.000Z',
    }, active, 'hall-a')).toBe(true);
    expect(roomDeliveryMatchesActiveRoom({
      roomId: 'hall-b',
      broadcastAt: '2026-10-04T12:01:00.000Z',
    }, active, 'hall-a')).toBe(false);
    expect(roomDeliveryMatchesActiveRoom({
      roomId: 'hall-a',
      broadcastAt: '2026-10-04T11:59:59.000Z',
    }, active, 'hall-a')).toBe(true);
    expect(roomDeliveryMatchesActiveRoom({
      roomId: 'hall-a',
      broadcastAt: '2026-10-04T12:01:00.000Z',
    }, { ...active, exchangeState: 'disconnected' }, 'hall-a')).toBe(false);
    expect(roomDeliveryMatchesActiveRoom({
      roomId: 'hall-a',
      broadcastAt: 'not-a-date',
    }, active, 'hall-a')).toBe(false);
  });
});
