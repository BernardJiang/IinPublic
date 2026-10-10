import { webcrypto } from 'node:crypto';
import 'fake-indexeddb/auto';
import SEA from 'gun/sea';
import {
  createPlaceAdmissionClaim,
  reconcilePlaceAdmissionEvidence,
  verifyPlaceAdmissionClaim,
} from '../../shared/place-admission-evidence';

Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

const roomId = 'place_32.71_-117.17_abcdefabcdef';

describe('ownerless Place admission evidence', () => {
  it('merges conflicting partitions into the same deterministic C winners', async () => {
    const pairs = await Promise.all(Array.from({ length: 6 }, () => SEA.pair()));
    const claims = await Promise.all(pairs.map((pair, index) => createPlaceAdmissionClaim({
      roomId,
      userId: `user-${index}`,
      pair,
      capacity: 3,
      now: new Date(`2026-10-09T12:00:0${index}.000Z`),
    })));
    const now = new Date('2026-10-09T12:00:30.000Z');
    const partitionA = await reconcilePlaceAdmissionEvidence({ roomId, capacity: 3, evidence: claims.slice(0, 3), now });
    const partitionB = await reconcilePlaceAdmissionEvidence({ roomId, capacity: 3, evidence: claims.slice(3), now });
    const leftFirst = await reconcilePlaceAdmissionEvidence({
      roomId, capacity: 3, evidence: [partitionA.evidence, partitionB.evidence], now,
    });
    const rightFirst = await reconcilePlaceAdmissionEvidence({
      roomId, capacity: 3, evidence: [partitionB.evidence, partitionA.evidence], now,
    });
    expect(leftFirst.winners.map((claim) => claim.userId)).toEqual(['user-0', 'user-1', 'user-2']);
    expect(rightFirst.winners.map((claim) => claim.userId)).toEqual(
      leftFirst.winners.map((claim) => claim.userId),
    );
    expect(leftFirst.losers.map((claim) => claim.userId)).toEqual(['user-3', 'user-4', 'user-5']);
  });

  it('rejects forged, expired, wrong-room, and wrong-capacity claims', async () => {
    const pair = await SEA.pair();
    const created = new Date('2026-10-09T12:00:00.000Z');
    const claim = await createPlaceAdmissionClaim({ roomId, userId: 'alice', pair, capacity: 3, now: created });
    expect((await verifyPlaceAdmissionClaim(claim, {
      roomId, capacity: 3, now: new Date('2026-10-09T12:00:30.000Z'),
    })).ok).toBe(true);
    expect((await verifyPlaceAdmissionClaim({ ...claim, userId: 'mallory' }, {
      roomId, capacity: 3, now: new Date('2026-10-09T12:00:30.000Z'),
    })).ok).toBe(false);
    expect((await verifyPlaceAdmissionClaim(claim, {
      roomId: 'place_40.00_-74.00_abcdefabcdef', capacity: 3, now: new Date('2026-10-09T12:00:30.000Z'),
    })).ok).toBe(false);
    expect((await verifyPlaceAdmissionClaim(claim, {
      roomId, capacity: 4, now: new Date('2026-10-09T12:00:30.000Z'),
    })).ok).toBe(false);
    expect((await verifyPlaceAdmissionClaim(claim, {
      roomId, capacity: 3, now: new Date('2026-10-09T12:10:00.000Z'),
    })).ok).toBe(false);
  });

  it('lets one stable identity occupy only one seat even under multiple user handles', async () => {
    const pair = await SEA.pair();
    const now = new Date('2026-10-09T12:00:00.000Z');
    const [first, alias] = await Promise.all([
      createPlaceAdmissionClaim({ roomId, userId: 'alice', pair, capacity: 3, now }),
      createPlaceAdmissionClaim({
        roomId,
        userId: 'alice-alias',
        pair,
        capacity: 3,
        now: new Date(now.getTime() + 1_000),
        enteredAt: now.toISOString(),
      }),
    ]);
    const result = await reconcilePlaceAdmissionEvidence({
      roomId,
      capacity: 3,
      evidence: [first, alias],
      now: new Date(now.getTime() + 2_000),
    });

    expect(result.winners).toHaveLength(1);
    expect(result.winners[0].userId).toBe('alice-alias');
  });
});
