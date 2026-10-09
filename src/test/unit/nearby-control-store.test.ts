import SEA from 'gun/sea';
import type { RoomProtocolCheckpoint } from '../../shared/active-exchange-room';
import { createNearbyControlPresence } from '../../shared/nearby-control-presence';
import { deriveNearbyRoomAssignment } from '../../shared/nearby-rooms';
import type { SeaSigningPair } from '../../shared/p2p-runtime';
import { NearbyControlStore } from '../../server/services/nearby-control-store';

describe('NearbyControlStore', () => {
  it('forms one certificate at C+1 signed occupants of the same geographic room', async () => {
    const store = new NearbyControlStore();
    const now = new Date('2026-10-08T12:00:00.000Z');
    const checkpoint: RoomProtocolCheckpoint = {
      networkId: 'iinpublic-test',
      protocolEpoch: 1,
      manifestSequence: 1,
      manifestHash: 'e'.repeat(64),
      chatroomCapacity: 2,
    };
    const location = { latitude: 32.7157, longitude: -117.1611, accuracy: 5, timestamp: now };
    const root = deriveNearbyRoomAssignment({ location, mode: 'neighborhood', identity: 'root' });
    let certificates: unknown[] = [];
    for (let index = 0; index < 3; index += 1) {
      const pair = await SEA.pair() as SeaSigningPair;
      const registration = await store.register(await createNearbyControlPresence({
        userId: `user-${index}`,
        pair,
        rootRoomId: root.roomId,
        assignment: root,
        checkpoint,
        now,
      }), now);
      expect(registration.roomWitnessCount).toBe(index + 1);
      certificates = registration.certificates;
    }
    expect(certificates).toHaveLength(1);
    expect(certificates[0]).toEqual(expect.objectContaining({
      fromRoomId: root.roomId,
      fromRequestedSplitGeneration: 0,
      toRequestedSplitGeneration: 1,
    }));
  });
});
