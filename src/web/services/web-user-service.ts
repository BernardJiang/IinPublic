import {
  User,
  GPSCoordinate,
  QuestionAnswer,
  KnownPerson,
  RelationshipLabel,
  TalkIntakeFilters,
  type Reputation,
  type Tag,
} from '../../shared/types';
import { LocationPrivacy } from '../../shared/location';
import { getLocationChatroomPath } from '../../shared/location-to-chatroom';
import { deriveBackendApiBaseFromLocation, WebGunService } from './web-gun-service';
import { v4 as uuidv4 } from 'uuid';
import { generateRandomStageName, normalizeQuestionKey } from '../../shared/user-utils';
import { getSEA } from '../sea-gun';
import type { GunPair } from './gun-bridge';
import { ReputationManager } from '../../shared/reputation';
import {
  assertBlockTargetAllowed,
  assertStageNameAllowed,
  TECHSUPPORT_HEADSHOT,
  TECHSUPPORT_NETWORK_ROLE,
  TECHSUPPORT_ROOT_USER_ID,
  TECHSUPPORT_STAGE_NAME,
} from '../../shared/techsupport';
import {
  buildUserTagsEnvelope,
  buildUserTagWeightMap,
  diffUserTags,
  USER_TAGS_KEY,
  type UserTagsEnvelope,
} from '../../shared/user-tags';

const USER_TAGS_DELTA_KEY = 'user-tags-delta';
const TAG_INDEX_KEY = 'tag-index';

type PrivateUserData = Pick<User, 'profile' | 'languages' | 'interests' | 'knownPeople' | 'blockedUserIds' | 'talkFilters'> & {
  headshot?: string;
};

/**
 * `KnownPerson` used to carry a single `label: RelationshipLabel`; it now carries
 * `labels: RelationshipLabel[]` so a contact can belong to more than one group at once.
 * Private-data JSON is decrypted straight off the wire with no schema-version field, so an
 * already-persisted single-label record still has `label`, not `labels`, until it's rewritten —
 * normalize on every read so old contacts don't silently disappear from their group.
 */
export function normalizeKnownPeople(list: unknown): KnownPerson[] {
  if (!Array.isArray(list)) return [];
  return list.map((raw) => {
    const entry = (raw ?? {}) as Record<string, unknown> & { label?: RelationshipLabel };
    const existingLabels = Array.isArray(entry['labels'])
      ? (entry['labels'] as RelationshipLabel[]).filter((l): l is RelationshipLabel => typeof l === 'string')
      : [];
    const labels = existingLabels.length > 0
      ? existingLabels
      : (typeof entry.label === 'string' ? [entry.label] : []);
    const { label: _legacyLabel, ...rest } = entry;
    return { ...rest, labels } as KnownPerson;
  });
}
type PublicProfileFoundation = {
  headshot?: string | null;
  languagesJson?: string;
  profileJson?: string;
  interestsJson?: string;
};

const PRIVATE_USER_DATA_KEY = 'profile';
const PUBLIC_PROFILE_FOUNDATION_KEY = 'user-public-profile';
const PUBLIC_TALK_FILTERS_KEY = 'user-talk-filters';
const USER_BLOCKS_KEY = 'user-blocks';
const USER_BLOCKED_BY_KEY = 'user-blocked-by';
const TECHSUPPORT_ROOT_META_KEY = 'network-root-techsupport';

export class WebUserService {
  constructor(private gunService: WebGunService) {}

  private static readonly DEFAULT_REPUTATION: Reputation = {
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
  };

