import SEA from 'gun/sea';
import type { GunService } from '../../server/services/gun-service';
import { UserService } from '../../server/services/user-service';
import { createSignedFriendMark } from '../../shared/friend-mark';
import type { Reputation } from '../../shared/types';

class MemoryUserGun {
  private readonly nested: Record<string, any> = {};
  private readonly flat = new Map<string, any>();

  async getOptional(path: string): Promise<any> {
    return this.flat.get(path) ?? null;
  }

  async getPath(path: string[]): Promise<any> {
    return path.reduce<any>((value, segment) => value?.[segment], this.nested);
  }

  async putPath(path: string[], value: any): Promise<void> {
    let target = this.nested;
    for (const segment of path.slice(0, -1)) {
      target[segment] ??= {};
      target = target[segment];
    }
    target[path[path.length - 1]] = value;
  }

  putFast(path: string, value: any): void {
    this.flat.set(path, value);
  }

  getGun(): any {
    const makeRef = (path: string[]): any => ({
      get: (segment: string) => makeRef([...path, segment]),
      put: (value: any) => {
        void this.putPath(path, value);
      },
    });
    return makeRef([]);
  }
}

const reputation = (blockCount = 0): Reputation => ({
  questionsAnswered: 0,
  talksSent: 0,
  matchesFound: 0,
  friendsCount: 0,
  mutualFriendsCount: 0,
  likedCount: 0,
  dislikedCount: 0,
  starRating: 3,
  reviewCount: 0,
  ageVerified: false,
  ageVerificationVotes: 0,
  blockCount,
  isHidden: false,
});

describe('UserService incoming Friend statistics', () => {
  it('counts each signed marker once, removes an unmark, and unlocks at 12', async () => {
    const gun = new MemoryUserGun();
    const service = new UserService(gun as unknown as GunService);
    const targetPair = await SEA.pair();
    await service.upsertPublicUser({ id: 'target', pub: targetPair.pub, reputation: reputation(2) });

    const markerPairs = await Promise.all(Array.from({ length: 12 }, () => SEA.pair()));
    for (let i = 0; i < markerPairs.length; i += 1) {
      const pair = markerPairs[i];
      const markerUserId = `marker-${i}`;
      await service.upsertPublicUser({ id: markerUserId, pub: pair.pub, reputation: reputation() });
      const mark = await createSignedFriendMark({
        markerUserId,
        targetUserId: 'target',
        targetPub: targetPair.pub,
        active: true,
        pair,
      });
      await service.setFriendMark(mark);
      if (i === 0) await service.setFriendMark(mark); // exact replay is idempotent
    }

    await expect(service.getRoomCreationCredit('target', targetPair.pub)).resolves.toMatchObject({
      friendMarks: 12,
      blockCount: 2,
      eligible: true,
    });

    await service.setFriendMark(await createSignedFriendMark({
      markerUserId: 'marker-0',
      targetUserId: 'target',
      targetPub: targetPair.pub,
      active: false,
      pair: markerPairs[0],
    }));
    await expect(service.getRoomCreationCredit('target', targetPair.pub)).resolves.toMatchObject({
      friendMarks: 11,
      eligible: false,
    });
  });
});
