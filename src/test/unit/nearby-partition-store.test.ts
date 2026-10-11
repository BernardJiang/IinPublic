import SEA from 'gun/sea';
import type { RoomProtocolCheckpoint } from '../../shared/active-exchange-room';
import { createNearbyControlPresence } from '../../shared/nearby-control-presence';
import {
  applyNearbyPartitionTransitions,
  createNearbyPartitionSplit,
  NEARBY_PARTITION_MERGE_DWELL_MS,
  nearbyPartitionAssignment,
  nearbyPartitionRootGroup,
} from '../../shared/nearby-partition';
import type { SeaSigningPair } from '../../shared/p2p-runtime';
import { NearbyPartitionStore } from '../../server/services/nearby-partition-store';

describe('NearbyPartitionStore', () => {
  const checkpoint: RoomProtocolCheckpoint = {
    networkId: 'iinpublic-test',
    protocolEpoch: 1,
    manifestSequence: 1,
    manifestHash: 'b'.repeat(64),
    chatroomCapacity: 2,
  };
  const location = {
    latitude: 32.7157,
    longitude: -117.1611,
    accuracy: 5,
    timestamp: new Date('2026-10-10T12:00:00.000Z'),
  };

  it('splits at C+1, then coalesces siblings after a stable combined roster dwell', async () => {
    const store = new NearbyPartitionStore();
    const root = nearbyPartitionRootGroup(checkpoint);
    const rootAssignment = nearbyPartitionAssignment({
      group: root,
      location,
      mode: 'neighborhood',
      checkpoint,
    });
    const pairs = await Promise.all([SEA.pair(), SEA.pair(), SEA.pair()]) as SeaSigningPair[];
    const start = new Date('2026-10-10T12:00:00.000Z');
    let splitTransitions: unknown[] = [];
    for (let index = 0; index < pairs.length; index += 1) {
      const registration = await store.register(await createNearbyControlPresence({
        userId: `member-${index}`,
        pair: pairs[index]!,
        rootRoomId: root.roomId,
        assignment: rootAssignment,
        checkpoint,
        now: start,
      }), start);
      splitTransitions = registration.transitions;
    }
    expect(splitTransitions).toHaveLength(1);

    const child = (await applyNearbyPartitionTransitions({
      location,
      mode: 'neighborhood',
      checkpoint,
      transitions: splitTransitions,
    })).assignment;
    expect(child.roomId).not.toBe(root.roomId);

    // The third member disappears. The remaining pair heartbeat often enough to stay live while
    // the four sibling groups remain at or below C for the complete merge dwell.
    let coalesceTransitions: unknown[] = [];
    for (let elapsed = 60_000; elapsed <= 60_000 + NEARBY_PARTITION_MERGE_DWELL_MS; elapsed += 30_000) {
      const now = new Date(start.getTime() + elapsed);
      for (let index = 0; index < 2; index += 1) {
        const registration = await store.register(await createNearbyControlPresence({
          userId: `member-${index}`,
          pair: pairs[index]!,
          rootRoomId: root.roomId,
          assignment: child,
          checkpoint,
          now,
        }), now);
        if (registration.transitions.length > 0) coalesceTransitions = registration.transitions;
      }
    }
    expect(coalesceTransitions).toHaveLength(1);
    expect((coalesceTransitions[0] as { kind: string }).kind).toBe('coalesce-adjacent-groups');

    const merged = await applyNearbyPartitionTransitions({
      location,
      mode: 'neighborhood',
      checkpoint,
      transitions: [...splitTransitions, ...coalesceTransitions],
    });
    expect(merged.assignment.roomId).not.toBe(root.roomId);
    expect(merged.assignment.requestedSplitGeneration).toBe(0);
  });

  it('rebuilds the same active cut when conflicting partition evidence arrives in either order', async () => {
    const root = nearbyPartitionRootGroup(checkpoint);
    const assignment = nearbyPartitionAssignment({
      group: root,
      location,
      mode: 'neighborhood',
      checkpoint,
    });
    const now = new Date();
    const pairs = await Promise.all([SEA.pair(), SEA.pair(), SEA.pair()]) as SeaSigningPair[];
    const witnesses = await Promise.all(pairs.map((pair, index) => createNearbyControlPresence({
      userId: `conflict-store-${index}`,
      pair,
      rootRoomId: root.roomId,
      assignment,
      checkpoint,
      now,
    })));
    const earlier = createNearbyPartitionSplit({
      checkpoint,
      fromGroup: root,
      witnesses,
      createdAt: new Date(now.getTime() + 1_000).toISOString(),
    });
    const later = createNearbyPartitionSplit({
      checkpoint,
      fromGroup: root,
      witnesses,
      createdAt: new Date(now.getTime() + 2_000).toISOString(),
    });
    const left = new NearbyPartitionStore();
    const right = new NearbyPartitionStore();
    await left.publishTransitions(checkpoint, [later, earlier]);
    await right.publishTransitions(checkpoint, [earlier, later]);
    expect(left.transitionFor(checkpoint, root.roomId)[0]?.transitionId)
      .toBe(right.transitionFor(checkpoint, root.roomId)[0]?.transitionId);
    expect(left.transitionFor(checkpoint, root.roomId)[0]?.transitionId).toBe(earlier.transitionId);
  });
});
