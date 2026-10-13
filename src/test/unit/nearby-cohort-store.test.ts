import SEA from 'gun/sea';
import type { RoomProtocolCheckpoint } from '../../shared/active-exchange-room';
import {
  createNearbyCohortOccupancyPolicy,
  createNearbyCohortSeatClaim,
  type NearbyCohortSeatClaim,
} from '../../shared/nearby-cohort-admission';
import {
  createNearbyManualCohortSelection,
  nearbyCohortRootGroup,
  selectNearbyCohortReplacementV2,
  type NearbyPartitionGroupV2,
} from '../../shared/nearby-cohort-protocol';
import { deriveNearbyCohortCapacityArtifact } from '../../shared/nearby-cohort-peer-sync';
import type { SeaSigningPair } from '../../shared/p2p-runtime';
import {
  NearbyCohortStore,
  NearbyCohortStoreError,
} from '../../server/services/nearby-cohort-store';

const checkpoint: RoomProtocolCheckpoint = {
  networkId: 'iinpublic-open40-store',
  protocolEpoch: 1,
  manifestSequence: 1,
  manifestHash: 'e'.repeat(64),
  chatroomCapacity: 2,
};
const now = new Date('2026-10-11T08:00:00.000Z');

async function pair(): Promise<SeaSigningPair> {
  return await SEA.pair() as SeaSigningPair;
}

async function claim(input: {
  pair: SeaSigningPair;
  userId: string;
  group: NearbyPartitionGroupV2;
  generation?: number;
  previousClaimHash?: string | null;
  at?: Date;
}): Promise<NearbyCohortSeatClaim> {
  return createNearbyCohortSeatClaim({
    checkpoint,
    pair: input.pair,
    userId: input.userId,
    privacyMode: 'regional',
    group: input.group,
    generation: input.generation ?? 1,
    previousClaimHash: input.previousClaimHash ?? null,
    now: input.at ?? now,
  });
}

async function commitInitial(
  store: NearbyCohortStore,
  seat: NearbyCohortSeatClaim,
): Promise<void> {
  const reservation = await store.reserve({ claim: seat, now });
  await store.commit({ reservationToken: reservation.reservationToken, claim: seat, now });
}

async function splitRoot(store: NearbyCohortStore): Promise<NearbyPartitionGroupV2[]> {
  const root = nearbyCohortRootGroup(checkpoint);
  const summary = await store.summaries({
    checkpoint,
    areaBindingId: (await claim({ pair: await pair(), userId: 'scope', group: root })).areaBindingId,
    currentRoomId: root.roomId,
    now,
  });
  expect(summary.transitions).toHaveLength(1);
  return summary.transitions[0]!.toGroups;
}

