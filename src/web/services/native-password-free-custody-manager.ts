import { toPublicSeaIdentity, type SeaPrivateIdentityMaterial, type SeaPublicIdentity } from '../../shared/p2p-runtime';
import type { NativeCustodyBridge, NativeCustodyDescription } from '../../shared/native-custody-bridge';
import type { PasswordFreeCustodyMigrationSource } from './browser-password-free-custody-manager';

function samePublic(a: SeaPublicIdentity, b: SeaPublicIdentity): boolean {
  return a.pub === b.pub && a.epub === b.epub;
}

function samePrivate(a: SeaPrivateIdentityMaterial, b: SeaPrivateIdentityMaterial): boolean {
  return samePublic(a, b) && a.priv === b.priv && a.epriv === b.epriv;
}

/**
 * Same surface as BrowserPasswordFreeCustodyManager, but the wrapping key lives in the OS
 * keystore (Android Keystore, Apple Keychain, Electron safeStorage) behind a NativeCustodyBridge.
 */
export class NativePasswordFreeCustodyManager {
  constructor(private readonly bridge: NativeCustodyBridge) {}

  describe(): Promise<NativeCustodyDescription> {
    return this.bridge.describe();
  }

  async readPair(): Promise<SeaPrivateIdentityMaterial | null> {
    return this.bridge.read();
  }

  async getPublicIdentity(): Promise<SeaPublicIdentity | null> {
    const pair = await this.readPair();
    return pair ? toPublicSeaIdentity(pair) : null;
  }

  async assertMatches(expected: SeaPublicIdentity): Promise<void> {
    const pair = await this.readPair();
    if (!pair || !samePublic(toPublicSeaIdentity(pair), expected)) {
      throw new Error('Password-free identity custody mismatch');
    }
  }

  async assertPairMatches(expected: SeaPrivateIdentityMaterial): Promise<void> {
    const pair = await this.readPair();
    if (!pair || !samePrivate(pair, expected)) throw new Error('Password-free identity custody mismatch');
  }

  async writeAndVerify(pair: SeaPrivateIdentityMaterial): Promise<void> {
    const current = await this.readPair();
    if (current && !samePublic(current, pair)) {
      throw new Error('Refusing to replace custody for a different identity');
    }
    try {
      await this.bridge.write(pair);
      await this.assertPairMatches(pair);
    } catch (error) {
      if (current) await this.bridge.write(current).catch(() => undefined);
      else await this.bridge.remove(toPublicSeaIdentity(pair)).catch(() => undefined);
      throw error;
    }
  }

  async removeIfMatches(expected: SeaPublicIdentity): Promise<void> {
    const pair = await this.readPair();
    if (!pair) return;
    if (!samePublic(toPublicSeaIdentity(pair), expected)) {
      throw new Error('Refusing to remove custody for a different identity');
    }
    await this.bridge.remove(expected);
  }

  async clear(): Promise<void> {
    const pair = await this.readPair();
    if (pair) await this.bridge.remove(toPublicSeaIdentity(pair));
  }

  async close(): Promise<void> {}

  async migrateFrom(source: PasswordFreeCustodyMigrationSource): Promise<SeaPrivateIdentityMaterial | null> {
    const sourcePair = await source.readPair();
    const currentPair = await this.readPair();
    if (!sourcePair) return currentPair;
    if (currentPair && !samePrivate(currentPair, sourcePair)) {
      throw new Error('Password-free identity migration conflict');
    }
    if (!currentPair) await this.writeAndVerify(sourcePair);
    await this.assertPairMatches(sourcePair);
    await source.removeIfMatches(toPublicSeaIdentity(sourcePair));
    return sourcePair;
  }
}
