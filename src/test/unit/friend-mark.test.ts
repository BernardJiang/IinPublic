import SEA from 'gun/sea';
import {
  createSignedFriendMark,
  friendMarkPairHash,
  verifySignedFriendMark,
} from '../../shared/friend-mark';
import { roomCreationCredit } from '../../shared/room-creation-credit';

describe('friend reputation marks', () => {
  it('verifies a signed directed mark and rejects tampering', async () => {
    const [alice, bob] = await Promise.all([SEA.pair(), SEA.pair()]);
    const mark = await createSignedFriendMark({
      markerUserId: 'alice',
      targetUserId: 'bob',
      targetPub: bob.pub,
      active: true,
      pair: alice,
    });
    await expect(verifySignedFriendMark(mark)).resolves.toMatchObject({ ok: true });
    await expect(verifySignedFriendMark({ ...mark, active: false })).resolves.toMatchObject({
      ok: false,
      reason: 'payload hash mismatch',
    });
    expect(friendMarkPairHash(alice.pub, bob.pub)).not.toBe(friendMarkPairHash(bob.pub, alice.pub));
  });

  it('requires 12 incoming Friend marks and allows fewer than three blocks', () => {
    expect(roomCreationCredit({ friendsCount: 11, blockCount: 0 })).toMatchObject({ eligible: false });
    expect(roomCreationCredit({ friendsCount: 12, blockCount: 2 })).toMatchObject({ eligible: true });
    expect(roomCreationCredit({ friendsCount: 12, blockCount: 3 })).toMatchObject({ eligible: false });
  });
});
