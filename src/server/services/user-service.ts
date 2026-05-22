import { User, Reputation, GPSCoordinate, RelationshipLabel, KnownPerson, TalkIntakeFilters } from '../../shared/types';
import { GunService } from './gun-service';
import { generateRandomStageName } from '../../shared/user-utils';
import { getDefaultTalkIntakeFilters, normalizeCustomBlockedTerms } from '../../shared/talk-intake-filters';
import { CONFIG } from '../../shared/config';
import { filterProfileAttributesForViewer } from '../../shared/profile-privacy';
import { v4 as uuidv4 } from 'uuid';
import { assertStageNameAllowed, TECHSUPPORT_ROOT_USER_ID } from '../../shared/techsupport';

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
      const { _, ...rest } = data as any;
      // Gun may wrap stored objects under a nested `#` key; unwrap for stable reads.
      const repCandidate = rest && typeof rest === 'object' && (rest['#'] && typeof rest['#'] === 'object')
        ? rest['#']
        : rest;
      return { ...UserService.DEFAULT_REPUTATION, ...(repCandidate as any) } as Reputation;
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
        customBlockedTerms: normalizeCustomBlockedTerms(
          parsed.customBlockedTerms ?? fallback.customBlockedTerms,
        ),
      };
    } catch {
      return fallback;
    }
  }

  async createUser(userData: Partial<User>): Promise<User> {
    // Server-side user creation logic
    const id = userData.id || uuidv4();
    const stageName = userData.stageName || generateRandomStageName();
    assertStageNameAllowed(stageName, {
      allowTechSupportRoot: id === TECHSUPPORT_ROOT_USER_ID,
    });
    const user: User = {
      id,
      stageName,
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
      ...(userData.networkRole ? { networkRole: userData.networkRole } : {}),
      ...(userData.supportMuted ? { supportMuted: userData.supportMuted } : {}),
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
  }

  async removeKnownPerson(userId: string, targetId: string): Promise<void> {
    await this.gunService.putPath(['users', userId, 'knownPeople', targetId], null);
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

  /**
   * @param view Omit for internal/server callers that need the full stored profile.
   * From HTTP pass `{ viewerId }`: use `null` when the query is absent (stranger); same id as `userId` returns full profile rows.
   */
  async getUser(userId: string, view?: { viewerId: string | null }): Promise<User> {
    const user = await this.gunService.get(`users/${userId}`) as User;
    const publicProfile = await this.gunService.getOptional(`user-public-profile/${userId}`, 500) as
      | {
          headshot?: string;
          languagesJson?: string;
          profileJson?: string;
          interestsJson?: string;
        }
      | null;
    let profile = publicProfile
      ? this.parseJsonArray(publicProfile.profileJson, user.profile || [])
      : user.profile || [];
    if (view !== undefined) {
      const raw = view.viewerId;
      const v = typeof raw === 'string' ? raw.trim() : '';
      if (!v || v !== userId) {
        const viewerIsContact = v.length > 0 ? await this.isKnownPerson(userId, v) : false;
        profile = filterProfileAttributesForViewer(profile, { viewerIsContact });
      }
    }

    if (!publicProfile) {
      return {
        ...user,
        profile,
      };
    }

    // Server reputation updates are written to `users/<id>/reputation`.
    // Ensure we always resolve that sub-node into the returned object.
    const reputation = await this.readReputation(userId);
    return {
      ...user,
      reputation,
      ...(publicProfile.headshot ? { headshot: publicProfile.headshot } : {}),
      languages: this.parseJsonArray(publicProfile.languagesJson, user.languages || ['en']),
      profile,
      interests: this.parseJsonArray(publicProfile.interestsJson, user.interests || []),
    };
  }

  /** True if `ownerId` has saved `candidateId` under knownPeople (public Gun path). */
  async isKnownPerson(ownerId: string, candidateId: string): Promise<boolean> {
    if (!ownerId || !candidateId) return false;
    const node = await this.gunService.getPath(['users', ownerId, 'knownPeople', candidateId]);
    return !!(node && typeof node === 'object' && (node as { userId?: string }).userId);
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

  /**
   * Normalize blurred or raw location nodes from Gun into GPS for intake distance rules.
   * Web client writes `users/:id/location` (often with `trueLocation`); parent `users/:id` may not embed it.
   */
  private parseStoredLocationForDelivery(raw: unknown): GPSCoordinate | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const o = raw as Record<string, unknown>;
    const inner = o.trueLocation && typeof o.trueLocation === 'object' ? (o.trueLocation as Record<string, unknown>) : o;
    if (
      typeof inner.latitude !== 'number' ||
      typeof inner.longitude !== 'number' ||
      typeof inner.accuracy !== 'number'
    ) {
      return undefined;
    }
    const ts = inner.timestamp;
    return {
      latitude: Number(inner.latitude),
      longitude: Number(inner.longitude),
      accuracy: Number(inner.accuracy),
      timestamp: ts instanceof Date ? ts : new Date(typeof ts === 'string' || typeof ts === 'number' ? ts : Date.now()),
    };
  }

  async getUserDeliveryContext(userId: string): Promise<{
    talkFilters: TalkIntakeFilters;
    ageVerified: boolean;
    location?: GPSCoordinate;
    /** Normalized lowercase interest names (profile) for bulk-send tag targeting overlap. */
    interestTokens: string[];
  }> {
    const userNode = await this.gunService.get(`users/${userId}`) as Partial<User>;
    let interestTokens: string[] = [];
    try {
      const u = await this.getUser(userId);
      interestTokens =
        Array.isArray(u.interests) && u.interests.length > 0
          ? u.interests
              .map((t) =>
                typeof t?.name === 'string'
                  ? t.name.trim().toLowerCase()
                  : ''
              )
              .filter(Boolean)
          : [];
    } catch {
      interestTokens = [];
    }
    const talkFilters = await this.getUserTalkFilters(userId);
    let location = this.parseStoredLocationForDelivery((userNode as { location?: unknown })?.location as unknown);
    if (!location) {
      try {
        const locNode = await this.gunService.get(`users/${userId}/location`);
        location = this.parseStoredLocationForDelivery(locNode);
      } catch {
        /* no separate location key */
      }
    }
    const ageVerified = await this.readAgeVerified(userId);
    return {
      talkFilters,
      ageVerified,
      interestTokens,
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
    return this.gunService
      .getPath([AGE_VERIF_KEY, userId])
      .then((data) => !!(data as { verified?: boolean } | undefined)?.verified)
      .catch(() => false);
  }

  async vouchAgeVerified(targetUserId: string): Promise<void> {
    // Read current votes from the server-owned path (browser never writes here).
    const current = await this.gunService.getPath([AGE_VERIF_KEY, targetUserId]).catch(() => null);
    const votes = Number(current?.votes || 0) + 1;
    const verified = votes >= CONFIG.AGE_VERIFICATION_THRESHOLD;
    await this.gunService.putPath([AGE_VERIF_KEY, targetUserId], { votes, verified });
  }
}
