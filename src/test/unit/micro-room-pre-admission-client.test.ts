import SEA from 'gun/sea';
import type { RoomProtocolCheckpoint } from '../../shared/active-exchange-room';
import { microRoomLaneIndex } from '../../shared/micro-room-assignment';
import { createMicroRoomControlPresence } from '../../shared/micro-room-control-presence';
import { createMicroRoomOverflowCertificate } from '../../shared/micro-room-overflow-certificate';
import type { SeaSigningPair } from '../../shared/p2p-runtime';
import { MicroRoomPreAdmissionClient } from '../../web/services/micro-room-pre-admission-client';

describe('OPEN-40 micro-room pre-admission client', () => {
  const baseGridRoomId = 'region_32.71_-117.17_room_0';
  const checkpoint: RoomProtocolCheckpoint = {
    networkId: 'iinpublic-test',
    protocolEpoch: 1,
    manifestSequence: 1,
    manifestHash: 'c'.repeat(64),
    chatroomCapacity: 1,
  };

  function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
    const values = new Map<string, string>();
    return {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
    };
  }

  async function generationZeroCertificate(now: Date) {
    const witnesses = [];
    while (witnesses.length < 2) {
      const pair = await SEA.pair() as SeaSigningPair;
      if (microRoomLaneIndex(pair.pub, baseGridRoomId, 1) !== 0) continue;
      witnesses.push(await createMicroRoomControlPresence({
        userId: `witness-${witnesses.length}`,
        pair,
        baseGridRoomId,
        splitGeneration: 0,
        laneIndex: 0,
        checkpoint,
        now,
      }));
    }
    return createMicroRoomOverflowCertificate({
      baseGridRoomId,
      fromSplitGeneration: 0,
      fromLaneIndex: 0,
      checkpoint,
      witnesses,
      createdAt: now.toISOString(),
    });
  }

  it('uses generation zero when no overflow certificate exists', async () => {
    const pair = await SEA.pair() as SeaSigningPair;
    const fetchMock = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify({ certificates: [] }), { status: 200 });
      return new Response(JSON.stringify({ certificates: [] }), { status: 200 });
    });
    const client = new MicroRoomPreAdmissionClient({
      apiBase: 'https://relay.test',
      storage: memoryStorage(),
      fetch: fetchMock as typeof fetch,
    });

    const result = await client.resolve({
      userId: 'new-user',
      pair,
      baseGridRoomId,
      checkpoint,
    });
    expect(result.assignment).toEqual(expect.objectContaining({ splitGeneration: 0, laneCount: 1 }));
    expect(result.relayReached).toBe(true);
  });

  it('re-resolves before admission when its registration creates the next generation', async () => {
    const pair = await SEA.pair() as SeaSigningPair;
    const certificate = await generationZeroCertificate(new Date());
    let posts = 0;
    const fetchMock = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts += 1;
        return new Response(JSON.stringify({ certificates: [certificate] }), { status: 200 });
      }
      return new Response(JSON.stringify({ certificates: [] }), { status: 200 });
    });
    const storage = memoryStorage();
    const client = new MicroRoomPreAdmissionClient({
      apiBase: 'https://relay.test',
      storage,
      fetch: fetchMock as typeof fetch,
    });

    const result = await client.resolve({
      userId: 'overflow-user',
      pair,
      baseGridRoomId,
      checkpoint,
    });
    expect(posts).toBe(2);
    expect(result.assignment).toEqual(expect.objectContaining({ splitGeneration: 1, laneCount: 2 }));
    expect(result.certificates).toHaveLength(1);

    const offlineClient = new MicroRoomPreAdmissionClient({
      apiBase: 'https://offline.test',
      storage,
      fetch: jest.fn(async () => { throw new Error('offline'); }) as typeof fetch,
    });
    const offline = await offlineClient.resolve({
      userId: 'overflow-user',
      pair,
      baseGridRoomId,
      checkpoint,
    });
    expect(offline.assignment.splitGeneration).toBe(1);
    expect(offline.relayReached).toBe(false);
  });
});
