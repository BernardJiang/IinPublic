import { User, Reputation, GPSCoordinate, RelationshipLabel, KnownPerson, TalkIntakeFilters, QuestionAnswer, Tag } from '../../shared/types';
import { GunService } from './gun-service';
import { generateRandomStageName } from '../../shared/user-utils';
import { getDefaultTalkIntakeFilters, normalizeCustomBlockedTerms } from '../../shared/talk-intake-filters';
import { CONFIG } from '../../shared/config';
import { filterProfileAttributesForViewer } from '../../shared/profile-privacy';
import { v4 as uuidv4 } from 'uuid';
import { assertStageNameAllowed, TECHSUPPORT_ROOT_USER_ID } from '../../shared/techsupport';
import { buildUserTagsEnvelope, USER_TAGS_KEY } from '../../shared/user-tags';

const PUBLIC_TALK_FILTERS_KEY = 'user-talk-filters';
const PUBLIC_PROFILE_FOUNDATION_KEY = 'user-public-profile';
const USER_BLOCKS_KEY = 'user-blocks';
const USER_BLOCKED_BY_KEY = 'user-blocked-by';
const AGE_VERIF_KEY = 'user-age-verification';

export class UserService {
  private readonly recentBlockMutations = new Map<string, boolean>();
  private readonly recentKnownPersonMutations = new Map<string, boolean>();
  private readonly recentPublicProfileFoundations = new Map<string, {
    headshot?: string | null;
    languagesJson?: string;
    profileJson?: string;
    fullProfileJson?: string;
    interestsJson?: string;
  }>();
  private readonly recentPublicUsers = new Map<string, User>();
  private readonly recentReputationWrites = new Map<string, Reputation>();

  constructor(private gunService: GunService) {}

  /** E2E / test-only: in-memory block overrides survive Gun graph clears. */
  resetBlockMutationsForTesting(): void {
    this.recentBlockMutations.clear();
    this.recentKnownPersonMutations.clear();
    this.recentPublicProfileFoundations.clear();
    this.recentPublicUsers.clear();
    this.recentReputationWrites.clear();
  }

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
    const recent = this.recentReputationWrites.get(userId);
    if (recent) return { ...UserService.DEFAULT_REPUTATION, ...recent };
    try {
      const data = await this.gunService.getPath([`users/${userId}`, 'reputation'], 300, 500);
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
    const reputation = this.recentReputationWrites.get(targetUserId) || await this.readReputation(targetUserId);
    const nextValue = Math.max(0, Number(reputation.blockCount || 0) + delta);
    if (nextValue === Number(reputation.blockCount || 0)) return;
    const nextReputation = { ...reputation, blockCount: nextValue };
    this.recentReputationWrites.set(targetUserId, nextReputation);
    this.writeReputation(targetUserId, nextReputation);
  }

  private async getBlockCountForUser(userId: string): Promise<number> {
    const blockers = new Set<string>();
    const gun = this.gunService.getGun();
    await new Promise<void>((resolve) => {
      gun.get(USER_BLOCKED_BY_KEY).get(userId).map().once((data: any, key: string) => {
        if (data != null && key && !key.startsWith('_')) blockers.add(key);
      });
      setTimeout(resolve, 300);
    });
    for (const [key, blocked] of this.recentBlockMutations.entries()) {
      const [blockerId, targetId] = key.split('\0');
      if (!blockerId || targetId !== userId) continue;
      if (blocked) blockers.add(blockerId);
      else blockers.delete(blockerId);
    }
    return blockers.size;
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

  async upsertPublicUser(userData: Partial<User>): Promise<User> {
    const id = userData.id || uuidv4();
    const stageName = userData.stageName || generateRandomStageName();
    assertStageNameAllowed(stageName, {
      allowTechSupportRoot: id === TECHSUPPORT_ROOT_USER_ID,
    });
    const user: User = {
      id,
      stageName,
      ...(userData.headshot ? { headshot: userData.headshot } : {}),
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
      createdAt: userData.createdAt || new Date(),
      lastActive: new Date(),
      knownPeople: userData.knownPeople ?? [],
      ...(userData.pub ? { pub: userData.pub } : {}),
      ...(userData.epub ? { epub: userData.epub } : {}),
      ...(userData.networkRole ? { networkRole: userData.networkRole } : {}),
      ...(userData.supportMuted ? { supportMuted: userData.supportMuted } : {}),
    };
    this.recentPublicUsers.set(user.id, user);
    this.gunService.putFast(`users/${user.id}`, user);
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
    this.recentKnownPersonMutations.set(this.knownPersonKey(userId, targetId), true);
  }

  async removeKnownPerson(userId: string, targetId: string): Promise<void> {
    await this.gunService.putPath(['users', userId, 'knownPeople', targetId], null);
    this.recentKnownPersonMutations.set(this.knownPersonKey(userId, targetId), false);
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
    const user = (
      this.recentPublicUsers.get(userId) ??
      await this.gunService.getOptional(`users/${userId}`, 1200)
    ) as User | null;
    if (!user) {
      throw new Error(`No data found for key: users/${userId}`);
    }
    const publicProfile = (
      this.recentPublicProfileFoundations.get(userId) ??
      await this.gunService.getOptional(`${PUBLIC_PROFILE_FOUNDATION_KEY}/${userId}`, 1200)
    ) as
      | {
          headshot?: string | null;
          languagesJson?: string;
          profileJson?: string;
          fullProfileJson?: string;
          interestsJson?: string;
        }
      | null;
    let profile = publicProfile
      ? this.parseJsonArray(publicProfile.fullProfileJson ?? publicProfile.profileJson, user.profile || [])
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
      const reputation = await this.mergeAgeVerificationIntoReputation(
        userId,
        user.reputation ?? (await this.readReputation(userId)),
      );
      const blockCount = await this.getBlockCountForUser(userId);
      return {
        ...user,
        profile,
        reputation: { ...reputation, blockCount },
      };
    }

    // Server reputation updates are written to `users/<id>/reputation`.
    // Ensure we always resolve that sub-node into the returned object.
    const storedReputation = this.recentReputationWrites.get(userId) ?? user.reputation;
    const reputation = await this.mergeAgeVerificationIntoReputation(
      userId,
      storedReputation
        ? { ...UserService.DEFAULT_REPUTATION, ...storedReputation }
        : await this.readReputation(userId),
    );
    const blockCount = await this.getBlockCountForUser(userId);
    const { headshot: _storedHeadshot, ...userWithoutStaleHeadshot } = user;
    return {
      ...userWithoutStaleHeadshot,
      reputation: { ...reputation, blockCount },
      ...(publicProfile.headshot ? { headshot: publicProfile.headshot } : {}),
      languages: this.parseJsonArray(publicProfile.languagesJson, user.languages || ['en']),
      profile,
      interests: this.parseJsonArray(publicProfile.interestsJson, user.interests || []),
    };
  }

