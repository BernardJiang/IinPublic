/** @jest-environment jsdom */

import { WebChatroomService } from '../../web/services/web-chatroom-service';

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

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('WebChatroomService atomic room moves', () => {
  let service: any;
  let order: string[];
  let leaveDelayMs: number;

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

  afterEach(() => jest.restoreAllMocks());

  it('a manual switch requested first beats an eviction that has not started', async () => {
    const manual = service.switchChatroom('u', 'B', 'u');
    const evicted = await service.moveForEviction('A', 'u', 'A-child', 'u');
    await manual;

    expect(evicted).toBe(false);
    expect(order).toEqual(['leave:A', 'join:B']);
    expect(service.currentChatroomId).toBe('B');
  });

  it('a manual switch arriving after the eviction was queued still wins', async () => {
    const evicted = service.moveForEviction('A', 'u', 'A-child', 'u');
    const manual = service.switchChatroom('u', 'B', 'u');

    expect(await evicted).toBe(false);
    await manual;
    expect(order).toEqual(['leave:A', 'join:B']);
  });

  it('an eviction already running finishes first, then the manual switch lands the user where they chose', async () => {
    leaveDelayMs = 20;
    const evicted = service.moveForEviction('A', 'u', 'A-child', 'u');
    await tick(); // the eviction has started (passed its checks, waiting inside leave)
    const manual = service.switchChatroom('u', 'B', 'u');

    expect(await evicted).toBe(true);
    await manual;
    expect(order).toEqual(['leave:A', 'join:A-child', 'leave:A-child', 'join:B']);
    expect(service.currentChatroomId).toBe('B');
  });

  it('ignores an eviction when the user is no longer in the room the notice was for', async () => {
    service.currentChatroomId = 'somewhere-else';
    expect(await service.moveForEviction('A', 'u', 'A-child', 'u')).toBe(false);
    expect(order).toEqual([]);
  });

  it('never interleaves two manual switches', async () => {
    leaveDelayMs = 10;
    await Promise.all([service.switchChatroom('u', 'B', 'u'), service.switchChatroom('u', 'C', 'u')]);
    expect(order).toEqual(['leave:A', 'join:B', 'leave:B', 'join:C']);
  });

  it('puts the user back in their old room when the new join fails', async () => {
    service.joinChatroom = jest.fn(async (room: string) => {
      order.push(`join:${room}`);
      if (room === 'B') throw new Error('join failed');
      service.currentChatroomId = room;
    });

    await expect(service.switchChatroom('u', 'B', 'u')).rejects.toThrow('join failed');
    expect(order).toEqual(['leave:A', 'join:B', 'join:A']);
    expect(service.currentChatroomId).toBe('A');
    // The queue is not poisoned by the failure.
    await service.switchChatroom('u', 'C', 'u');
    expect(service.currentChatroomId).toBe('C');
  });

  it('returns the user to the old room when an eviction join fails', async () => {
    service.joinChatroom = jest.fn(async (room: string) => {
      order.push(`join:${room}`);
      if (room === 'A-child') throw new Error('join failed');
      service.currentChatroomId = room;
    });
    expect(await service.moveForEviction('A', 'u', 'A-child', 'u')).toBe(false);
    expect(order).toEqual(['leave:A', 'join:A-child', 'join:A']);
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
