import SEA from 'gun/sea';
import type { RoomProtocolCheckpoint } from '../../shared/active-exchange-room';
import { createNearbyControlPresence } from '../../shared/nearby-control-presence';
import { createNearbyOverflowCertificate } from '../../shared/nearby-overflow-certificate';
import { deriveNearbyRoomAssignment } from '../../shared/nearby-rooms';
import type { SeaSigningPair } from '../../shared/p2p-runtime';
import { NearbyPreAdmissionClient } from '../../web/services/nearby-pre-admission-client';

describe('NearbyPreAdmissionClient', () => {
  const checkpoint: RoomProtocolCheckpoint = {
    networkId: 'iinpublic-test',
    protocolEpoch: 1,
    manifestSequence: 1,
    manifestHash: 'f'.repeat(64),
    chatroomCapacity: 1,
  };
  const location = {
    latitude: 32.7157,
    longitude: -117.1611,
    accuracy: 5,
    timestamp: new Date('2026-10-08T12:00:00.000Z'),
  };

  function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
    const values = new Map<string, string>();
    return {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
    };
  }

  it('re-resolves before admission and can reuse the verified path offline', async () => {
    const pair = await SEA.pair() as SeaSigningPair;
    const root = deriveNearbyRoomAssignment({
      location,
      mode: 'neighborhood',
      identity: pair.pub,
    });
    const witnessPairs = await Promise.all([SEA.pair(), SEA.pair()]) as SeaSigningPair[];
    const witnesses = await Promise.all(witnessPairs.map((witnessPair, index) =>
      createNearbyControlPresence({
        userId: `witness-${index}`,
        pair: witnessPair,
        rootRoomId: root.roomId,
        assignment: root,
        checkpoint,
        now: new Date(),
      })));
    const certificate = createNearbyOverflowCertificate({
      rootRoomId: root.roomId,
      fromRoomId: root.roomId,
      fromRequestedSplitGeneration: 0,
      checkpoint,
      witnesses,
    });
    let posts = 0;
    const fetchMock = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts += 1;
        return new Response(JSON.stringify({ certificates: [certificate] }), { status: 200 });
      }
      return new Response(JSON.stringify({ certificates: [] }), { status: 200 });
    });
    const storage = memoryStorage();
    const client = new NearbyPreAdmissionClient({
      apiBase: 'https://relay.test',
      storage,
      fetch: fetchMock as typeof fetch,
    });
    const online = await client.resolve({
      userId: 'new-user',
      pair,
      location,
      mode: 'neighborhood',
      rootAssignment: root,
      checkpoint,
    });
    expect(posts).toBe(2);
    expect(online.assignment.requestedSplitGeneration).toBe(1);
    expect(online.assignment.roomId).not.toBe(root.roomId);

    const offlineClient = new NearbyPreAdmissionClient({
      apiBase: 'https://offline.test',
      storage,
      fetch: jest.fn(async () => { throw new Error('offline'); }) as typeof fetch,
    });
    const offline = await offlineClient.resolve({
      userId: 'new-user',
      pair,
      location,
      mode: 'neighborhood',
      rootAssignment: root,
      checkpoint,
    });
    expect(offline.assignment.roomId).toBe(online.assignment.roomId);
    expect(offline.relayReached).toBe(false);
  });
});
