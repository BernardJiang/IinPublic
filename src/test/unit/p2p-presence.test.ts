import {
  createPeerAckMessage,
  createPresenceRecord,
  createSignedRoomPresenceRecord,
  listNearbyPresence,
  peerAckSigningPayload,
  prunePresenceRecords,
  validatePeerAckMessage,
  verifySignedPeerAckMessage,
  verifySignedRoomPresenceRecord,
  type PresenceRecord,
} from '../../shared/p2p-presence';
import { activeRoomScope, BASELINE_ROOM_PROTOCOL_CHECKPOINT } from '../../shared/active-exchange-room';
import { createSignedP2PEnvelopeProof, type SeaSigningPair } from '../../shared/p2p-runtime';
import SEA from 'gun/sea';

describe('p2p-presence', () => {
  const fixedNow = new Date('2026-10-04T12:01:00.000Z');

  function scope(roomId: string) {
    return activeRoomScope({
      version: 1,
      roomId,
      enteredAt: fixedNow.toISOString(),
      transitionId: 'presence-test',
      neighborLimit: 12,
      exchangeState: 'active',
      ...BASELINE_ROOM_PROTOCOL_CHECKPOINT,
    }, fixedNow.getTime());
  }

  it('registers and lists nearby live peers', () => {
    const records = new Map<string, PresenceRecord>();
    const alice = createPresenceRecord({ userId: 'alice', pub: 'pub_a' });
    const bob = createPresenceRecord({ userId: 'bob', pub: 'pub_b' });
    records.set(alice.userId, alice);
    records.set(bob.userId, bob);
    const nearby = listNearbyPresence(records, { excludeUserId: 'alice', limit: 10 });
    expect(nearby.map((p) => p.userId)).toEqual(['bob']);
  });

  it('prunes expired presence records', () => {
    const records = new Map<string, PresenceRecord>();
    const stale = createPresenceRecord({
      userId: 'stale',
      pub: 'pub_s',
      now: new Date(Date.now() - 120_000),
    });
    records.set(stale.userId, stale);
    prunePresenceRecords(records, new Date());
    expect(records.size).toBe(0);
  });

  it('validates signed peer ack messages', async () => {
    const pair = await SEA.pair();
    const ackCore = {
      fromUserId: 'alice',
      fromPub: pair.pub,
      toUserId: 'bob',
      toPub: 'pub_b',
    };
    const proof = await createSignedP2PEnvelopeProof({
      pair,
      payload: peerAckSigningPayload(ackCore),
      timestamp: '2026-05-20T00:00:00.000Z',
      nonce: 'nonce_ack',
    });
    const ack = createPeerAckMessage({
      ...ackCore,
      fromPeerId: proof.peerId,
      timestamp: proof.timestamp,
      payloadHash: proof.payloadHash,
      signature: proof.signature,
      nonce: proof.nonce,
      now: new Date('2026-05-20T00:00:00.000Z'),
    });
    expect(validatePeerAckMessage(ack, 'pub_b', new Date('2026-05-20T00:00:01.000Z')).ok).toBe(true);
    expect(validatePeerAckMessage(ack, 'pub_wrong', new Date('2026-05-20T00:00:01.000Z')).ok).toBe(false);
    await expect(verifySignedPeerAckMessage(ack, 'pub_b', new Date('2026-05-20T00:00:01.000Z'))).resolves.toEqual({ ok: true });
    await expect(
      verifySignedPeerAckMessage(
        { ...ack, toPub: 'pub_tampered' },
        'pub_tampered',
        new Date('2026-05-20T00:00:01.000Z'),
      ),
    ).resolves.toEqual({ ok: false, reason: 'payload hash mismatch' });
  });

  it('accepts an authentic signed room presence and rejects tampering', async () => {
    const pair = await SEA.pair() as SeaSigningPair;
    const record = await createSignedRoomPresenceRecord({
      userId: 'alice',
      pair,
      roomScope: scope('hall-a'),
      now: fixedNow,
    });
    await expect(verifySignedRoomPresenceRecord(record, new Date(fixedNow.getTime() + 1000)))
      .resolves.toEqual({ ok: true, record });
    await expect(verifySignedRoomPresenceRecord({
      ...record,
      roomScope: { ...record.roomScope, roomId: 'hall-b' },
    }, new Date(fixedNow.getTime() + 1000))).resolves.toEqual({
      ok: false,
      reason: 'invalid or expired room scope',
    });
    const futureEntry = await createSignedRoomPresenceRecord({
      userId: 'alice',
      pair,
      roomScope: scope('hall-a'),
      enteredAt: new Date(fixedNow.getTime() + 60_000).toISOString(),
      now: fixedNow,
    });
    await expect(verifySignedRoomPresenceRecord(futureEntry, new Date(fixedNow.getTime() - 1_000)))
      .resolves.toEqual({ ok: false, reason: 'room presence enteredAt is in the future' });
  });

  it('lists only signed presence in the exact active room scope', async () => {
    const roomA = scope('hall-a');
    const records = new Map<string, PresenceRecord>();
    const alicePair = await SEA.pair() as SeaSigningPair;
    const bobPair = await SEA.pair() as SeaSigningPair;
    const malloryPair = await SEA.pair() as SeaSigningPair;
    records.set('alice', await createSignedRoomPresenceRecord({ userId: 'alice', pair: alicePair, roomScope: roomA, now: fixedNow }));
    records.set('bob', await createSignedRoomPresenceRecord({ userId: 'bob', pair: bobPair, roomScope: roomA, now: fixedNow }));
    records.set('mallory', await createSignedRoomPresenceRecord({ userId: 'mallory', pair: malloryPair, roomScope: scope('hall-b'), now: fixedNow }));
    records.set('legacy', createPresenceRecord({ userId: 'legacy', pub: 'legacy-pub', now: fixedNow }));

    expect(listNearbyPresence(records, {
      excludeUserId: 'alice',
      roomScope: roomA,
      now: new Date(fixedNow.getTime() + 1000),
    }).map((record) => record.userId)).toEqual(['bob']);
  });

  it('rendezvous peers in the same room/epoch while preserving their manifest checkpoints', async () => {
    const localScope = scope('hall-a');
    const newerScope = {
      ...localScope,
      manifestSequence: localScope.manifestSequence + 1,
      manifestHash: 'b'.repeat(64),
    };
    const pair = await SEA.pair() as SeaSigningPair;
    const records = new Map<string, PresenceRecord>();
    records.set('newer', await createSignedRoomPresenceRecord({
      userId: 'newer',
      pair,
      roomScope: newerScope,
      enteredAt: '2026-10-04T11:00:00.000Z',
      now: fixedNow,
    }));
    expect(listNearbyPresence(records, {
      roomScope: localScope,
      now: new Date(fixedNow.getTime() + 1_000),
    })).toEqual([expect.objectContaining({ userId: 'newer', roomScope: newerScope })]);
  });

  it('applies deterministic newest-first admission independent of heartbeat time', async () => {
    const room = scope('hall-a');
    const pairs = await Promise.all([SEA.pair(), SEA.pair(), SEA.pair()]) as SeaSigningPair[];
    const records = new Map<string, PresenceRecord>();
    for (const [index, userId] of ['oldest', 'middle', 'newest'].entries()) {
      records.set(userId, await createSignedRoomPresenceRecord({
        userId,
        pair: pairs[index]!,
        roomScope: room,
        enteredAt: new Date(fixedNow.getTime() + index * 1_000).toISOString(),
        now: new Date(fixedNow.getTime() + 10_000 - index * 1_000),
      }));
    }
    expect(listNearbyPresence(records, {
      roomScope: room,
      limit: 2,
      now: new Date(fixedNow.getTime() + 11_000),
    }).map((record) => record.userId)).toEqual(['newest', 'middle']);
  });
});
