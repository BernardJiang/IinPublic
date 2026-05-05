import { User, Reputation, GPSCoordinate, RelationshipLabel, KnownPerson, TalkIntakeFilters } from '../../shared/types';
import { GunService } from './gun-service';
import { generateRandomStageName } from '../../shared/user-utils';
import { getDefaultTalkIntakeFilters } from '../../shared/talk-intake-filters';
import { CONFIG } from '../../shared/config';

const PUBLIC_TALK_FILTERS_KEY = 'user-talk-filters';
const USER_BLOCKS_KEY = 'user-blocks';
const USER_BLOCKED_BY_KEY = 'user-blocked-by';
const AGE_VERIF_KEY = 'user-age-verification';

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

private static readonly DEFAULT_REPUTATION: Reputation = {
    questionsAnswered: 0, talksSent: 0, matchesFound: 0, friendsCount: 0,
    mutualFriendsCount: 0, likedCount: 0, dislikedCount: 0, starRating: 3.0,
    reviewCount: 0, ageVerified: false, ageVerificationVotes: 0, blockCount: 0, isHidden: false,
  };

  /**
   * Read the reputation sub-node via getPath(['users/id', 'reputation']).
   * getPath chains gun.get('users/id').get('reputation') which follows Gun's
   * linked sub-node reference regardless of how the data was originally stored.
   * Returns defaults if the node is not found or times out.
   */
  private async readReputation(userId: string): Promise<Reputation> {
    try {
      const data = await this.gunService.getPath([`users/${userId}`, 'reputation']);
      if (!data || typeof data !== 'object') return { ...UserService.DEFAULT_REPUTATION };
      const { _, ...rep } = data as any;
      return { ...UserService.DEFAULT_REPUTATION, ...rep } as Reputation;
    } catch {
      return { ...UserService.DEFAULT_REPUTATION };
    }
  }

  /**
   * Write updated reputation via gun.get('users/id').get('reputation').put().
   * Fire-and-forget (no ack wait) — Gun's in-memory put is synchronous so the
   * next readReputation call will see the updated data immediately.
   */
  private writeReputation(userId: string, reputation: Reputation): void {
    this.gunService.getGun().get(`users/${userId}`).get('reputation').put(reputation);
  }

  private async applyBlockCountDelta(targetUserId: string, delta: number): Promise<void> {
    const reputation = await this.readReputation(targetUserId);
    const nextValue = Math.max(0, Number(reputation.blockCount || 0) + delta);
    if (nextValue === Number(reputation.blockCount || 0)) return;
    this.writeReputation(targetUserId, { ...reputation, blockCount: nextValue });
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
    for (const blockedUserId of user.blockedUserIds || []) {
      await this.gunService.putPath([USER_BLOCKS_KEY, user.id, blockedUserId], {
        blockedAt: new Date().toISOString(),
      });
      await this.gunService.putPath([USER_BLOCKED_BY_KEY, blockedUserId, user.id], {
        blockedAt: new Date().toISOString(),
      });
    }
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

  async getBlockedUserIds(userId: string): Promise<string[]> {
    // Use chained navigation to match how the browser writes blocks via putNested.
    // gun.get('user-blocks/userId') is a flat soul unrelated to gun.get('user-blocks').get(userId).
    const gun = this.gunService.getGun();
    return new Promise((resolve) => {
      const ids: string[] = [];
      gun.get(USER_BLOCKS_KEY).get(userId).map().once((data: any, key: string) => {
        if (data != null && key && !key.startsWith('_')) ids.push(key);
      });
      setTimeout(() => resolve(ids), 500);
    });
  }

  async isBlocked(blockerId: string, targetId: string): Promise<boolean> {
    if (!blockerId || !targetId) return false;
    const node = await this.gunService.getPath([USER_BLOCKS_KEY, blockerId, targetId]);
    return !!node;
  }

  async getBlockStatus(viewerId: string, targetId: string): Promise<{
    blocked: boolean;
    blockedBy: boolean;
    eitherBlocked: boolean;
  }> {
    const [blocked, blockedBy] = await Promise.all([
      this.isBlocked(viewerId, targetId),
      this.isBlocked(targetId, viewerId),
    ]);
    return {
      blocked,
      blockedBy,
      eitherBlocked: blocked || blockedBy,
    };
  }

  async blockUser(blockerId: string, targetId: string): Promise<{ changed: boolean; blockedUserIds: string[] }> {
    if (!blockerId || !targetId) {
      throw new Error('blockerId and targetId required');
    }
    if (blockerId === targetId) {
      throw new Error('Cannot block yourself');
    }
    const alreadyBlocked = await this.isBlocked(blockerId, targetId);
    if (alreadyBlocked) {
      return { changed: false, blockedUserIds: await this.getBlockedUserIds(blockerId) };
    }
    const blockedAt = new Date().toISOString();
    await this.gunService.putPath([USER_BLOCKS_KEY, blockerId, targetId], { blockedAt });
    await this.gunService.putPath([USER_BLOCKED_BY_KEY, targetId, blockerId], { blockedAt });
    await this.applyBlockCountDelta(targetId, 1);
    return { changed: true, blockedUserIds: await this.getBlockedUserIds(blockerId) };
  }

  async unblockUser(blockerId: string, targetId: string): Promise<{ changed: boolean; blockedUserIds: string[] }> {
    if (!blockerId || !targetId) {
      throw new Error('blockerId and targetId required');
    }
    const alreadyBlocked = await this.isBlocked(blockerId, targetId);
    if (!alreadyBlocked) {
      return { changed: false, blockedUserIds: await this.getBlockedUserIds(blockerId) };
    }
    await this.gunService.putPath([USER_BLOCKS_KEY, blockerId, targetId], null);
    await this.gunService.putPath([USER_BLOCKED_BY_KEY, targetId, blockerId], null);
    await this.applyBlockCountDelta(targetId, -1);
    return { changed: true, blockedUserIds: await this.getBlockedUserIds(blockerId) };
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
    const ageVerified = await this.readAgeVerified(userId);
    return {
      talkFilters,
      ageVerified,
      ...(location ? { location } : {}),
    };
  }

  async updateUserLocation(userId: string, location: GPSCoordinate): Promise<void> {
    await this.gunService.put(`users/${userId}/location`, location);
  }

  async setUserOffline(userId: string): Promise<void> {
    await this.gunService.put(`users/${userId}/status`, 'offline');
  }

  /**
   * Read age-verified flag from the server-owned path that the browser never writes to,
   * avoiding Gun peer-sync races with the user's reputation sub-node.
   */
  private readAgeVerified(userId: string): Promise<boolean> {
    const gun = this.gunService.getGun();
    return new Promise((resolve) => {
      let settled = false;
      const settle = (v: boolean) => { if (!settled) { settled = true; resolve(v); } };
      gun.get(AGE_VERIF_KEY).get(userId).once((data: any) => settle(!!data?.verified));
      setTimeout(() => settle(false), 1000);
    });
  }

  async vouchAgeVerified(targetUserId: string): Promise<void> {
    // Read current votes from the server-owned path (browser never writes here).
    const gun = this.gunService.getGun();
    const current = await new Promise<any>((resolve) => {
      let settled = false;
      const settle = (v: any) => { if (!settled) { settled = true; resolve(v); } };
      gun.get(AGE_VERIF_KEY).get(targetUserId).once((data: any) => settle(data));
      setTimeout(() => settle(null), 500);
    });
    const votes = Number(current?.votes || 0) + 1;
    const verified = votes >= CONFIG.AGE_VERIFICATION_THRESHOLD;
    gun.get(AGE_VERIF_KEY).get(targetUserId).put({ votes, verified });
  }
}
