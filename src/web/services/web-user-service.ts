import {
  User,
  GPSCoordinate,
  QuestionAnswer,
  KnownPerson,
  RelationshipLabel,
} from '../../shared/types';
import { LocationPrivacy } from '../../shared/location';
import { WebGunService } from './web-gun-service';
import { v4 as uuidv4 } from 'uuid';
import { generateRandomStageName, normalizeQuestionKey } from '../../shared/user-utils';
import { getSEA } from '../sea-gun';
import type { GunPair } from './gun-bridge';

type PrivateUserData = Pick<User, 'profile' | 'languages' | 'interests' | 'knownPeople'> & {
  headshot?: string;
};

const PRIVATE_USER_DATA_KEY = 'profile';

export class WebUserService {
  constructor(private gunService: WebGunService) {}

  private buildPublicUserRecord(user: User): User {
    const publicUser: User = {
      id: user.id,
      stageName: user.stageName,
      profile: [],
      reputation: user.reputation,
      location: user.location,
      languages: [],
      interests: [],
      createdAt: user.createdAt,
      lastActive: user.lastActive,
      knownPeople: [],
    };

    if (user.pub) publicUser.pub = user.pub;
    if (user.epub) publicUser.epub = user.epub;

    return publicUser;
  }

  private buildPrivateUserData(user: User): PrivateUserData {
    return {
      profile: user.profile || [],
      languages: user.languages || ['en'],
      interests: user.interests || [],
      knownPeople: user.knownPeople ?? [],
      ...(user.headshot ? { headshot: user.headshot } : {}),
    };
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

  async createUser(userData: Partial<User>): Promise<User> {
    const userId = uuidv4();
    const now = new Date();

    const userBase = {
      id: userId,
      stageName: userData.stageName || generateRandomStageName(),
      profile: userData.profile || [],
      reputation: {
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
      createdAt: now,
      lastActive: now,
      knownPeople: userData.knownPeople ?? [],
    };

    const user: User = userData.headshot ? { ...userBase, headshot: userData.headshot } : userBase;
    if (userData.pub) user.pub = userData.pub;
    if (userData.epub) user.epub = userData.epub;

    await this.gunService.put(`users/${userId}`, this.buildPublicUserRecord(user));
    await this.putPrivateUserData(user);
    return user;
  }

  async getUser(userId: string): Promise<User> {
    const user = (await this.gunService.get(`users/${userId}`)) as User;
    return this.mergePrivateUserData(user);
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
    await this.gunService.put(`users/${userId}`, { stageName: newStageName });
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
  ): Promise<void> {
    const entry: KnownPerson = {
      userId: targetId,
      label,
      ...(nickname ? { nickname } : {}),
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
}
