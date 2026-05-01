import { User, GPSCoordinate, RelationshipLabel, KnownPerson, TalkIntakeFilters } from '../../shared/types';
import { GunService } from './gun-service';
import { generateRandomStageName } from '../../shared/user-utils';
import { getDefaultTalkIntakeFilters } from '../../shared/talk-intake-filters';

const PUBLIC_TALK_FILTERS_KEY = 'user-talk-filters';

export class UserService {
  constructor(private gunService: GunService) {}

  private parseJsonArray<T>(value: unknown, fallback: T[]): T[] {
    if (typeof value !== 'string') return fallback;
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed as T[] : fallback;
    } catch {
      return fallback;
    }
  }

  private parseTalkFilters(value: unknown, seedLanguages?: string[]): TalkIntakeFilters {
    const fallback = getDefaultTalkIntakeFilters(seedLanguages);
    if (typeof value !== 'string') return fallback;
    try {
      const parsed = JSON.parse(value) as Partial<TalkIntakeFilters>;
      return {
        ...fallback,
        ...parsed,
        allowedLanguages: Array.isArray(parsed.allowedLanguages) && parsed.allowedLanguages.length > 0
          ? parsed.allowedLanguages
          : fallback.allowedLanguages,
        allowedTalkTypes: Array.isArray(parsed.allowedTalkTypes) && parsed.allowedTalkTypes.length > 0
          ? parsed.allowedTalkTypes
          : fallback.allowedTalkTypes,
      };
    } catch {
      return fallback;
    }
  }

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
        likedCount: 0,
        dislikedCount: 0,
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
    await this.gunService.put(`${PUBLIC_TALK_FILTERS_KEY}/${user.id}`, {
      filtersJson: JSON.stringify(userData.talkFilters || getDefaultTalkIntakeFilters(user.languages)),
    });
    return user;
  }

  async addKnownPerson(
    userId: string,
    targetId: string,
    label: RelationshipLabel,
    nickname?: string,
    extras?: { customLabel?: string; rating?: number; notes?: string },
  ): Promise<void> {
    const entry = {
      userId: targetId,
      label,
      ...(nickname ? { nickname } : {}),
      ...(extras?.customLabel ? { customLabel: extras.customLabel } : {}),
      ...(typeof extras?.rating === 'number' ? { rating: extras.rating } : {}),
      ...(extras?.notes ? { notes: extras.notes } : {}),
      addedAt: new Date().toISOString(),
    };
    await this.gunService.putPath(['users', userId, 'knownPeople', targetId], entry);
    try {
      const u = await this.getUser(userId);
      const list: KnownPerson[] = [
        ...(u.knownPeople || []).filter((k) => k.userId !== targetId),
        {
          userId: targetId,
          label,
          ...(nickname ? { nickname } : {}),
          ...(extras?.customLabel ? { customLabel: extras.customLabel } : {}),
          ...(typeof extras?.rating === 'number' ? { rating: extras.rating } : {}),
          ...(extras?.notes ? { notes: extras.notes } : {}),
          addedAt: new Date(entry.addedAt),
        },
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
    const user = await this.gunService.get(`users/${userId}`) as User;
    const publicProfile = await this.gunService.get(`user-public-profile/${userId}`).catch(() => null) as
      | {
          headshot?: string;
          languagesJson?: string;
          profileJson?: string;
          interestsJson?: string;
        }
      | null;
    if (!publicProfile) {
      return user;
    }
    return {
      ...user,
      ...(publicProfile.headshot ? { headshot: publicProfile.headshot } : {}),
      languages: this.parseJsonArray(publicProfile.languagesJson, user.languages || ['en']),
      profile: this.parseJsonArray(publicProfile.profileJson, user.profile || []),
      interests: this.parseJsonArray(publicProfile.interestsJson, user.interests || []),
    };
  }

  async getUserTalkFilters(userId: string): Promise<TalkIntakeFilters> {
    const userNode = await this.gunService.get(`users/${userId}`) as Partial<User>;
    const filtersNode = await this.gunService.get(`${PUBLIC_TALK_FILTERS_KEY}/${userId}`).catch(() => null) as
      | { filtersJson?: string }
      | null;
    return this.parseTalkFilters(filtersNode?.filtersJson, userNode?.languages);
  }

  async getUserDeliveryContext(userId: string): Promise<{
    talkFilters: TalkIntakeFilters;
    ageVerified: boolean;
    location?: GPSCoordinate;
  }> {
    const userNode = await this.gunService.get(`users/${userId}`) as Partial<User>;
    const talkFilters = await this.getUserTalkFilters(userId);
    const rawLocation = (userNode as any)?.location?.trueLocation || (userNode as any)?.location;
    const location =
      rawLocation &&
      typeof rawLocation.latitude === 'number' &&
      typeof rawLocation.longitude === 'number' &&
      typeof rawLocation.accuracy === 'number'
        ? {
            latitude: Number(rawLocation.latitude),
            longitude: Number(rawLocation.longitude),
            accuracy: Number(rawLocation.accuracy),
            timestamp: rawLocation.timestamp instanceof Date
              ? rawLocation.timestamp
              : new Date(rawLocation.timestamp || Date.now()),
          }
        : undefined;
    return {
      talkFilters,
      ageVerified: !!userNode?.reputation?.ageVerified,
      ...(location ? { location } : {}),
    };
  }

  async updateUserLocation(userId: string, location: GPSCoordinate): Promise<void> {
    await this.gunService.put(`users/${userId}/location`, location);
  }

  async setUserOffline(userId: string): Promise<void> {
    await this.gunService.put(`users/${userId}/status`, 'offline');
  }
}
