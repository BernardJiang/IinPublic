import SEA from 'gun/sea';
import type { RoomProtocolCheckpoint } from '../../shared/active-exchange-room';
import { createNearbyControlPresence } from '../../shared/nearby-control-presence';
import {
  applyNearbyPartitionTransitions,
  createNearbyPartitionSplit,
  nearbyPartitionAssignment,
  nearbyPartitionRootGroup,
  verifyNearbyPartitionTransition,
} from '../../shared/nearby-partition';
import type { SeaSigningPair } from '../../shared/p2p-runtime';

describe('flat adaptive Nearby partition transitions', () => {
  const checkpoint: RoomProtocolCheckpoint = {
    networkId: 'iinpublic-test',
    protocolEpoch: 1,
    manifestSequence: 1,
    manifestHash: 'a'.repeat(64),
    chatroomCapacity: 2,
  };
  const west = { latitude: 32.7, longitude: -117.2, accuracy: 5, timestamp: new Date() };
  const east = { latitude: 32.7, longitude: 117.2, accuracy: 5, timestamp: new Date() };

  it('starts every declared point in one worldwide shared group', async () => {
    const left = await applyNearbyPartitionTransitions({
      location: west,
      mode: 'neighborhood',
      checkpoint,
      transitions: [],
    });
    const right = await applyNearbyPartitionTransitions({
      location: east,
      mode: 'regional',
      checkpoint,
      transitions: [],
    });
    expect(left.assignment.roomId).toBe(right.assignment.roomId);
    expect(left.assignment.roomId).toBe(nearbyPartitionRootGroup(checkpoint).roomId);
  });

  it('keeps the root rendezvous stable across manifests in one protocol epoch', () => {
    const successor = {
      ...checkpoint,
      manifestSequence: 2,
      manifestHash: 'b'.repeat(64),
      chatroomCapacity: 498,
    };
    expect(nearbyPartitionRootGroup(successor).roomId)
      .toBe(nearbyPartitionRootGroup(checkpoint).roomId);
    expect(nearbyPartitionRootGroup({ ...successor, protocolEpoch: 2 }).roomId)
      .not.toBe(nearbyPartitionRootGroup(checkpoint).roomId);
  });

  it('verifies C+1 signed evidence and replaces only the overflowing group', async () => {
    const root = nearbyPartitionRootGroup(checkpoint);
    const rootAssignment = nearbyPartitionAssignment({
      group: root,
      location: west,
      mode: 'neighborhood',
      checkpoint,
    });
    const pairs = await Promise.all([SEA.pair(), SEA.pair(), SEA.pair()]) as SeaSigningPair[];
    const witnesses = await Promise.all(pairs.map((pair, index) => createNearbyControlPresence({
      userId: `partition-user-${index}`,
      pair,
      rootRoomId: root.roomId,
      assignment: rootAssignment,
      checkpoint,
    })));
    const transition = createNearbyPartitionSplit({ checkpoint, fromGroup: root, witnesses });
    const verified = await verifyNearbyPartitionTransition(transition, checkpoint);
    expect(verified.ok).toBe(true);

    const left = await applyNearbyPartitionTransitions({
      location: west,
      mode: 'neighborhood',
      checkpoint,
      transitions: [transition],
    });
    const right = await applyNearbyPartitionTransitions({
      location: east,
      mode: 'neighborhood',
      checkpoint,
      transitions: [transition],
    });
    expect(left.assignment.roomId).not.toBe(root.roomId);
    expect(right.assignment.roomId).not.toBe(root.roomId);
    expect(left.assignment.roomId).not.toBe(right.assignment.roomId);

    const tampered = {
      ...transition,
      toGroups: transition.toGroups.map((group, index) => index === 0
        // Always a different last digit: a fixed '0' left ids already ending in 0 unchanged, so
        // the "tampered" transition verified and the test failed 1 run in 16.
        ? { ...group, roomId: group.roomId.replace(/[a-f0-9]$/, (digit) => (digit === '0' ? '1' : '0')) }
        : group),
    };
    expect((await verifyNearbyPartitionTransition(tampered, checkpoint)).ok).toBe(false);
  });

  it('converges on the same valid replacement regardless of partition arrival order', async () => {
    const root = nearbyPartitionRootGroup(checkpoint);
    const rootAssignment = nearbyPartitionAssignment({
      group: root,
      location: west,
      mode: 'neighborhood',
      checkpoint,
    });
    const now = new Date();
    const pairs = await Promise.all([SEA.pair(), SEA.pair(), SEA.pair()]) as SeaSigningPair[];
    const witnesses = await Promise.all(pairs.map((pair, index) => createNearbyControlPresence({
      userId: `conflict-user-${index}`,
      pair,
      rootRoomId: root.roomId,
      assignment: rootAssignment,
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
    const first = await applyNearbyPartitionTransitions({
      location: west,
      mode: 'neighborhood',
      checkpoint,
      transitions: [later, earlier],
    });
    const second = await applyNearbyPartitionTransitions({
      location: west,
      mode: 'neighborhood',
      checkpoint,
      transitions: [earlier, later],
    });
    expect(first.assignment.roomId).toBe(second.assignment.roomId);
    expect(first.accepted[0]?.transitionId).toBe(earlier.transitionId);
  });
});
