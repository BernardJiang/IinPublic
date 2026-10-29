import type { GunService } from '../../server/services/gun-service';
import { UserService } from '../../server/services/user-service';
import type { QuestionAnswer } from '../../shared/types';

const profile = (id: string, visibility: NonNullable<QuestionAnswer['visibility']>): QuestionAnswer => ({
  id,
  question: `Question ${id}`,
  answer: `Answer ${id}`,
  isAuto: false,
  answeredAt: new Date(),
  visibility,
});

describe('legacy server public Gun mirror', () => {
  it('publishes only public profile rows and no relationship list on creation and upsert', async () => {
    const put = jest.fn().mockResolvedValue(undefined);
    const putFast = jest.fn();
    const service = new UserService({ put, putFast } as unknown as GunService);
    const input = {
      id: 'owner',
      stageName: 'Owner',
      profile: [profile('public', 'public'), profile('contacts', 'contacts_only'), profile('private', 'private')],
      knownPeople: [{ userId: 'friend', labels: ['friend' as const], addedAt: new Date() }],
    };

    const created = await service.createUser(input);
    expect(created.profile).toHaveLength(3);
    expect(put).toHaveBeenCalledWith('users/owner', expect.objectContaining({
      profile: [input.profile[0]],
      knownPeople: [],
    }));
    const published = await service.upsertPublicUser(input);
    expect(published.profile).toEqual([input.profile[0]]);
    expect(published.knownPeople).toEqual([]);
    expect(putFast).toHaveBeenCalledWith('users/owner', expect.objectContaining({
      profile: [input.profile[0]],
      knownPeople: [],
    }));
  });

  it('tombstones the former full-profile field while retaining a process-local compatibility copy', async () => {
    const put = jest.fn().mockResolvedValue(undefined);
    const getOptional = jest.fn().mockResolvedValue(null);
    const service = new UserService({ put, getOptional } as unknown as GunService);
    const rows = [profile('public', 'public'), profile('private', 'private')];
    await service.updatePublicProfileFoundation('owner', { profile: rows });

    expect(put).toHaveBeenCalledWith('user-public-profile/owner', expect.objectContaining({
      profileJson: JSON.stringify([rows[0]]),
      fullProfileJson: null,
    }));
    expect(JSON.stringify(put.mock.calls)).not.toContain('Answer private');
  });
});