  async updatePublicProfileFoundation(
    userId: string,
    updates: { headshot?: string; languages?: string[]; profile?: QuestionAnswer[]; interests?: Tag[] },
  ): Promise<void> {
    const fullNode = {
      headshot: updates.headshot || '',
      languagesJson: JSON.stringify(Array.isArray(updates.languages) ? updates.languages : ['en']),
      profileJson: JSON.stringify(Array.isArray(updates.profile) ? updates.profile : []),
      fullProfileJson: JSON.stringify(Array.isArray(updates.profile) ? updates.profile : []),
      interestsJson: JSON.stringify(Array.isArray(updates.interests) ? updates.interests : []),
    };
    const publicProfile = (updates.profile || []).filter((entry) =>
      String((entry as QuestionAnswer & { visibility?: string }).visibility || 'public') === 'public',
    );
    await this.gunService.put(`${PUBLIC_PROFILE_FOUNDATION_KEY}/${userId}`, {
      ...fullNode,
      profileJson: JSON.stringify(publicProfile),
    });
    await this.gunService.put(`${USER_TAGS_KEY}/${userId}`, buildUserTagsEnvelope(updates.interests));
    // The compatibility API still applies viewer-specific filtering from this process-local copy.
    this.recentPublicProfileFoundations.set(userId, fullNode);
  }

  /** True if `ownerId` has saved `candidateId` under knownPeople (public Gun path). */
  async isKnownPerson(ownerId: string, candidateId: string): Promise<boolean> {
    if (!ownerId || !candidateId) return false;
    const recentMutation = this.recentKnownPersonMutations.get(this.knownPersonKey(ownerId, candidateId));
    if (recentMutation !== undefined) return recentMutation;
    const node = await this.gunService.getPath(['users', ownerId, 'knownPeople', candidateId], 300, 500);
    return !!(node && typeof node === 'object' && (node as { userId?: string }).userId);
  }

  async getBlockedUserIds(userId: string): Promise<string[]> {
    // Use chained navigation to match how the browser writes blocks via putNested.
    // gun.get('user-blocks/userId') is a flat soul unrelated to gun.get('user-blocks').get(userId).
    const gun = this.gunService.getGun();
    return new Promise((resolve) => {
      const ids = new Set<string>();
      gun.get(USER_BLOCKS_KEY).get(userId).map().once((data: any, key: string) => {
        if (data != null && key && !key.startsWith('_')) ids.add(key);
      });
      setTimeout(() => {
        for (const [key, blocked] of this.recentBlockMutations.entries()) {
          const [blockerId, targetId] = key.split('\0');
          if (blockerId !== userId || !targetId) continue;
          if (blocked) ids.add(targetId);
          else ids.delete(targetId);
        }
        resolve([...ids]);
      }, 500);
    });
  }

  private blockMutationKey(blockerId: string, targetId: string): string {
    return `${blockerId}\0${targetId}`;
  }

  private knownPersonKey(ownerId: string, candidateId: string): string {
    return `${ownerId}\0${candidateId}`;
  }

