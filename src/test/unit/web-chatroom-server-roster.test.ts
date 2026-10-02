/** @jest-environment jsdom */

import {
  SERVER_MEMBERS_POLL_MS,
  WebChatroomService,
} from '../../web/services/web-chatroom-service';

type Member = { userId: string; stageName: string; pub?: string; epub?: string };

function createGunHarness() {
  let listener: ((data: unknown, key: string) => void) | undefined;
  const subscription = { off: jest.fn() };
  const chain: any = {
    get: () => chain,
    map: () => chain,
    on: (callback: (data: unknown, key: string) => void) => {
      listener = callback;
      return subscription;
    },
  };
  return {
    gunService: { getGun: () => chain },
    emitGunMember: (userId: string, data: unknown) => listener?.(data, userId),
    subscription,
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('WebChatroomService server-backed roster subscription', () => {
  const originalFetch = global.fetch;
  let service: WebChatroomService;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    (service as any)?.activeMembersUnsubscribe?.();
    global.fetch = originalFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('hydrates relay-only native members and tracks authoritative joins and leaves', async () => {
    const rosters: Member[][] = [
      [
        { userId: 'web', stageName: 'Web User' },
        { userId: 'phone-a', stageName: 'Phone A' },
        { userId: 'phone-b', stageName: 'Phone B' },
      ],
      [
        { userId: 'web', stageName: 'Web User' },
        { userId: 'phone-b', stageName: 'Phone B' },
        { userId: 'phone-c', stageName: 'Phone C' },
      ],
    ];
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => rosters.shift() ?? [],
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const gun = createGunHarness();
    service = new WebChatroomService(gun.gunService as any);
    const snapshots: Member[][] = [];

    service.subscribeToMembers('room', (members) => snapshots.push(members));
    await flushPromises();

    expect(snapshots.at(-1)).toEqual([
      { userId: 'web', stageName: 'Web User' },
      { userId: 'phone-a', stageName: 'Phone A' },
      { userId: 'phone-b', stageName: 'Phone B' },
    ]);

    await jest.advanceTimersByTimeAsync(SERVER_MEMBERS_POLL_MS);

    expect(snapshots.at(-1)).toEqual([
      { userId: 'web', stageName: 'Web User' },
      { userId: 'phone-b', stageName: 'Phone B' },
      { userId: 'phone-c', stageName: 'Phone C' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('preserves Gun key material when the server supplies the cross-runtime roster', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => [{ userId: 'phone-a', stageName: 'Fresh Phone Name' }],
    })) as unknown as typeof fetch;
    const gun = createGunHarness();
    service = new WebChatroomService(gun.gunService as any);
    const snapshots: Member[][] = [];

    service.subscribeToMembers('room', (members) => snapshots.push(members));
    gun.emitGunMember('phone-a', {
      isActive: true,
      stageName: 'Old Gun Name',
      pub: 'PHONE_PUB',
      epub: 'PHONE_EPUB',
    });
    await flushPromises();

    expect(snapshots.at(-1)).toEqual([
      {
        userId: 'phone-a',
        stageName: 'Fresh Phone Name',
        pub: 'PHONE_PUB',
        epub: 'PHONE_EPUB',
      },
    ]);
  });

  it('keeps the last-known-good roster when the server poll fails', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ userId: 'phone-a', stageName: 'Phone A' }],
      })
      .mockRejectedValueOnce(new Error('offline'));
    global.fetch = fetchMock as unknown as typeof fetch;
    const gun = createGunHarness();
    service = new WebChatroomService(gun.gunService as any);
    const snapshots: Member[][] = [];

    service.subscribeToMembers('room', (members) => snapshots.push(members));
    await flushPromises();
    await jest.advanceTimersByTimeAsync(SERVER_MEMBERS_POLL_MS);

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toEqual([{ userId: 'phone-a', stageName: 'Phone A' }]);
  });
});