  private async readReputationSubNode(userId: string): Promise<Reputation> {
    let repRaw: any = null;
    // Prefer direct Gun sub-node reads when available, but remain compatible with
    // unit-test mocks that only implement get()/put() helpers.
    const gun = typeof (this.gunService as any).getGun === 'function'
      ? (this.gunService as any).getGun()
      : null;
    const canReadSubNode =
      !!gun &&
      typeof gun.get === 'function' &&
      typeof gun.get(`users/${userId}`)?.get === 'function' &&
      typeof gun.get(`users/${userId}`).get('reputation')?.once === 'function';

    if (canReadSubNode) {
      repRaw = await new Promise<any>((resolve) => {
        let settled = false;
        const settle = (v: any) => {
          if (settled) return;
          settled = true;
          resolve(v);
        };
        gun.get(`users/${userId}`).get('reputation').once((data: any) => settle(data));
        setTimeout(() => settle(null), 1000);
      });
    } else {
      try {
        repRaw = await this.gunService.get(`users/${userId}/reputation`);
      } catch {
        repRaw = null;
      }
    }

    if (!repRaw || typeof repRaw !== 'object') return { ...WebUserService.DEFAULT_REPUTATION };
    const { _, ...rest } = repRaw as any;
    // Gun may wrap stored objects under a nested `#` key; unwrap for stable reads.
    const repCandidate = rest && typeof rest === 'object' && (rest['#'] && typeof rest['#'] === 'object')
      ? rest['#']
      : rest;
    const merged = { ...WebUserService.DEFAULT_REPUTATION, ...(repCandidate as any) } as any;
    return {
      questionsAnswered: Number(merged.questionsAnswered ?? 0),
      talksSent: Number(merged.talksSent ?? 0),
      matchesFound: Number(merged.matchesFound ?? 0),
      friendsCount: Number(merged.friendsCount ?? 0),
      mutualFriendsCount: Number(merged.mutualFriendsCount ?? 0),
      likedCount: Number(merged.likedCount ?? 0),
      dislikedCount: Number(merged.dislikedCount ?? 0),
      starRating: Number(merged.starRating ?? WebUserService.DEFAULT_REPUTATION.starRating),
      reviewCount: Number(merged.reviewCount ?? 0),
      ageVerified: !!merged.ageVerified,
      ageVerificationVotes: Number(merged.ageVerificationVotes ?? 0),
      blockCount: Number(merged.blockCount ?? 0),
      isHidden: !!merged.isHidden,
    };
  }

  private getApiBase(): string {
    if (typeof window === 'undefined' || !window.location) return '';
    const { protocol, hostname, port } = window.location;
    if ((protocol !== 'http:' && protocol !== 'https:') || !hostname) return '';
    return deriveBackendApiBaseFromLocation(protocol, hostname, port);
  }

  private async putNested(path: string[], data: any): Promise<void> {
    const gun = this.gunService.getGun();
    await new Promise<void>((resolve, reject) => {
      let ref: any = gun;
      for (const segment of path) {
        ref = ref.get(segment);
      }
      const timeoutId = setTimeout(() => reject(new Error('Nested Gun put timed out')), 5000);
      ref.put(data, (ack: any) => {
        clearTimeout(timeoutId);
        if (ack?.err) reject(new Error(String(ack.err)));
        else resolve();
      });
    });
  }

  private buildPublicUserRecord(user: User): Omit<User, 'headshot'> & { headshot: string } {
    const publicProfile = (user.profile || []).filter((entry) =>
      String((entry as QuestionAnswer & { visibility?: string }).visibility || 'public') === 'public',
    );
    const publicUser: Omit<User, 'headshot'> & { headshot: string } = {
      id: user.id,
      stageName: user.stageName,
      profile: publicProfile,
      reputation: user.reputation,
      location: user.location,
      languages: user.languages || ['en'],
      interests: user.interests || [],
      createdAt: user.createdAt,
      lastActive: user.lastActive,
      knownPeople: [],
      headshot: user.headshot || '',
    };

    if (user.pub) publicUser.pub = user.pub;
    if (user.epub) publicUser.epub = user.epub;
    if (user.networkRole) publicUser.networkRole = user.networkRole;
    if (user.supportMuted) publicUser.supportMuted = user.supportMuted;

    return publicUser;
  }

  private buildPrivateUserData(user: User): PrivateUserData {
    return {
      profile: user.profile || [],
      languages: user.languages || ['en'],
      interests: user.interests || [],
      knownPeople: user.knownPeople ?? [],
      blockedUserIds: user.blockedUserIds ?? [],
      ...(user.talkFilters ? { talkFilters: user.talkFilters } : {}),
      headshot: user.headshot || '',
    };
  }

  private buildPublicProfileFoundation(user: User): {
    headshot: string;
    languagesJson: string;
    profileJson: string;
    interestsJson: string;
  } {
    const publicProfile = (user.profile || []).filter((entry) => {
      const visibility = String((entry as QuestionAnswer & { visibility?: string }).visibility || 'public');
      return visibility === 'public';
    });
    return {
      headshot: user.headshot || '',
      languagesJson: JSON.stringify(user.languages || ['en']),
      profileJson: JSON.stringify(publicProfile),
      interestsJson: JSON.stringify(user.interests || []),
    };
  }

  private async putPublicProfileFoundation(user: User): Promise<void> {
    await this.gunService.put(
      `${PUBLIC_PROFILE_FOUNDATION_KEY}/${user.id}`,
      this.buildPublicProfileFoundation(user),
    );
  }

