import {
  createPeerAckMessage,
  createPresenceRecord,
  listNearbyPresence,
  peerAckSigningPayload,
  prunePresenceRecords,
  validatePeerAckMessage,
  verifySignedPeerAckMessage,
  type PresenceRecord,
} from '../../shared/p2p-presence';
import { createSignedP2PEnvelopeProof } from '../../shared/p2p-runtime';
import SEA from 'gun/sea';

describe('p2p-presence', () => {
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
});
