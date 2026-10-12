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

  it('a member who moves to another group stops counting toward the old one (no false split)', async () => {
    const store = new NearbyPartitionStore();
    const root = nearbyPartitionRootGroup(checkpoint);
    const assign = (group: { roomId: string; path: string }) =>
      nearbyPartitionAssignment({ group, location, mode: 'neighborhood', checkpoint });
    const pairs = await Promise.all([SEA.pair(), SEA.pair(), SEA.pair()]) as SeaSigningPair[];
    const at = new Date('2026-10-10T12:00:00.000Z');
    const presence = (index: number, group: { roomId: string; path: string }, now = at) => createNearbyControlPresence({
      userId: `member-${index}`, pair: pairs[index]!, rootRoomId: root.roomId, assignment: assign(group), checkpoint, now,
    });
    let transitions: any[] = [];
    for (let index = 0; index < 3; index += 1) {
      transitions = (await store.register(await presence(index, root), at)).transitions;
    }
    const [child, sibling] = transitions[0].toGroups as Array<{ roomId: string; path: string }>;
    const later = new Date(at.getTime() + 1_000);
    // member-0 and member-1 fill `child` (C = 2); member-0 then moves to `sibling`.
    expect((await store.register(await presence(0, child!, later), later)).transitions).toEqual([]);
    expect((await store.register(await presence(1, child!, later), later)).transitions).toEqual([]);
    expect((await store.register(await presence(0, sibling!, later), later)).transitions).toEqual([]);
    // member-2 joins `child`: it now holds member-1 and member-2 only — at capacity, not over it.
    const joined = await store.register(await presence(2, child!, later), later);
    expect(joined.transitions).toEqual([]);
    expect(joined.roomWitnessCount).toBe(2);
  });

  it('below the privacy floor, a split divides the witnesses half and half (balanced lanes)', async () => {
    const store = new NearbyPartitionStore();
    const cp: RoomProtocolCheckpoint = { ...checkpoint, chatroomCapacity: 3 };
    const root = nearbyPartitionRootGroup(cp);
    // An accuracy wider than the world leaves no geographic depth: only lanes can divide them.
    const vague = { ...location, accuracy: 30_000_000 };
    const pairs = await Promise.all([SEA.pair(), SEA.pair(), SEA.pair(), SEA.pair()]) as SeaSigningPair[];
    const at = new Date('2026-10-10T12:00:00.000Z');
    let transitions: any[] = [];
    for (let index = 0; index < 4; index += 1) {
      transitions = (await store.register(await createNearbyControlPresence({
        userId: `member-${index}`, pair: pairs[index]!, rootRoomId: root.roomId,
        assignment: nearbyPartitionAssignment({ group: root, location: vague, mode: 'neighborhood', checkpoint: cp }),
        checkpoint: cp, now: at,
      }), at)).transitions;
    }
    expect(transitions).toHaveLength(1);
    expect(transitions[0].laneThreshold).toMatch(/^[a-f0-9]{64}$/);
    const lanes = await Promise.all(pairs.map(async (pair) => (await applyNearbyPartitionTransitions({
      location: vague, mode: 'neighborhood', identity: pair.pub, checkpoint: cp, transitions,
    })).group.path));
    const counts = lanes.reduce((tally, path) => tally.set(path, (tally.get(path) ?? 0) + 1), new Map<string, number>());
    expect([...counts.values()].sort()).toEqual([2, 2]);
    expect([...counts.keys()].sort()).toEqual(['0', '1']);

    // A threshold that does not match the witnesses is rejected by every client.
    const tampered = { ...transitions[0], laneThreshold: '0'.repeat(64) };
    const result = await applyNearbyPartitionTransitions({
      location: vague, mode: 'neighborhood', identity: pairs[0]!.pub, checkpoint: cp, transitions: [tampered],
    });
    expect(result.group.roomId).toBe(root.roomId);
  });
});
