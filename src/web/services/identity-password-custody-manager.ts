import {
  createPasswordKeyCustodyRecord,
  decryptPasswordKeyCustodyRecord,
  type PasswordCustodyProgress,
} from '../../shared/identity-password-custody';
import {
  toPublicSeaIdentity,
  type PasswordKeyCustodyRecordV2,
  type SeaPrivateIdentityMaterial,
  type SeaPublicIdentity,
} from '../../shared/p2p-runtime';
import type {
  IdentityCustodyMigrationMarker,
  IdentityCustodyStore,
} from './identity-custody-store';

export type LegacyIdentityCustody = {
  assertMatches(expected: SeaPublicIdentity): Promise<void>;
  removeIfMatches(expected: SeaPublicIdentity): Promise<void>;
};

export type IdentityPasswordProtectionStatus =
  | { state: 'not-set' }
  | { state: 'locked'; publicIdentity: SeaPublicIdentity; updatedAt: string };

export type IdentityPasswordCustodyManagerOptions = {
  crypto?: Crypto;
  now?: () => Date;
  onProgress?: PasswordCustodyProgress;
  legacyRecordStorageKey?: string;
  legacySecretStorageKey?: string;
};

function samePublicIdentity(left: SeaPublicIdentity, right: SeaPublicIdentity): boolean {
  return left.pub === right.pub && left.epub === right.epub;
}

function samePrivatePair(
  left: SeaPrivateIdentityMaterial,
  right: SeaPrivateIdentityMaterial,
): boolean {
  return (
    samePublicIdentity(left, right) &&
    left.priv === right.priv &&
    left.epriv === right.epriv
  );
}

export class IdentityPasswordCustodyManager {
  private readonly crypto?: Crypto;
  private readonly now: () => Date;
  private readonly onProgress?: PasswordCustodyProgress;
  private readonly legacyRecordStorageKey: string;
  private readonly legacySecretStorageKey: string;

  constructor(
    private readonly store: IdentityCustodyStore,
    private readonly legacyCustody: LegacyIdentityCustody,
    options: IdentityPasswordCustodyManagerOptions = {},
  ) {
    if (options.crypto) this.crypto = options.crypto;
    this.now = options.now ?? (() => new Date());
    if (options.onProgress) this.onProgress = options.onProgress;
    this.legacyRecordStorageKey = options.legacyRecordStorageKey ?? 'iinpublic_key_custody_v1';
    this.legacySecretStorageKey =
      options.legacySecretStorageKey ?? 'iinpublic_key_custody_device_secret_v1';
  }

  private cryptoOptions(): { crypto?: Crypto; onProgress?: PasswordCustodyProgress } {
    return {
      ...(this.crypto ? { crypto: this.crypto } : {}),
      ...(this.onProgress ? { onProgress: this.onProgress } : {}),
    };
  }

  async getStatus(): Promise<IdentityPasswordProtectionStatus> {
    const active = await this.store.readActive();
    if (!active) return { state: 'not-set' };
    return {
      state: 'locked',
      publicIdentity: active.publicIdentity,
      updatedAt: active.updatedAt,
    };
  }

  async setPassword(
    pair: SeaPrivateIdentityMaterial,
    password: string,
  ): Promise<PasswordKeyCustodyRecordV2> {
    const publicIdentity = toPublicSeaIdentity(pair);
    await this.legacyCustody.assertMatches(publicIdentity);
    if (await this.store.readActive()) throw new Error('Identity password is already set');

    const record = await createPasswordKeyCustodyRecord(pair, password, {
      ...this.cryptoOptions(),
      now: this.now(),
    });
    const preflightPair = await decryptPasswordKeyCustodyRecord(
      record,
      password,
      this.cryptoOptions(),
    );
    if (!samePrivatePair(pair, preflightPair)) throw new Error('Unable to verify password custody');

    const migration: IdentityCustodyMigrationMarker = {
      version: 1,
      kind: 'legacy-device-to-password-v2',
      targetCustodyId: record.custodyId,
      publicIdentity,
      legacyRecordStorageKey: this.legacyRecordStorageKey,
      legacySecretStorageKey: this.legacySecretStorageKey,
      createdAt: this.now().toISOString(),
    };

    await this.store.replaceActive(null, record, migration);
    let committedRecordVerified = false;
    try {
      const committed = await this.store.readActive();
      if (!committed || committed.custodyId !== record.custodyId) {
        throw new Error('Unable to verify committed password custody');
      }
      const committedPair = await decryptPasswordKeyCustodyRecord(
        committed,
        password,
        this.cryptoOptions(),
      );
      if (!samePrivatePair(pair, committedPair)) {
        throw new Error('Unable to verify committed password custody');
      }
      committedRecordVerified = true;
      await this.legacyCustody.removeIfMatches(publicIdentity);
      await this.store.completeMigration(record.custodyId);
      return record;
    } catch (error) {
      if (!committedRecordVerified) {
        await this.store.deleteActive(record.custodyId).catch(() => undefined);
      }
      throw error;
    }
  }

  async unlock(password: string): Promise<SeaPrivateIdentityMaterial> {
    const active = await this.store.readActive();
    if (!active) throw new Error('Identity password is not set');
    const pair = await decryptPasswordKeyCustodyRecord(active, password, this.cryptoOptions());
    const migration = await this.store.readMigration();
    if (migration) {
      if (
        migration.targetCustodyId !== active.custodyId ||
        !samePublicIdentity(migration.publicIdentity, active.publicIdentity)
      ) {
        throw new Error('Identity custody migration is inconsistent');
      }
      await this.legacyCustody.removeIfMatches(active.publicIdentity);
      await this.store.completeMigration(active.custodyId);
    }
    return pair;
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<PasswordKeyCustodyRecordV2> {
    const pair = await this.unlock(currentPassword);
    const current = await this.store.readActive();
    if (!current) throw new Error('Identity password is not set');
    if (!samePublicIdentity(toPublicSeaIdentity(pair), current.publicIdentity)) {
      throw new Error('Unable to unlock identity');
    }

    const next = await createPasswordKeyCustodyRecord(pair, newPassword, {
      ...this.cryptoOptions(),
      now: this.now(),
      createdAt: current.createdAt,
    });
    const preflightPair = await decryptPasswordKeyCustodyRecord(
      next,
      newPassword,
      this.cryptoOptions(),
    );
    if (!samePrivatePair(pair, preflightPair)) throw new Error('Unable to verify password custody');

    await this.store.replaceActive(current.custodyId, next, null);
    try {
      const committed = await this.store.readActive();
      if (!committed || committed.custodyId !== next.custodyId) {
        throw new Error('Unable to verify committed password custody');
      }
      const committedPair = await decryptPasswordKeyCustodyRecord(
        committed,
        newPassword,
        this.cryptoOptions(),
      );
      if (!samePrivatePair(pair, committedPair)) {
        throw new Error('Unable to verify committed password custody');
      }
      return next;
    } catch (error) {
      await this.store.replaceActive(next.custodyId, current, null).catch(() => undefined);
      throw error;
    }
  }
}
