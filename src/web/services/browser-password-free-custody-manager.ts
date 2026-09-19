import {
  createBrowserPasswordFreeCustody,
  decryptBrowserPasswordFreeCustody,
  type BrowserPasswordFreeCustody,
} from '../../shared/identity-password-free-custody';
import { toPublicSeaIdentity, type SeaPrivateIdentityMaterial, type SeaPublicIdentity } from '../../shared/p2p-runtime';
import { BrowserPasswordFreeCustodyStore } from './identity-password-free-custody-store';

export type PasswordFreeCustodyMigrationSource = {
  readPair(): Promise<SeaPrivateIdentityMaterial | null>;
  removeIfMatches(expected: SeaPublicIdentity): Promise<void>;
};

export type BrowserPasswordFreeCustodyManagerOptions = {
  crypto?: Crypto;
  now?: () => Date;
};

function samePublicIdentity(left: SeaPublicIdentity, right: SeaPublicIdentity): boolean {
  return left.pub === right.pub && left.epub === right.epub;
}

function samePrivatePair(left: SeaPrivateIdentityMaterial, right: SeaPrivateIdentityMaterial): boolean {
  return (
    samePublicIdentity(left, right) &&
    left.priv === right.priv &&
    left.epriv === right.epriv
  );
}

export class BrowserPasswordFreeCustodyManager {
  private readonly crypto: Crypto | undefined;
  private readonly now: () => Date;

  constructor(
    private readonly store: BrowserPasswordFreeCustodyStore,
    options: BrowserPasswordFreeCustodyManagerOptions = {},
  ) {
    this.crypto = options.crypto;
    this.now = options.now ?? (() => new Date());
  }

  private cryptoOptions(): { crypto?: Crypto } {
    return this.crypto ? { crypto: this.crypto } : {};
  }

  async readPair(): Promise<SeaPrivateIdentityMaterial | null> {
    const active = await this.store.readActive();
    if (!active) return null;
    return decryptBrowserPasswordFreeCustody(active.record, active.wrappingKey, this.cryptoOptions());
  }

  async getPublicIdentity(): Promise<SeaPublicIdentity | null> {
    const active = await this.store.readActive();
    return active?.record.publicIdentity ?? null;
  }

  async assertMatches(expected: SeaPublicIdentity): Promise<void> {
    const pair = await this.readPair();
    if (!pair || !samePublicIdentity(toPublicSeaIdentity(pair), expected)) {
      throw new Error('Password-free identity custody mismatch');
    }
  }

  async assertPairMatches(expected: SeaPrivateIdentityMaterial): Promise<void> {
    const pair = await this.readPair();
    if (!pair || !samePrivatePair(pair, expected)) {
      throw new Error('Password-free identity custody mismatch');
    }
  }

  async writeAndVerify(pair: SeaPrivateIdentityMaterial): Promise<void> {
    const current = await this.store.readActive();
    if (current && !samePublicIdentity(current.record.publicIdentity, toPublicSeaIdentity(pair))) {
      throw new Error('Refusing to replace custody for a different identity');
    }
    const next = await createBrowserPasswordFreeCustody(pair, {
      ...this.cryptoOptions(),
      now: this.now(),
      ...(current ? { createdAt: current.record.createdAt } : {}),
    });
    const preflight = await decryptBrowserPasswordFreeCustody(
      next.record,
      next.wrappingKey,
      this.cryptoOptions(),
    );
    if (!samePrivatePair(preflight, pair)) throw new Error('Unable to verify password-free identity custody');

    await this.store.replaceActive(current?.record.custodyId ?? null, next);
    try {
      await this.assertPairMatches(pair);
    } catch (error) {
      await this.rollbackReplacement(next, current);
      throw error;
    }
  }

  private async rollbackReplacement(
    next: BrowserPasswordFreeCustody,
    previous: BrowserPasswordFreeCustody | null,
  ): Promise<void> {
    if (previous) {
      await this.store.replaceActive(next.record.custodyId, previous).catch(() => undefined);
    } else {
      await this.store.deleteActive(next.record.custodyId).catch(() => undefined);
    }
  }

  async removeIfMatches(expected: SeaPublicIdentity): Promise<void> {
    const active = await this.store.readActive();
    if (!active) return;
    const pair = await decryptBrowserPasswordFreeCustody(
      active.record,
      active.wrappingKey,
      this.cryptoOptions(),
    );
    if (!samePublicIdentity(toPublicSeaIdentity(pair), expected)) {
      throw new Error('Refusing to remove custody for a different identity');
    }
    await this.store.deleteActive(active.record.custodyId);
  }

  async clear(): Promise<void> {
    const active = await this.store.readActive();
    if (active) await this.store.deleteActive(active.record.custodyId);
  }

  /**
   * Copy first, decrypt/read back from IndexedDB, then remove the v1 source. If source cleanup
   * fails, both valid copies remain and a later call can safely finish cleanup.
   */
  async migrateFrom(source: PasswordFreeCustodyMigrationSource): Promise<SeaPrivateIdentityMaterial | null> {
    const sourcePair = await source.readPair();
    const currentPair = await this.readPair();
    if (!sourcePair) return currentPair;
    if (currentPair && !samePrivatePair(currentPair, sourcePair)) {
      throw new Error('Password-free identity migration conflict');
    }
    if (!currentPair) await this.writeAndVerify(sourcePair);
    await this.assertPairMatches(sourcePair);
    await source.removeIfMatches(toPublicSeaIdentity(sourcePair));
    return sourcePair;
  }
}
