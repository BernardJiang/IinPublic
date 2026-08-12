import type { Talk } from '../../shared/types';

export type GunKeyValueStore = {
  put: (key: string, value: unknown) => Promise<void>;
  get: (key: string) => Promise<unknown>;
};

export type GunTalkRecord = {
  version: 1;
  role: 'authored' | 'received';
  ownerSeaPub: string;
  authorKey: string;
  talkId: string;
  talkJson: string;
  committedAt: string;
};

export class GunTalkRepository {
  constructor(private readonly gun: GunKeyValueStore) {}

  async putAuthored(ownerSeaPub: string, talk: Talk): Promise<void> {
    await this.putAndVerify(this.authoredSoul(ownerSeaPub, talk.id), {
      version: 1, role: 'authored', ownerSeaPub, authorKey: ownerSeaPub,
      talkId: talk.id, talkJson: JSON.stringify(talk), committedAt: new Date().toISOString(),
    });
  }

  async putReceived(ownerSeaPub: string, authorKey: string, talk: Talk): Promise<void> {
    const soul = this.receivedSoul(ownerSeaPub, authorKey, talk.id);
    await this.putAndVerify(soul, {
      version: 1, role: 'received', ownerSeaPub, authorKey,
      talkId: talk.id, talkJson: JSON.stringify(talk), committedAt: new Date().toISOString(),
    });
    const indexSoul = this.receivedIndexSoul(ownerSeaPub, talk.id);
    await this.gun.put(indexSoul, { version: 1, talkId: talk.id, authorKey, soul });
    const index = await this.gun.get(indexSoul) as { talkId?: string; authorKey?: string } | null;
    if (index?.talkId !== talk.id || index.authorKey !== authorKey) {
      throw new Error(`Gun received Talk index read-back verification failed: ${indexSoul}`);
    }
  }

  async getAuthored(ownerSeaPub: string, talkId: string): Promise<Talk | null> {
    return this.readTalk(this.authoredSoul(ownerSeaPub, talkId), talkId);
  }

  async getReceived(ownerSeaPub: string, authorKey: string, talkId: string): Promise<Talk | null> {
    return this.readTalk(this.receivedSoul(ownerSeaPub, authorKey, talkId), talkId);
  }

  async getReceivedById(ownerSeaPub: string, talkId: string): Promise<Talk | null> {
    try {
      const index = await this.gun.get(this.receivedIndexSoul(ownerSeaPub, talkId)) as { version?: number; authorKey?: string } | null;
      if (index?.version !== 1 || !index.authorKey) return null;
      return this.getReceived(ownerSeaPub, index.authorKey, talkId);
    } catch {
      return null;
    }
  }

  authoredSoul(ownerSeaPub: string, talkId: string): string {
    return `users/${encodeURIComponent(ownerSeaPub)}/talks/${encodeURIComponent(talkId)}`;
  }

  receivedSoul(ownerSeaPub: string, authorKey: string, talkId: string): string {
    return `users/${encodeURIComponent(ownerSeaPub)}/receivedTalks/${encodeURIComponent(authorKey)}/${encodeURIComponent(talkId)}`;
  }

  receivedIndexSoul(ownerSeaPub: string, talkId: string): string {
    return `users/${encodeURIComponent(ownerSeaPub)}/receivedTalkIndex/${encodeURIComponent(talkId)}`;
  }

  private async putAndVerify(soul: string, record: GunTalkRecord): Promise<void> {
    await this.gun.put(soul, record);
    const readBack = await this.gun.get(soul) as GunTalkRecord | null;
    if (!readBack || readBack.version !== 1 || readBack.talkId !== record.talkId || readBack.talkJson !== record.talkJson) {
      throw new Error(`Gun Talk read-back verification failed: ${soul}`);
    }
  }

  private async readTalk(soul: string, expectedTalkId: string): Promise<Talk | null> {
    try {
      const record = await this.gun.get(soul) as GunTalkRecord | null;
      if (!record || record.version !== 1 || record.talkId !== expectedTalkId || !record.talkJson) return null;
      const talk = JSON.parse(record.talkJson) as Talk;
      return talk?.id === expectedTalkId ? talk : null;
    } catch {
      return null;
    }
  }
}