  private async syncPublicProfileFoundationToApi(user: User): Promise<void> {
    const apiBase = this.getApiBase();
    if (!apiBase) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      await fetch(`${apiBase}/api/users/${encodeURIComponent(user.id)}/public-profile-foundation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          headshot: user.headshot || '',
          languages: user.languages || ['en'],
          profile: user.profile || [],
          interests: user.interests || [],
        }),
        signal: controller.signal,
      });
    } catch {
      // Best-effort sync only; Gun remains source of truth.
    } finally {
      clearTimeout(timeout);
    }
  }

  private syncPublicProfileFoundationToApiBestEffort(user: User): void {
    void this.syncPublicProfileFoundationToApi(user).catch(() => {});
  }

  private async syncPublicUserToApi(user: User): Promise<void> {
    const apiBase = this.getApiBase();
    if (!apiBase) return;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      try {
        const response = await fetch(`${apiBase}/api/users`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.buildPublicUserRecord(user)),
          signal: controller.signal,
        });
        if (response.ok) return;
      } catch {
        // Retry below; local Gun remains source of truth if the API path is unavailable.
      } finally {
        clearTimeout(timeout);
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }

  private syncPublicUserToApiBestEffort(user: User): void {
    void this.syncPublicUserToApi(user).catch(() => {});
  }

  async syncPublicUserForRelay(user: User): Promise<void> {
    await this.syncPublicUserToApi(user);
  }

  private async putPublicTalkFilters(userId: string, talkFilters: TalkIntakeFilters): Promise<void> {
    await this.gunService.put(`${PUBLIC_TALK_FILTERS_KEY}/${userId}`, {
      filtersJson: JSON.stringify(talkFilters),
    });
  }

  /**
   * Last-published tag envelope per user, kept in-memory so an update can publish
   * a minimal delta (REQ-SIM-05) and reconcile only the changed inverted-index
   * entries (spec §22.4.1) without a racy Gun nested-read.
   */
  private readonly lastPublishedTags = new Map<string, UserTagsEnvelope>();

  private async putUserTags(user: User, now: Date = new Date()): Promise<void> {
    const prev = this.lastPublishedTags.get(user.id);
    const nextTags = buildUserTagWeightMap(user.interests);

    if (!prev) {
      const envelope = buildUserTagsEnvelope(user.interests, now);
      await this.gunService.put(`${USER_TAGS_KEY}/${user.id}`, envelope);
      await this.reconcileTagIndex(user.id, {}, envelope.tags);
      this.lastPublishedTags.set(user.id, envelope);
      return;
    }

    // O(1) hash change-detect; skip the publish entirely if nothing changed.
    const { envelope, delta } = diffUserTags(prev, nextTags, now);
    if (!delta) return;

    await this.gunService.put(`${USER_TAGS_KEY}/${user.id}`, envelope);
    await this.gunService.put(`${USER_TAGS_DELTA_KEY}/${user.id}`, delta);
    await this.reconcileTagIndex(user.id, prev.tags, envelope.tags);
    this.lastPublishedTags.set(user.id, envelope);
  }

  /** Maintain the inverted `tag-index/<tag>` index for added/removed tags only. */
  private async reconcileTagIndex(
    userId: string,
    prevTags: Record<string, number>,
    nextTags: Record<string, number>,
  ): Promise<void> {
    const touched = new Map<string, boolean>();
    for (const tag of Object.keys(nextTags)) if (!(tag in prevTags)) touched.set(tag, true);
    for (const tag of Object.keys(prevTags)) if (!(tag in nextTags)) touched.set(tag, false);
    await Promise.all(
      [...touched.entries()].map(([tag, present]) =>
        this.gunService.put(`${TAG_INDEX_KEY}/${tag}`, { [userId]: present }),
      ),
    );
  }

  private putUserTagsBestEffort(user: User, now: Date = new Date()): void {
    void this.putUserTags(user, now).catch((error) => {
      console.warn('user-tags write skipped (best-effort):', error);
    });
  }

  /**
   * Serializes read-modify-write cycles on the private user record. Every mutator
   * reads the whole record (getUser → mergePrivateUserData) and writes the whole
   * record back (putPrivateUserData); without this lock two concurrent mutations
   * (e.g. blockUser racing the boot-time addKnownPerson for TechSupport) silently
   * lose one of the updates.
   */
  private privateDataLock: Promise<unknown> = Promise.resolve();

  private async withPrivateDataLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.privateDataLock.then(fn, fn);
    this.privateDataLock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async putPrivateUserData(user: User): Promise<void> {
    const pair = this.gunService.getStoredPair();
    if (!pair || !user.pub || pair.pub !== user.pub) {
      return;
    }
    await this.gunService.putPrivate(PRIVATE_USER_DATA_KEY, this.buildPrivateUserData(user));
  }

  private async mergePrivateUserData(user: User): Promise<User> {
    const pair = this.gunService.getStoredPair();
    if (!pair || !user.pub || pair.pub !== user.pub) {
      return user;
    }

    try {
      const privateData = (await this.gunService.getPrivate(PRIVATE_USER_DATA_KEY)) as PrivateUserData | null;
      if (!privateData) {
        return user;
      }

      return {
        ...user,
        profile: privateData.profile || user.profile || [],
        languages: privateData.languages || user.languages || ['en'],
        interests: privateData.interests || user.interests || [],
        knownPeople: normalizeKnownPeople(privateData.knownPeople ?? user.knownPeople ?? []),
        blockedUserIds: privateData.blockedUserIds ?? user.blockedUserIds ?? [],
        ...((privateData.talkFilters ?? user.talkFilters)
          ? { talkFilters: privateData.talkFilters ?? user.talkFilters! }
          : {}),
        ...(privateData.headshot ? { headshot: privateData.headshot } : {}),
      };
    } catch {
      return user;
    }
  }

  private parsePublicArray<T>(value: string | undefined, fallback: T[]): T[] {
    if (!value) return fallback;
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed as T[] : fallback;
    } catch {
      return fallback;
    }
  }

  private async readPublicProfileFoundation(user: User): Promise<PublicProfileFoundation | null> {
    const apiBase = this.getApiBase();
    if (apiBase) {
      try {
        const response = await fetch(
          `${apiBase}/api/users/${encodeURIComponent(user.id)}?viewerId=${encodeURIComponent(user.id)}`,
          { cache: 'no-store' },
        );
        if (response.ok) {
          const publicUser = await response.json() as Partial<User>;
          return {
            headshot: publicUser.headshot || '',
            languagesJson: JSON.stringify(publicUser.languages || user.languages || ['en']),
            profileJson: JSON.stringify(publicUser.profile || user.profile || []),
            interestsJson: JSON.stringify(publicUser.interests || user.interests || []),
          };
        }
      } catch {
        // Fall back to Gun below for offline/local-only use.
      }
    }
    try {
      return await this.gunService.get(`${PUBLIC_PROFILE_FOUNDATION_KEY}/${user.id}`) as PublicProfileFoundation | null;
    } catch {
      return null;
    }
  }

  private async mergePublicProfileFoundation(user: User): Promise<{ user: User; foundation: PublicProfileFoundation | null }> {
    const foundation = await this.readPublicProfileFoundation(user);
    if (!foundation) return { user, foundation };
    const { headshot: _staleHeadshot, ...withoutStaleHeadshot } = user;
    return {
      foundation,
      user: {
        ...withoutStaleHeadshot,
        ...(foundation.headshot ? { headshot: foundation.headshot } : {}),
        languages: this.parsePublicArray(foundation.languagesJson, user.languages || ['en']),
        profile: this.parsePublicArray(foundation.profileJson, user.profile || []),
        interests: this.parsePublicArray(foundation.interestsJson, user.interests || []),
      },
    };
  }

  async publishIdentityKeys(userId: string, pair: GunPair): Promise<void> {
    await this.gunService.put(`users/${userId}`, {
      pub: pair.pub,
      epub: pair.epub,
    });
    try {
      const user = await this.getUser(userId);
      this.syncPublicUserToApiBestEffort({ ...user, pub: pair.pub, epub: pair.epub });
    } catch {
      // Identity was already written to local Gun; API sync remains best-effort.
    }
  }

  async hasAnyUser(): Promise<boolean> {
    const apiBase = this.getApiBase();
    if (apiBase) {
      try {
        const root = await fetch(`${apiBase}/api/users/${encodeURIComponent(TECHSUPPORT_ROOT_USER_ID)}`, {
          cache: 'no-store',
        });
        if (root.ok) return true;
      } catch {
        // Fall back to the local Gun graph below when the HTTP API is unavailable.
      }
    }

    const gun = this.gunService.getGun();
    return new Promise<boolean>((resolve) => {
      let found = false;
      const timeoutId = setTimeout(() => resolve(found), 750);
      gun.get('users').map().once((data: any, key: string) => {
        if (found) return;
        if (!key || key.startsWith('_') || !data || typeof data !== 'object') return;
        found = true;
        clearTimeout(timeoutId);
        resolve(true);
      });
    });
  }

  async createTechSupportRoot(userData: Partial<User> = {}): Promise<User> {
    return this.createUser({
      ...userData,
      id: TECHSUPPORT_ROOT_USER_ID,
      stageName: TECHSUPPORT_STAGE_NAME,
      headshot: userData.headshot || TECHSUPPORT_HEADSHOT,
      languages: userData.languages || ['en'],
      profile: Array.isArray(userData.profile) && userData.profile.length > 0 ? userData.profile : [
        {
          id: 'techsupport_profile_role',
          question: 'Role',
          answer: 'IinPublic network support',
          isAuto: false,
          answeredAt: new Date(),
        },
      ],
      interests: userData.interests || [],
      networkRole: TECHSUPPORT_NETWORK_ROLE,
    });
  }

  async createUser(userData: Partial<User>): Promise<User> {
    const userId = userData.id || uuidv4();
    const now = new Date();
    const stageName = userData.stageName || generateRandomStageName();
    assertStageNameAllowed(stageName, {
      allowTechSupportRoot: userId === TECHSUPPORT_ROOT_USER_ID,
    });

    const userBase = {
      id: userId,
      stageName,
      profile: userData.profile || [],
      reputation: {
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
      talkFilters: userData.talkFilters || {
        allowedLanguages: userData.languages || ['en'],
        minDistanceMiles: 0,
        maxDistanceMiles: 50,
        requireGoodGrammar: true,
        blockDirtyWords: true,
        allowedTalkTypes: ['flow', 'survey', 'tag', 'route'],
      },
      createdAt: now,
      lastActive: now,
      knownPeople: userData.knownPeople ?? [],
      ...(userData.networkRole ? { networkRole: userData.networkRole } : {}),
      ...(userData.supportMuted ? { supportMuted: userData.supportMuted } : {}),
    };

    const user: User = userData.headshot ? { ...userBase, headshot: userData.headshot } : userBase;
    if (userData.pub) user.pub = userData.pub;
    if (userData.epub) user.epub = userData.epub;

    // These writes land on independent Gun keys with no cross-reads between them — run them
    // concurrently rather than sequentially. Each await already carries its own bounded,
    // optimistic-continue ack timeout (see WebGunService.put/putPrivate), so awaiting them one
    // at a time was stacking that timeout budget on every fresh boot (worst case 4x) whenever
    // the relay's ack was slow or absent.
    await Promise.all([
      this.gunService.put(`users/${userId}`, this.buildPublicUserRecord(user)),
      this.putPublicProfileFoundation(user),
      this.putPublicTalkFilters(userId, user.talkFilters || {
        allowedLanguages: user.languages || ['en'],
        minDistanceMiles: 0,
        maxDistanceMiles: 50,
        requireGoodGrammar: true,
        blockDirtyWords: true,
        allowedTalkTypes: ['flow', 'survey', 'tag', 'route'],
      }),
      this.putPrivateUserData(user),
    ]);
    this.syncPublicUserToApiBestEffort(user);
    this.putUserTagsBestEffort(user, now);
    if (user.id === TECHSUPPORT_ROOT_USER_ID) {
      await this.gunService.put(TECHSUPPORT_ROOT_META_KEY, {
        userId: user.id,
        stageName: user.stageName,
        networkRole: TECHSUPPORT_NETWORK_ROLE,
        createdAt: now.toISOString(),
      });
    }
    return user;
  }

  async getUser(userId: string): Promise<User> {
    const user = (await this.gunService.get(`users/${userId}`)) as User;
    const reputation = await this.readReputationSubNode(userId);
    const publicProfile = await this.mergePublicProfileFoundation({ ...user, reputation });
    const merged = await this.mergePrivateUserData(publicProfile.user);
    if (!publicProfile.foundation) return merged;
    const { headshot: _privateHeadshot, ...withoutPrivateHeadshot } = merged;
    return {
      ...withoutPrivateHeadshot,
      ...(publicProfile.foundation.headshot ? { headshot: publicProfile.foundation.headshot } : {}),
    };
  }

  async updateUserLocation(userId: string, location: GPSCoordinate): Promise<void> {
    const blurredLocation = LocationPrivacy.blurLocation(location);
    await this.gunService.put(`users/${userId}/location`, blurredLocation);
    const chatroomPath = getLocationChatroomPath(location);
    const chatroomId = chatroomPath[chatroomPath.length - 1] || 'global';
    // Public affinity is a room identifier/path only — never publish raw GPS.
    await this.gunService.put(`user-public-profile/${userId}/chatroomAffinity`, {
      chatroomId,
      chatroomPath,
      updatedAt: new Date().toISOString(),
    });
  }

  async setUserStatus(userId: string, status: 'online' | 'away' | 'offline'): Promise<void> {
    await this.gunService.put(`users/${userId}/status`, {
      status,
      timestamp: new Date(),
    });
  }

  async updateStageName(userId: string, newStageName: string): Promise<void> {
    assertStageNameAllowed(newStageName, {
      allowTechSupportRoot: userId === TECHSUPPORT_ROOT_USER_ID,
    });
    await this.gunService.put(`users/${userId}`, { stageName: newStageName });
  }

  async updateProfileFoundation(
    userId: string,
    updates: {
      headshot?: string;
      languages: string[];
      profile: QuestionAnswer[];
      interests?: Tag[];
    },
  ): Promise<User> {
    const user = await this.getUser(userId);
    const nextUser: User = {
      ...user,
      languages: updates.languages,
      profile: updates.profile,
      ...(updates.interests !== undefined ? { interests: updates.interests } : {}),
      ...(updates.headshot ? { headshot: updates.headshot } : {}),
    };
    if (!updates.headshot && nextUser.headshot) {
      delete (nextUser as Partial<User>).headshot;
    }
    await this.gunService.put(`users/${userId}`, this.buildPublicUserRecord(nextUser));
    await this.putPublicProfileFoundation(nextUser);
    this.putUserTagsBestEffort(nextUser);
    this.syncPublicProfileFoundationToApiBestEffort(nextUser);
    await this.putPrivateUserData(nextUser);
    return nextUser;
  }

  /**
   * Persist a single profile answer: auto → user graph `answers/auto`, manual → encrypted `answers/private`.
   */
  async persistQuestionAnswer(_userId: string, qa: QuestionAnswer, pair: GunPair): Promise<void> {
    const SEA = getSEA();
    const gun = this.gunService.getGun();
    if (qa.isAuto) {
      await new Promise<void>((resolve, reject) => {
        gun
          .user()
          .get('answers')
          .get('auto')
          .get(qa.id)
          .put(JSON.stringify(qa), (ack: any) => (ack?.err ? reject(new Error(String(ack.err))) : resolve()));
      });
    } else {
      const encrypted = await SEA.encrypt(JSON.stringify(qa), pair);
      await new Promise<void>((resolve, reject) => {
        gun
          .user()
          .get('answers')
          .get('private')
          .get(qa.id)
          .put(encrypted, (ack: any) => (ack?.err ? reject(new Error(String(ack.err))) : resolve()));
      });
    }
  }

  /**
   * After a talk completes, mirror answers into Gun `answers/auto` vs encrypted `answers/private` from preference modes.
   */
  async syncQuestionAnswersFromTalkCompletion(
    talkData: { questions?: Array<{ id: string; text?: string }> },
    answers: Array<{ questionId: string; answerId: string; answerText?: string }>,
    preferenceMap: Record<string, { mode?: string }>,
    pair: GunPair,
  ): Promise<void> {
    const questions = talkData.questions || [];
    for (const a of answers) {
      const q = questions.find((qu) => qu.id === a.questionId);
      const qText = (q?.text || '').trim();
      if (!qText) continue;
      const key = normalizeQuestionKey(qText);
      const mode = preferenceMap[key]?.mode;
      const isAuto = mode !== 'manual';
      const qa: QuestionAnswer = {
        id: `qa_${a.questionId}_${a.answerId}`,
        question: qText,
        answer: a.answerText || '',
        isAuto,
        answeredAt: new Date(),
      };
      await this.persistQuestionAnswer('', qa, pair);
    }
  }

  /** Decrypt everything under `answers/private` for the logged-in user graph. */
  async getPrivateAnswers(pair: GunPair): Promise<QuestionAnswer[]> {
    const SEA = getSEA();
    const gun = this.gunService.getGun();
    const collected: QuestionAnswer[] = [];
    return new Promise((resolve) => {
      const done = (): void => {
        resolve(collected);
      };
      const t = setTimeout(done, 1200);
      gun
        .user()
        .get('answers')
        .get('private')
        .map()
        .once((data: unknown, key: string) => {
          if (!key || key.startsWith('_') || data == null) return;
          void (async () => {
            try {
              const dec = await SEA.decrypt(data as string, pair);
              if (!dec) return;
              const parsed = typeof dec === 'string' ? JSON.parse(dec) : dec;
              collected.push(parsed as QuestionAnswer);
            } catch {
              /* skip */
            }
          })();
        });
      setTimeout(() => {
        clearTimeout(t);
        done();
      }, 1100);
    });
  }

  async addKnownPerson(
    userId: string,
    targetId: string,
    labels: RelationshipLabel[],
    nickname?: string,
    extras?: { customLabel?: string; rating?: number; notes?: string },
  ): Promise<void> {
    const entry: KnownPerson = {
      userId: targetId,
      labels: labels.length > 0 ? labels : ['acquaintance'],
      ...(nickname ? { nickname } : {}),
      ...(extras?.customLabel ? { customLabel: extras.customLabel } : {}),
      ...(typeof extras?.rating === 'number' ? { rating: extras.rating } : {}),
      ...(extras?.notes ? { notes: extras.notes } : {}),
      addedAt: new Date(),
    };
    try {
      await this.withPrivateDataLock(async () => {
        const u = await this.getUser(userId);
        const list = [...(u.knownPeople || []).filter((k) => k.userId !== targetId), entry];
        await this.putPrivateUserData({ ...u, knownPeople: list });
      });
    } catch {
      /* graph may lag */
    }
  }

  async removeKnownPerson(userId: string, targetId: string): Promise<void> {
    try {
      await this.withPrivateDataLock(async () => {
        const u = await this.getUser(userId);
        const list = (u.knownPeople || []).filter((k) => k.userId !== targetId);
        await this.putPrivateUserData({ ...u, knownPeople: list });
      });
    } catch {
      /* ignore */
    }
  }

  private async updateBlockAtApi(userId: string, targetId: string, blocked: boolean): Promise<string[] | null> {
    const apiBase = this.getApiBase();
    if (!apiBase) return null;
    const url = blocked
      ? `${apiBase}/api/users/${encodeURIComponent(userId)}/blocks`
      : `${apiBase}/api/users/${encodeURIComponent(userId)}/blocks/${encodeURIComponent(targetId)}`;
    const response = await fetch(url, blocked
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetId }),
        }
      : { method: 'DELETE' });
    if (!response.ok) throw new Error(`Failed to ${blocked ? 'block' : 'unblock'} user: HTTP ${response.status}`);
    const result = await response.json() as { blockedUserIds?: unknown };
    const returnedIds = Array.isArray(result.blockedUserIds)
      ? result.blockedUserIds.map((candidate) => String(candidate)).filter(Boolean)
      : [];
    return blocked
      ? Array.from(new Set([...returnedIds, targetId]))
      : returnedIds.filter((candidate) => candidate !== targetId);
  }

  async blockUser(userId: string, targetId: string): Promise<string[]> {
    if (!userId || !targetId) throw new Error('userId and targetId required');
    if (userId === targetId) throw new Error('Cannot block yourself');
    // TechSupport is unblockable (docs/TODO.md K6). Refuse before touching the API or
    // the SEA-private block list, so no half-written block edge can survive locally.
    assertBlockTargetAllowed(targetId);
    const apiBlockedUserIds = await this.updateBlockAtApi(userId, targetId, true);
    if (apiBlockedUserIds) {
      // The server block graph is updated, but the client's SEA-encrypted private
      // blockedUserIds is the on-device source of truth (the server cannot read it).
      // Without this write the block list is lost on browser restart.
      return await this.withPrivateDataLock(async () => {
        try {
          const user = await this.getUser(userId);
          const merged = Array.from(new Set([...(user.blockedUserIds || []), ...apiBlockedUserIds]));
          await this.putPrivateUserData({ ...user, blockedUserIds: merged });
          return merged;
        } catch {
          return apiBlockedUserIds;
        }
      });
    }
    return await this.withPrivateDataLock(async () => {
      const user = await this.getUser(userId);
      const blockedUserIds = Array.from(new Set([...(user.blockedUserIds || []), targetId]));
      if (!user.blockedUserIds?.includes(targetId)) {
        const targetUser = await this.getUser(targetId);
        await this.gunService.put(`users/${targetId}/reputation`, {
          ...targetUser.reputation,
          blockCount: Math.max(0, Number(targetUser.reputation?.blockCount || 0) + 1),
        });
      }
      await this.putNested([USER_BLOCKS_KEY, userId, targetId], {
        blockedAt: new Date().toISOString(),
      });
      await this.putNested([USER_BLOCKED_BY_KEY, targetId, userId], {
        blockedAt: new Date().toISOString(),
      });
      await this.putPrivateUserData({ ...user, blockedUserIds });
      return blockedUserIds;
    });
  }

  async unblockUser(userId: string, targetId: string): Promise<string[]> {
    if (!userId || !targetId) throw new Error('userId and targetId required');
    const apiBlockedUserIds = await this.updateBlockAtApi(userId, targetId, false);
    if (apiBlockedUserIds) {
      // Mirror the unblock into private data too (see blockUser).
      return await this.withPrivateDataLock(async () => {
        try {
          const user = await this.getUser(userId);
          const merged = Array.from(
            new Set([...(user.blockedUserIds || []), ...apiBlockedUserIds]),
          ).filter((candidate) => candidate !== targetId);
          await this.putPrivateUserData({ ...user, blockedUserIds: merged });
          return merged;
        } catch {
          return apiBlockedUserIds;
        }
      });
    }
    return await this.withPrivateDataLock(async () => {
      const user = await this.getUser(userId);
      const blockedUserIds = (user.blockedUserIds || []).filter((candidate) => candidate !== targetId);
      if (user.blockedUserIds?.includes(targetId)) {
        const targetUser = await this.getUser(targetId);
        await this.gunService.put(`users/${targetId}/reputation`, {
          ...targetUser.reputation,
          blockCount: Math.max(0, Number(targetUser.reputation?.blockCount || 0) - 1),
        });
      }
      await this.putNested([USER_BLOCKS_KEY, userId, targetId], null);
      await this.putNested([USER_BLOCKED_BY_KEY, targetId, userId], null);
      await this.putPrivateUserData({ ...user, blockedUserIds });
      return blockedUserIds;
    });
  }

  async updateTalkFilters(userId: string, talkFilters: TalkIntakeFilters): Promise<void> {
    await this.withPrivateDataLock(async () => {
      const user = await this.getUser(userId);
      await this.putPublicTalkFilters(userId, talkFilters);
      await this.putPrivateUserData({ ...user, talkFilters });
    });
  }

  /**
   * TODO §J — apply an imported device-handoff archive's already-merged contacts/talk
   * filters (`mergeHandoffArchive`, shared/device-handoff.ts) in one locked write. The
   * caller has already resolved conflicts (local wins); this just persists the result —
   * mirrors updateTalkFilters's own public-path write since talk filters must stay
   * visible for delivery-time filtering.
   */
  async importHandoffData(
    userId: string,
    merge: { knownPeople?: KnownPerson[]; talkFilters?: TalkIntakeFilters },
  ): Promise<void> {
    await this.withPrivateDataLock(async () => {
      const user = await this.getUser(userId);
      if (merge.talkFilters) await this.putPublicTalkFilters(userId, merge.talkFilters);
      await this.putPrivateUserData({
        ...user,
        ...(merge.knownPeople ? { knownPeople: merge.knownPeople } : {}),
        ...(merge.talkFilters ? { talkFilters: merge.talkFilters } : {}),
      });
    });
  }

  async updateReputationVisibility(userId: string, isHidden: boolean): Promise<void> {
    const user = await this.getUser(userId);
    await this.gunService.put(`users/${userId}/reputation`, {
      ...user.reputation,
      isHidden,
    });
  }

  async submitPeerReview(targetUserId: string, rating: number): Promise<void> {
    const targetUser = await this.getUser(targetUserId);
    let updated = ReputationManager.updateReputation(targetUser.reputation, 'star_rating', rating);
    if (rating >= 4) {
      updated = ReputationManager.updateReputation(updated, 'liked');
    } else if (rating <= 2) {
      updated = ReputationManager.updateReputation(updated, 'disliked');
    }
    await this.gunService.put(`users/${targetUserId}/reputation`, updated);
  }

  async vouchAgeVerified(targetUserId: string): Promise<void> {
    const targetUser = await this.getUser(targetUserId);
    const updated = ReputationManager.updateReputation(targetUser.reputation, 'age_verified', 1);
    await this.gunService.put(`users/${targetUserId}/reputation`, updated);
  }

  // ---------------------------------------------------------------------------
  // P2P-W: Peer trust store — SEA-encrypted under the user's private Gun path
  // ---------------------------------------------------------------------------

  /**
   * Read the local peer trust store.  Returns an empty map when no data is
   * stored yet or when the user is not authenticated.
   */
  async getPeerTrustStore(): Promise<Map<string, import('../../shared/p2p-trust').PeerTrustRecord>> {
    const { importTrustStore } = await import('../../shared/p2p-trust');
    try {
      const raw = await this.gunService.getPrivate('peerTrustStore');
      if (!raw || !Array.isArray(raw)) return new Map();
      return importTrustStore(raw as import('../../shared/p2p-trust').PeerTrustRecord[]);
    } catch {
      return new Map();
    }
  }

  /**
   * Persist the peer trust store under the user's SEA-encrypted private path.
   */
  async putPeerTrustStore(
    store: Map<string, import('../../shared/p2p-trust').PeerTrustRecord>,
  ): Promise<void> {
    const { exportTrustStore } = await import('../../shared/p2p-trust');
    const records = exportTrustStore(store);
    await this.gunService.putPrivate('peerTrustStore', records);
  }
}
