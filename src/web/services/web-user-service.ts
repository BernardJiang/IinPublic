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
import { WebGunService } from './web-gun-service';
import { v4 as uuidv4 } from 'uuid';
import { generateRandomStageName, normalizeQuestionKey } from '../../shared/user-utils';
import { getSEA } from '../sea-gun';
import type { GunPair } from './gun-bridge';
import { ReputationManager } from '../../shared/reputation';
import {
  assertStageNameAllowed,
  TECHSUPPORT_HEADSHOT,
  TECHSUPPORT_NETWORK_ROLE,
  TECHSUPPORT_ROOT_USER_ID,
  TECHSUPPORT_STAGE_NAME,
} from '../../shared/techsupport';

type PrivateUserData = Pick<User, 'profile' | 'languages' | 'interests' | 'knownPeople' | 'blockedUserIds' | 'talkFilters'> & {
  headshot?: string;
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
    const webPort = Number(port);
    if ((hostname === 'localhost' || hostname === '127.0.0.1') && Number.isFinite(webPort) && webPort >= 3001) {
      return `${protocol}//${hostname}:${webPort - 3001 + 8080}`;
    }
    return `${protocol}//${hostname}${port ? `:${port}` : ''}`;
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
    const publicUser: Omit<User, 'headshot'> & { headshot: string } = {
      id: user.id,
      stageName: user.stageName,
      profile: user.profile || [],
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
    return {
      headshot: user.headshot || '',
      languagesJson: JSON.stringify(user.languages || ['en']),
      profileJson: JSON.stringify(user.profile || []),
      interestsJson: JSON.stringify(user.interests || []),
    };
  }

  private async putPublicProfileFoundation(user: User): Promise<void> {
    await this.gunService.put(
      `${PUBLIC_PROFILE_FOUNDATION_KEY}/${user.id}`,
      this.buildPublicProfileFoundation(user),
    );
  }

  private async putPublicTalkFilters(userId: string, talkFilters: TalkIntakeFilters): Promise<void> {
    await this.gunService.put(`${PUBLIC_TALK_FILTERS_KEY}/${userId}`, {
      filtersJson: JSON.stringify(talkFilters),
    });
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
        knownPeople: privateData.knownPeople ?? user.knownPeople ?? [],
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

  async publishIdentityKeys(userId: string, pair: GunPair): Promise<void> {
    await this.gunService.put(`users/${userId}`, {
      pub: pair.pub,
      epub: pair.epub,
    });
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

    await this.gunService.put(`users/${userId}`, this.buildPublicUserRecord(user));
    await this.putPublicProfileFoundation(user);
    await this.putPublicTalkFilters(userId, user.talkFilters || {
      allowedLanguages: user.languages || ['en'],
      minDistanceMiles: 0,
      maxDistanceMiles: 50,
      requireGoodGrammar: true,
      blockDirtyWords: true,
      allowedTalkTypes: ['flow', 'survey', 'tag', 'route'],
    });
    await this.putPrivateUserData(user);
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
    return this.mergePrivateUserData({ ...user, reputation });
  }

  async updateUserLocation(userId: string, location: GPSCoordinate): Promise<void> {
    const blurredLocation = LocationPrivacy.blurLocation(location);
    await this.gunService.put(`users/${userId}/location`, blurredLocation);
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
    label: RelationshipLabel,
    nickname?: string,
    extras?: { customLabel?: string; rating?: number; notes?: string },
  ): Promise<void> {
    const entry: KnownPerson = {
      userId: targetId,
      label,
      ...(nickname ? { nickname } : {}),
      ...(extras?.customLabel ? { customLabel: extras.customLabel } : {}),
      ...(typeof extras?.rating === 'number' ? { rating: extras.rating } : {}),
      ...(extras?.notes ? { notes: extras.notes } : {}),
      addedAt: new Date(),
    };
    try {
      const u = await this.getUser(userId);
      const list = [...(u.knownPeople || []).filter((k) => k.userId !== targetId), entry];
      await this.putPrivateUserData({ ...u, knownPeople: list });
    } catch {
      /* graph may lag */
    }
  }

  async removeKnownPerson(userId: string, targetId: string): Promise<void> {
    try {
      const u = await this.getUser(userId);
      const list = (u.knownPeople || []).filter((k) => k.userId !== targetId);
      await this.putPrivateUserData({ ...u, knownPeople: list });
    } catch {
      /* ignore */
    }
  }

  async blockUser(userId: string, targetId: string): Promise<string[]> {
    if (!userId || !targetId) throw new Error('userId and targetId required');
    if (userId === targetId) throw new Error('Cannot block yourself');
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
  }

  async unblockUser(userId: string, targetId: string): Promise<string[]> {
    if (!userId || !targetId) throw new Error('userId and targetId required');
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
  }

  async updateTalkFilters(userId: string, talkFilters: TalkIntakeFilters): Promise<void> {
    const user = await this.getUser(userId);
    await this.putPublicTalkFilters(userId, talkFilters);
    await this.putPrivateUserData({ ...user, talkFilters });
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
}
