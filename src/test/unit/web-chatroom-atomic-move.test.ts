/** @jest-environment jsdom */

import { TextEncoder } from 'node:util';
import { WebChatroomService } from '../../web/services/web-chatroom-service';

Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, configurable: true });

function gunChain(): any {
  const chain: any = {
    get: jest.fn(() => chain),
    put: jest.fn(() => chain),
    once: jest.fn(),
    on: jest.fn(() => ({ off: jest.fn() })),
    map: jest.fn(() => chain),
  };
  return chain;
}

describe('WebChatroomService atomic room moves', () => {
  let service: any;
  let order: string[];
  let leaveDelayMs: number;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    service = new WebChatroomService({ getGun: () => gunChain() } as any);
    service.currentChatroomId = 'A';
    order = [];
    leaveDelayMs = 0;
    service.leaveChatroom = jest.fn(async (room: string) => {
      order.push(`leave:${room}`);
      await new Promise((resolve) => setTimeout(resolve, leaveDelayMs));
    });
    service.joinChatroom = jest.fn(async (room: string) => {
      order.push(`join:${room}`);
      service.currentChatroomId = room;
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('never interleaves two manual switches', async () => {
    leaveDelayMs = 10;
    await Promise.all([service.switchChatroom('u', 'B', 'u'), service.switchChatroom('u', 'C', 'u')]);
    expect(order).toEqual(['leave:A', 'join:B', 'leave:B', 'join:C']);
  });

  it('leaves the intended new room disconnected when the new join fails', async () => {
    service.joinChatroom = jest.fn(async (room: string) => {
      order.push(`join:${room}`);
      if (room === 'B') throw new Error('join failed');
      service.currentChatroomId = room;
    });

    await expect(service.switchChatroom('u', 'B', 'u')).rejects.toThrow('join failed');
    expect(order).toEqual(['leave:A', 'join:B']);
    expect(service.currentChatroomId).toBe('B');
    // The queue is not poisoned by the failure.
    await service.switchChatroom('u', 'C', 'u');
    expect(service.currentChatroomId).toBe('C');
  });

  it('enters a Place with no seat to reserve: a Place is never full', async () => {
    global.fetch = jest.fn() as jest.Mock;

    await service.switchChatroom('u', 'place_32.71_-117.17_abcdefabcdef', 'User');

    expect(order).toEqual(['leave:A', 'join:place_32.71_-117.17_abcdefabcdef']);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('a Place is my own list', () => {
  it('joins with no hub roster: no member POST and no heartbeat, only a visit', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const service: any = new WebChatroomService({ getGun: () => gunChain() } as any);
    service.recordRoomVisit = jest.fn(async () => undefined);
    const fetchMock = jest.fn();
    const originalFetch = global.fetch;
    global.fetch = fetchMock as never;
    const place = 'place_32.71_-117.17_abcdefabcdef';
    try {
      await service.joinChatroom(place, 'u', 'User');
      expect(service.getCurrentChatroomId()).toBe(place);
      expect(service.recordRoomVisit).toHaveBeenCalledWith(place, 'u');
      expect(service.membershipHeartbeatTimer).toBeFalsy();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
      jest.restoreAllMocks();
    }
  });
});

describe('returning user is a newcomer', () => {
  it('treats a lapsed still-"active" record as a previous stay, not the same stay', () => {
    const service: any = new WebChatroomService({ getGun: () => gunChain() } as any);
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recent = new Date().toISOString();
    expect(service.isFreshActiveMember({ isActive: true, joinedAt: old, lastSeen: old })).toBe(false);
    expect(service.isFreshActiveMember({ isActive: true, joinedAt: old, lastSeen: recent })).toBe(true);
  });
});