  private async readEffectiveBlockState(blockerId: string, targetId: string): Promise<boolean> {
    const key = this.blockMutationKey(blockerId, targetId);
    const recentMutation = this.recentBlockMutations.get(key);
    if (recentMutation !== undefined) return recentMutation;
    return this.isBlocked(blockerId, targetId);
  }

  async isBlocked(blockerId: string, targetId: string): Promise<boolean> {
    if (!blockerId || !targetId) return false;
    const recentMutation = this.recentBlockMutations.get(this.blockMutationKey(blockerId, targetId));
    if (recentMutation !== undefined) return recentMutation;
    const node = await this.gunService.getPath([USER_BLOCKS_KEY, blockerId, targetId], 300, 500);
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
    const alreadyBlocked = await this.readEffectiveBlockState(blockerId, targetId);
    if (alreadyBlocked) {
      return { changed: false, blockedUserIds: await this.getBlockedUserIds(blockerId) };
    }
    const blockedAt = new Date().toISOString();
    await this.gunService.putPath([USER_BLOCKS_KEY, blockerId, targetId], { blockedAt });
    await this.gunService.putPath([USER_BLOCKED_BY_KEY, targetId, blockerId], { blockedAt });
    // Gun propagation can lag the subsequent API request; reflect confirmed writes immediately.
    this.recentBlockMutations.set(this.blockMutationKey(blockerId, targetId), true);
    await this.applyBlockCountDelta(targetId, 1);
    return { changed: true, blockedUserIds: await this.getBlockedUserIds(blockerId) };
  }

  async unblockUser(blockerId: string, targetId: string): Promise<{ changed: boolean; blockedUserIds: string[] }> {
    if (!blockerId || !targetId) {
      throw new Error('blockerId and targetId required');
    }
    const alreadyBlocked = await this.readEffectiveBlockState(blockerId, targetId);
    if (!alreadyBlocked) {
      return { changed: false, blockedUserIds: await this.getBlockedUserIds(blockerId) };
    }
    await this.gunService.putPath([USER_BLOCKS_KEY, blockerId, targetId], null);
    await this.gunService.putPath([USER_BLOCKED_BY_KEY, targetId, blockerId], null);
    this.recentBlockMutations.set(this.blockMutationKey(blockerId, targetId), false);
    await this.applyBlockCountDelta(targetId, -1);
    return { changed: true, blockedUserIds: await this.getBlockedUserIds(blockerId) };
  }

  async getUserTalkFilters(userId: string): Promise<TalkIntakeFilters> {
    const userNode = (await this.gunService.getOptional(`users/${userId}`, 1000)) as Partial<User> | null;
    const filtersNode = (await this.gunService.getOptional(`${PUBLIC_TALK_FILTERS_KEY}/${userId}`, 800)) as
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
    const userNode = (await this.gunService.getOptional(`users/${userId}`, 1200)) as Partial<User> | null;
    const filtersNode = (await this.gunService.getOptional(`${PUBLIC_TALK_FILTERS_KEY}/${userId}`, 800)) as
      | { filtersJson?: string }
      | null;
    const talkFilters = this.parseTalkFilters(filtersNode?.filtersJson, userNode?.languages);
    const interestTokens =
      userNode && Array.isArray(userNode.interests) && userNode.interests.length > 0
        ? userNode.interests
            .map((t) => (typeof t?.name === 'string' ? t.name.trim().toLowerCase() : ''))
            .filter(Boolean)
        : [];
    let location = this.parseStoredLocationForDelivery((userNode as { location?: unknown } | null)?.location as unknown);
    if (!location) {
      const locNode = await this.gunService.getOptional(`users/${userId}/location`, 800);
      location = this.parseStoredLocationForDelivery(locNode);
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
      .getPath([AGE_VERIF_KEY, userId], 300, 500)
      .then((data) => !!(data as { verified?: boolean } | undefined)?.verified)
      .catch(() => false);
  }

  /** Votes live on `user-age-verification`; merge into API reputation for GET /users/:id. */
  private async mergeAgeVerificationIntoReputation(userId: string, reputation: Reputation): Promise<Reputation> {
    const ageVerifNode = (await this.gunService.getPath([AGE_VERIF_KEY, userId], 300, 500).catch(() => null)) as
      | { votes?: number; verified?: boolean }
      | null;
    return {
      ...reputation,
      ageVerified: !!ageVerifNode?.verified,
      ageVerificationVotes: Number(ageVerifNode?.votes ?? reputation.ageVerificationVotes ?? 0),
    };
  }

  async vouchAgeVerified(targetUserId: string): Promise<void> {
    // Read current votes from the server-owned path (browser never writes here).
    const current = await this.gunService.getPath([AGE_VERIF_KEY, targetUserId]).catch(() => null);
    const votes = Number(current?.votes || 0) + 1;
    const verified = votes >= CONFIG.AGE_VERIFICATION_THRESHOLD;
    await this.gunService.putPath([AGE_VERIF_KEY, targetUserId], { votes, verified });
  }
}
