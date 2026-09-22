/** @jest-environment jsdom */

import { MEMBERSHIP_HEARTBEAT_MAX_MS, MEMBERSHIP_KEY_REFRESH_BEATS, WebChatroomService } from '../../web/services/web-chatroom-service';

describe('membership heartbeat cadence and payload', () => {
  let puts: Array<Record<string, unknown>>;
  let service: any;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
    puts = [];
    const chain: any = { get: () => chain, put: (value: Record<string, unknown>) => { puts.push(value); return chain; } };
    service = new WebChatroomService({
      getGun: () => chain,
      getStoredPair: () => ({ epub: 'EPUB', pub: 'PUB' }),
    } as any);
  });

  afterEach(() => {
    service.stopMembershipHeartbeat();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('beats once a minute (a third of the 180 s membership TTL)', () => {
    expect(MEMBERSHIP_HEARTBEAT_MAX_MS).toBe(60_000);
    service.startMembershipHeartbeat('room', 'u1', 'Name');
    expect(puts).toHaveLength(1);
    jest.advanceTimersByTime(59_999);
    expect(puts).toHaveLength(1);
    jest.advanceTimersByTime(1);
    expect(puts).toHaveLength(2);
  });

  it('carries the public keys on the first beat, omits them after, and refreshes them periodically', () => {
    service.startMembershipHeartbeat('room', 'u1', 'Name');
    jest.advanceTimersByTime(MEMBERSHIP_HEARTBEAT_MAX_MS * MEMBERSHIP_KEY_REFRESH_BEATS);
    expect(puts).toHaveLength(MEMBERSHIP_KEY_REFRESH_BEATS + 1);

    expect(puts[0]).toMatchObject({ epub: 'EPUB', pub: 'PUB', isActive: true });
    for (let i = 1; i < MEMBERSHIP_KEY_REFRESH_BEATS; i += 1) {
      expect(puts[i]).not.toHaveProperty('epub');
      expect(puts[i]).not.toHaveProperty('pub');
      expect(puts[i]).toMatchObject({ isActive: true, userId: 'u1', stageName: 'Name', lastSeen: expect.any(String) });
    }
    expect(puts[MEMBERSHIP_KEY_REFRESH_BEATS]).toMatchObject({ epub: 'EPUB', pub: 'PUB' });
  });

  it('restarting for a new room sends the keys again on its first beat', () => {
    service.startMembershipHeartbeat('room-a', 'u1', 'Name');
    jest.advanceTimersByTime(MEMBERSHIP_HEARTBEAT_MAX_MS * 2);
    service.startMembershipHeartbeat('room-b', 'u1', 'Name');
    expect(puts[puts.length - 1]).toMatchObject({ epub: 'EPUB', pub: 'PUB' });
  });
});
