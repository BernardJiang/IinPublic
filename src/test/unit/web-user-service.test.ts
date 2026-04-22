import { WebUserService } from '../../web/services/web-user-service';
import type { GunPair } from '../../web/services/gun-bridge';
import type { User } from '../../shared/types';

const pair: GunPair = {
  pub: 'pub-key',
  priv: 'priv-key',
  epub: 'epub-key',
  epriv: 'epriv-key',
};

describe('WebUserService', () => {
  it('creates a public user record and stores owner-only fields privately', async () => {
    const gunService = {
      put: jest.fn().mockResolvedValue(undefined),
      putPrivate: jest.fn().mockResolvedValue(undefined),
      getStoredPair: jest.fn(() => pair),
    };

    const service = new WebUserService(gunService as any);
    const user = await service.createUser({
      stageName: 'Alice',
      headshot: 'data:image/png;base64,abc',
      profile: [
        {
          id: 'qa1',
          question: 'Coffee?',
          answer: 'Yes',
          isAuto: false,
          answeredAt: new Date('2026-04-21T10:00:00.000Z'),
        },
      ],
      languages: ['en', 'fr'],
      interests: [{ id: 'coffee', name: 'Coffee', category: 'other', popularity: 1 }],
      knownPeople: [
        {
          userId: 'friend-1',
          label: 'friend',
          addedAt: new Date('2026-04-21T11:00:00.000Z'),
        },
      ],
      pub: pair.pub,
      epub: pair.epub,
    });

    expect(gunService.put).toHaveBeenCalledTimes(1);
    const publicRecord = gunService.put.mock.calls[0][1] as User;
    expect(publicRecord.stageName).toBe('Alice');
    expect(publicRecord.pub).toBe(pair.pub);
    expect(publicRecord.epub).toBe(pair.epub);
    expect(publicRecord.profile).toEqual([]);
    expect(publicRecord.languages).toEqual([]);
    expect(publicRecord.interests).toEqual([]);
    expect(publicRecord.knownPeople).toEqual([]);
    expect(publicRecord.headshot).toBeUndefined();

    expect(gunService.putPrivate).toHaveBeenCalledWith(
      'profile',
      expect.objectContaining({
        headshot: 'data:image/png;base64,abc',
        profile: user.profile,
        languages: ['en', 'fr'],
        knownPeople: user.knownPeople,
      }),
    );
  });

  it('merges private user data back into the current user record', async () => {
    const publicUser: User = {
      id: 'user-1',
      stageName: 'Alice',
      profile: [],
      reputation: {
        questionsAnswered: 0,
        talksSent: 0,
        matchesFound: 0,
        friendsCount: 0,
        mutualFriendsCount: 0,
        starRating: 3,
        reviewCount: 0,
        ageVerified: false,
        ageVerificationVotes: 0,
        blockCount: 0,
        isHidden: false,
      },
      location: { region: 'region-1', chatrooms: [] },
      languages: ['en'],
      interests: [],
      createdAt: new Date('2026-04-21T10:00:00.000Z'),
      lastActive: new Date('2026-04-21T10:00:00.000Z'),
      knownPeople: [],
      pub: pair.pub,
      epub: pair.epub,
    };
    const gunService = {
      get: jest.fn().mockResolvedValue(publicUser),
      getPrivate: jest.fn().mockResolvedValue({
        headshot: 'data:image/png;base64,private',
        profile: [
          {
            id: 'qa1',
            question: 'Coffee?',
            answer: 'Yes',
            isAuto: false,
            answeredAt: new Date('2026-04-21T12:00:00.000Z'),
          },
        ],
        languages: ['en', 'fr'],
        interests: [{ id: 'coffee', name: 'Coffee', category: 'other', popularity: 1 }],
        knownPeople: [
          {
            userId: 'friend-1',
            label: 'friend',
            addedAt: new Date('2026-04-21T11:00:00.000Z'),
          },
        ],
      }),
      getStoredPair: jest.fn(() => pair),
    };

    const service = new WebUserService(gunService as any);
    const user = await service.getUser('user-1');

    expect(gunService.getPrivate).toHaveBeenCalledWith('profile');
    expect(user.headshot).toBe('data:image/png;base64,private');
    expect(user.languages).toEqual(['en', 'fr']);
    expect(user.profile).toHaveLength(1);
    expect(user.knownPeople).toHaveLength(1);
  });

  it('publishes identity keys without rewriting private user fields', async () => {
    const gunService = {
      put: jest.fn().mockResolvedValue(undefined),
    };

    const service = new WebUserService(gunService as any);
    await service.publishIdentityKeys('user-1', pair);

    expect(gunService.put).toHaveBeenCalledWith('users/user-1', {
      pub: pair.pub,
      epub: pair.epub,
    });
  });
});
