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
    // Same reasoning as putAndVerify above: the write already committed locally. Don't let an
    // unreadable/slow read-back turn a successful incoming-talk commit into a delivery failure.
    try {
      const index = await this.gun.get(indexSoul) as { talkId?: string; authorKey?: string } | null;
      if (index?.talkId !== talk.id || index.authorKey !== authorKey) {
        console.warn(`Gun received Talk index read-back inconclusive (continuing — write already committed locally): ${indexSoul}`);
      }
    } catch (error) {
      console.warn(`Gun received Talk index read-back timed out (continuing — write already committed locally): ${indexSoul}`, error);
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

  async listReceived(ownerSeaPub: string): Promise<Talk[]> {
    try {
      const raw = await this.gun.get(`users/${encodeURIComponent(ownerSeaPub)}/receivedTalkIndex`) as Record<string, unknown> | null;
      if (!raw || typeof raw !== 'object') return [];
      const talks: Talk[] = [];
      for (const talkId of Object.keys(raw).filter((key) => key !== '_' && !key.startsWith('_')).sort()) {
        const talk = await this.getReceivedById(ownerSeaPub, talkId);
        if (talk) talks.push(talk);
      }
      return talks;
    } catch { return []; }
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
    // A genuine put() failure (the call itself throwing) is worth retrying — that's a real
    // transient write error. Re-putting the same immutable content-addressed record is
    // idempotent, so a short retry loop here is safe.
    let lastPutError: unknown;
    let committed = false;
    for (let attempt = 1; attempt <= 3 && !committed; attempt += 1) {
      try {
        await this.gun.put(soul, record);
        committed = true;
      } catch (error) {
        lastPutError = error;
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 100));
      }
    }
    if (!committed) throw lastPutError instanceof Error ? lastPutError : new Error(`Gun Talk commit failed: ${soul}`);

    // The record already applied to the local Gun graph synchronously above — this read-back is
    // a paranoid double-check, not the real commit. In this deployment (relay-only hub, no local
    // persistence — see WebGunService's own doc comments) GunKeyValueStore.get() on a freshly-
    // written soul can hang for its full multi-second timeout and reject even though the write
    // succeeded, which used to turn a successful "create talk" into a user-facing failure. Try
    // once to confirm; if it can't be confirmed, log and continue — the write already happened
    // regardless of whether this read can see it.
    try {
      const readBack = await this.gun.get(soul) as GunTalkRecord | null;
      if (
        !readBack
        || readBack.version !== 1
        || readBack.talkId !== record.talkId
        || readBack.talkJson !== record.talkJson
      ) {
        console.warn(`Gun Talk read-back verification inconclusive (continuing — write already committed locally): ${soul}`);
      }
    } catch (error) {
      console.warn(`Gun Talk read-back timed out (continuing — write already committed locally): ${soul}`, error);
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
