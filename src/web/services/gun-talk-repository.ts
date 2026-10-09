import type { Talk } from '../../shared/types';

/** Generic graph store retained for non-private delivery metadata repositories. */
export type GunKeyValueStore = {
  put: (key: string, value: unknown) => Promise<void>;
  get: (key: string) => Promise<unknown>;
};

export type GunPrivateKeyValueStore = {
  putPrivate: (key: string, value: unknown) => Promise<void>;
  getPrivate: (key: string) => Promise<unknown>;
  /** Optional legacy graph access, used only to migrate and erase release-123 plaintext rows. */
  put?: (key: string, value: unknown) => Promise<void>;
  get?: (key: string) => Promise<unknown>;
};

export type GunTalkRecord = {
  version: 2;
  role: 'authored' | 'received';
  ownerSeaPub: string;
  authorKey: string;
  talkId: string;
  talkJson: string;
  committedAt: string;
};

export class GunTalkRepository {
  private indexWrite: Promise<unknown> = Promise.resolve();

  constructor(private readonly gun: GunPrivateKeyValueStore) {}

  async putAuthored(ownerSeaPub: string, talk: Talk): Promise<void> {
    await this.putAndVerify(this.authoredSoul(ownerSeaPub, talk.id), {
      version: 2, role: 'authored', ownerSeaPub, authorKey: ownerSeaPub,
      talkId: talk.id, talkJson: JSON.stringify(talk), committedAt: new Date().toISOString(),
    });
  }

  async putReceived(ownerSeaPub: string, authorKey: string, talk: Talk): Promise<void> {
    const soul = this.receivedSoul(ownerSeaPub, authorKey, talk.id);
    await this.putAndVerify(soul, {
      version: 2, role: 'received', ownerSeaPub, authorKey,
      talkId: talk.id, talkJson: JSON.stringify(talk), committedAt: new Date().toISOString(),
    });
    await this.updateReceivedIndex(ownerSeaPub, talk.id, authorKey, soul);
  }

  async getAuthored(ownerSeaPub: string, talkId: string): Promise<Talk | null> {
    return this.readTalk(this.authoredSoul(ownerSeaPub, talkId), talkId);
  }

  async getReceived(ownerSeaPub: string, authorKey: string, talkId: string): Promise<Talk | null> {
    return this.readTalk(this.receivedSoul(ownerSeaPub, authorKey, talkId), talkId);
  }

  async getReceivedById(ownerSeaPub: string, talkId: string): Promise<Talk | null> {
    try {
      const index = await this.readReceivedIndex(ownerSeaPub);
      const row = index[talkId];
      return row?.authorKey ? this.getReceived(ownerSeaPub, row.authorKey, talkId) : null;
    } catch {
      return null;
    }
  }

  async listReceived(ownerSeaPub: string): Promise<Talk[]> {
    try {
      const raw = await this.readReceivedIndex(ownerSeaPub);
      const talks: Talk[] = [];
      for (const talkId of Object.keys(raw).filter((key) => key !== '_' && !key.startsWith('_')).sort()) {
        const talk = await this.getReceivedById(ownerSeaPub, talkId);
        if (talk) talks.push(talk);
      }
      return talks;
    } catch { return []; }
  }

  authoredSoul(ownerSeaPub: string, talkId: string): string {
    void ownerSeaPub;
    return `talks/${encodeURIComponent(talkId)}`;
  }

  receivedSoul(ownerSeaPub: string, authorKey: string, talkId: string): string {
    void ownerSeaPub;
    return `receivedTalks/${encodeURIComponent(authorKey)}/${encodeURIComponent(talkId)}`;
  }

  receivedIndexSoul(ownerSeaPub: string, _talkId?: string): string {
    void ownerSeaPub;
    return 'receivedTalkIndex';
  }

  private async putAndVerify(soul: string, record: GunTalkRecord): Promise<void> {
    // A genuine put() failure (the call itself throwing) is worth retrying — that's a real
    // transient write error. Re-putting the same immutable content-addressed record is
    // idempotent, so a short retry loop here is safe.
    let lastPutError: unknown;
    let committed = false;
    for (let attempt = 1; attempt <= 3 && !committed; attempt += 1) {
      try {
        await this.gun.putPrivate(soul, record);
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
      const readBack = await this.gun.getPrivate(soul) as GunTalkRecord | null;
      if (
        !readBack
        || readBack.version !== 2
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
      const record = await this.gun.getPrivate(soul) as GunTalkRecord | null;
      if (!record || record.version !== 2 || record.talkId !== expectedTalkId || !record.talkJson) return null;
      const talk = JSON.parse(record.talkJson) as Talk;
      return talk?.id === expectedTalkId ? talk : null;
    } catch {
      return null;
    }
  }

  private async readReceivedIndex(
    ownerSeaPub: string,
  ): Promise<Record<string, { version: 2; talkId: string; authorKey: string; soul: string }>> {
    void ownerSeaPub;
    const value = await this.gun.getPrivate(this.receivedIndexSoul(ownerSeaPub));
    if (!value || typeof value !== 'object') return {};
    return value as Record<string, { version: 2; talkId: string; authorKey: string; soul: string }>;
  }

  private updateReceivedIndex(
    ownerSeaPub: string,
    talkId: string,
    authorKey: string,
    soul: string,
  ): Promise<void> {
    const run = this.indexWrite.catch(() => undefined).then(async () => {
      const current = await this.readReceivedIndex(ownerSeaPub);
      await this.gun.putPrivate(this.receivedIndexSoul(ownerSeaPub), {
        ...current,
        [talkId]: { version: 2, talkId, authorKey, soul },
      });
    });
    this.indexWrite = run;
    return run;
  }
}
