import {
  createPeerAckMessage,
  createPresenceRecord,
  listNearbyPresence,
  prunePresenceRecords,
  validatePeerAckMessage,
  type PresenceRecord,
} from '../../shared/p2p-presence';

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

  it('validates peer ack messages', () => {
    const ack = createPeerAckMessage({
      fromUserId: 'alice',
      fromPub: 'pub_a',
      toUserId: 'bob',
      toPub: 'pub_b',
    });
    expect(validatePeerAckMessage(ack, 'pub_b').ok).toBe(true);
    expect(validatePeerAckMessage(ack, 'pub_wrong').ok).toBe(false);
  });
});
