import { User, GPSCoordinate, RelationshipLabel, KnownPerson } from '../../shared/types';
import { GunService } from './gun-service';
import { generateRandomStageName } from '../../shared/user-utils';

export class UserService {
  constructor(private gunService: GunService) {}

  async createUser(userData: Partial<User>): Promise<User> {
    // Server-side user creation logic
    const user: User = {
      id: userData.id || '',
      stageName: userData.stageName || generateRandomStageName(),
      ...(userData.headshot && { headshot: userData.headshot }),
      profile: userData.profile || [],
      reputation: userData.reputation || {
        questionsAnswered: 0,
        talksSent: 0,
        matchesFound: 0,
        friendsCount: 0,
        mutualFriendsCount: 0,
        starRating: 3.0,
        reviewCount: 0,
        ageVerified: false,
        ageVerificationVotes: 0,
        blockCount: 0,
        isHidden: false,
      },
      location: userData.location || { region: '', chatrooms: [] },
      languages: userData.languages || ['en'],
      interests: userData.interests || [],
      createdAt: new Date(),
      lastActive: new Date(),
      knownPeople: userData.knownPeople ?? [],
      ...(userData.pub ? { pub: userData.pub } : {}),
      ...(userData.epub ? { epub: userData.epub } : {}),
    };

    await this.gunService.put(`users/${user.id}`, user);
    return user;
  }

  async addKnownPerson(
    userId: string,
    targetId: string,
    label: RelationshipLabel,
    nickname?: string,
  ): Promise<void> {
    const entry = {
      userId: targetId,
      label,
      ...(nickname ? { nickname } : {}),
      addedAt: new Date().toISOString(),
    };
    await this.gunService.putPath(['users', userId, 'knownPeople', targetId], entry);
    try {
      const u = await this.getUser(userId);
      const list: KnownPerson[] = [
        ...(u.knownPeople || []).filter((k) => k.userId !== targetId),
        { userId: targetId, label, ...(nickname ? { nickname } : {}), addedAt: new Date(entry.addedAt) },
      ];
      await this.gunService.put(`users/${userId}`, { ...u, knownPeople: list });
    } catch {
      /* graph may lag */
    }
  }

  async removeKnownPerson(userId: string, targetId: string): Promise<void> {
    await this.gunService.putPath(['users', userId, 'knownPeople', targetId], null);
    try {
      const u = await this.getUser(userId);
      const list = (u.knownPeople || []).filter((k) => k.userId !== targetId);
      await this.gunService.put(`users/${userId}`, { ...u, knownPeople: list });
    } catch {
      /* ignore */
    }
  }

  async listKnownPeople(userId: string): Promise<KnownPerson[]> {
    const gun = this.gunService.getGun();
    return new Promise((resolve) => {
      const items: KnownPerson[] = [];
      gun
        .get('users')
        .get(userId)
        .get('knownPeople')
        .map()
        .once((data: any, key: string) => {
          if (!data || !key || key.startsWith('_')) return;
          items.push({
            userId: data.userId || key,
            label: data.label,
            ...(data.nickname ? { nickname: data.nickname } : {}),
            addedAt: new Date(data.addedAt),
          });
        });
      setTimeout(() => resolve(items), 500);
    });
  }

  async getUser(userId: string): Promise<User> {
    return await this.gunService.get(`users/${userId}`);
  }

  async updateUserLocation(userId: string, location: GPSCoordinate): Promise<void> {
    await this.gunService.put(`users/${userId}/location`, location);
  }

  async setUserOffline(userId: string): Promise<void> {
    await this.gunService.put(`users/${userId}/status`, 'offline');
  }
}
