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
    const publicIdentity = toPublicSeaIdentity(sourcePair);
    await source.removeIfMatches(publicIdentity);
    // docs/TODO.md OPEN-34: some WebView localStorage engines do not durably flush a removeItem()
    // before it returns — confirmed on real Android hardware with the earliest possible JS-level
    // hook (Playwright addInitScript, active before any bundled module's own top-level code):
    // zero further localStorage writes occurred anywhere on the page, yet the just-removed source
    // record reappeared moments later with its original content intact. That is a storage-layer
    // flush-ordering race, not a logic bug — the source's own prior write can still be "in
    // flight" to disk when removeIfMatches's delete lands, and the late write can then commit
    // after the delete. Re-check and retry a few times, with a short backoff, so a late-flushing
    // write cannot leave a stale legacy record surviving an otherwise-successful migration —
    // affects any real device with the same storage-engine quirk, not just this test scenario.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const stillPresent = await source.readPair().catch(() => null);
      if (!stillPresent) break;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      await source.removeIfMatches(publicIdentity).catch(() => undefined);
    }
    return sourcePair;
  }
}