describe('NearbyCohortStore bounded admission', () => {
  it('imports a self-verifying phone split after a long hub outage', async () => {
    const store = new NearbyCohortStore();
    const root = nearbyCohortRootGroup(checkpoint);
    const users = await Promise.all([pair(), pair(), pair()]);
    const rootClaims = await Promise.all(users.map((entry, index) => claim({
      pair: entry,
      userId: `offline-${index}`,
      group: root,
      generation: 3,
      previousClaimHash: String(index + 1).repeat(64),
      at: new Date(now.getTime() + index),
    })));
    const artifact = await deriveNearbyCohortCapacityArtifact({
      checkpoint,
      fromGroup: root,
      claims: rootClaims,
      now,
    });
    expect(artifact).not.toBeNull();
    const reconnectedAt = new Date(now.getTime() + 60_000);
    const childClaims = await Promise.all(users.map((entry, index) => claim({
      pair: entry,
      userId: `offline-${index}`,
      group: selectNearbyCohortReplacementV2(artifact!.transition, entry.pub),
      generation: 4,
      previousClaimHash: rootClaims[index]!.claimHash,
      at: reconnectedAt,
    })));
    const result = await store.reconcilePeer({
      checkpoint,
      artifacts: [artifact],
      claims: childClaims,
      now: reconnectedAt,
    });
    expect(result.rejectedArtifacts).toBe(0);
    expect(result.acceptedArtifacts).toBe(1);
    expect(result.acceptedClaims).toBe(6);
    expect(result.active.length).toBeGreaterThanOrEqual(2);
    expect(result.active.every((entry) => entry.group.roomId !== root.roomId)).toBe(true);
  });

  it('uses a trusted signed occupancy policy and opens a two-way cohort transition at target', async () => {
    const authority = await pair();
    const store = new NearbyCohortStore(new Set([authority.pub]));
    const policy = await createNearbyCohortOccupancyPolicy({
      checkpoint,
      pair: authority,
      sequence: 1,
      targetOccupancy: 2,
      maxAreaCohorts: 8,
      reservationTtlMs: 10_000,
      now,
    });
    await expect(store.publishPolicy(checkpoint, policy, now)).resolves.toMatchObject({ sequence: 1 });
    const root = nearbyCohortRootGroup(checkpoint);
    const alice = await pair();
    const bob = await pair();
    await commitInitial(store, await claim({ pair: alice, userId: 'alice', group: root }));
    await commitInitial(store, await claim({ pair: bob, userId: 'bob', group: root }));

    const groups = await splitRoot(store);
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.address.cohortPath)).toEqual(['0', '1']);
    expect(groups.every((group) => group.address.geographicPath === '')).toBe(true);
  });

  it('serializes C+1 concurrent reservations and never admits more than C', async () => {
    const store = new NearbyCohortStore();
    const root = nearbyCohortRootGroup(checkpoint);
    const seedPairs = await Promise.all([pair(), pair()]);
    await commitInitial(store, await claim({ pair: seedPairs[0]!, userId: 'seed-a', group: root }));
    await commitInitial(store, await claim({ pair: seedPairs[1]!, userId: 'seed-b', group: root }));
    const target = (await splitRoot(store))[0]!;
    const entrants = await Promise.all([pair(), pair(), pair()]);
    const claims = await Promise.all(entrants.map((entry, index) => claim({
      pair: entry,
      userId: `entrant-${index}`,
      group: target,
    })));
    const reservations = await Promise.allSettled(claims.map((seat) => store.reserve({ claim: seat, now })));
    expect(reservations.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    const rejection = reservations.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejection.reason).toBeInstanceOf(NearbyCohortStoreError);
    expect(rejection.reason.code).toBe('target-full');
  });

  it('atomically supersedes the old group and rejects replayed or tampered commits', async () => {
    const store = new NearbyCohortStore();
    const root = nearbyCohortRootGroup(checkpoint);
    const firstPairs = await Promise.all([pair(), pair()]);
    const firstClaims = await Promise.all(firstPairs.map((entry, index) => claim({
      pair: entry,
      userId: `seed-${index}`,
      group: root,
    })));
    await Promise.all(firstClaims.map((seat) => commitInitial(store, seat)));
    const [source, target] = await splitRoot(store);
    const current = firstClaims[0]!;
    const replacement = await claim({
      pair: firstPairs[0]!,
      userId: 'seed-0',
      group: source!,
      generation: 2,
      previousClaimHash: current.claimHash,
      at: new Date(now.getTime() + 1_000),
    });
    const replacementReservation = await store.reserve({
      claim: replacement,
      now: new Date(now.getTime() + 1_000),
    });
    await store.commit({
      reservationToken: replacementReservation.reservationToken,
      claim: replacement,
      now: new Date(now.getTime() + 1_000),
    });
    const moved = await claim({
      pair: firstPairs[0]!,
      userId: 'seed-0',
      group: target!,
      generation: 3,
      previousClaimHash: replacement.claimHash,
      at: new Date(now.getTime() + 2_000),
    });
    const selection = await createNearbyManualCohortSelection({
      checkpoint,
      rootRoomId: root.roomId,
      userId: 'seed-0',
      pair: firstPairs[0]!,
      privacyMode: 'regional',
      fromGroup: source!,
      targetGroup: target!,
      visitOrdinal: 1,
      now: new Date(now.getTime() + 2_000),
    });
    const reservation = await store.reserve({ claim: moved, selection, now: new Date(now.getTime() + 2_000) });
    await store.commit({ reservationToken: reservation.reservationToken, claim: moved, now: new Date(now.getTime() + 2_000) });
    expect(store.activeClaim(checkpoint, firstPairs[0]!.pub, new Date(now.getTime() + 2_000))?.group)
      .toEqual(target);
    await expect(store.commit({ reservationToken: reservation.reservationToken, claim: moved, now }))
      .rejects.toMatchObject({ code: 'reservation-missing' });

    const tampered = { ...moved, userId: 'mallory' };
    await expect(store.reserve({ claim: tampered, now: new Date(now.getTime() + 1_000) }))
      .rejects.toThrow(/signature|hash|claim/i);
  });

  it('converges same-generation forks across disconnected indexes', async () => {
    const left = new NearbyCohortStore();
    const right = new NearbyCohortStore();
    const root = nearbyCohortRootGroup(checkpoint);
    const seedPairs = await Promise.all([pair(), pair()]);
    const seedClaims = await Promise.all(seedPairs.map((entry, index) => claim({
      pair: entry,
      userId: `seed-${index}`,
      group: root,
    })));
    for (const store of [left, right]) {
      await Promise.all(seedClaims.map((seat) => commitInitial(store, seat)));
    }
    const leftGroups = await splitRoot(left);
    const rightGroups = await splitRoot(right);
    expect(leftGroups).toEqual(rightGroups);

    const forkPair = await pair();
    const forkA = await claim({ pair: forkPair, userId: 'fork', group: leftGroups[0]! });
    const forkB = await claim({ pair: forkPair, userId: 'fork', group: leftGroups[1]! });
    await left.reconcile({ checkpoint, claims: [forkA], now });
    await right.reconcile({ checkpoint, claims: [forkB], now });
    const mergedLeft = await left.reconcile({ checkpoint, claims: [forkB], now });
    const mergedRight = await right.reconcile({ checkpoint, claims: [forkA], now });
    const expectedHash = [forkA.claimHash, forkB.claimHash].sort()[0];
    expect(left.activeClaim(checkpoint, forkPair.pub, now)?.claimHash).toBe(expectedHash);
    expect(right.activeClaim(checkpoint, forkPair.pub, now)?.claimHash).toBe(expectedHash);
    expect(mergedLeft.active.filter((entry) => entry.pub === forkPair.pub)).toHaveLength(1);
    expect(mergedRight.active.filter((entry) => entry.pub === forkPair.pub)).toHaveLength(1);
  });
});
