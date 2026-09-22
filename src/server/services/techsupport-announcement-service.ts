import SEA from 'gun/sea';
import { canonicalSerialize } from '../../shared/cid';
import {
  announcementAdminAuthorizationPayload,
  createSystemAnnouncement,
  type SystemAnnouncement,
} from '../../shared/system-announcements';
import { currentTechSupportAnnouncementPub } from '../../shared/techsupport';
import techSupportIdentity from '../../shared/techsupport-identity.signed.json';
import type { GunService } from './gun-service';
import { loadTechSupportPairSync } from '../security/techsupport-key-custody';

type SeaPair = { pub: string; epub: string; priv: string; epriv: string };

type TechSupportKeyEnvironment = Record<string, string | undefined>;

/**
 * OPEN-27: the public production relay is a verifier/publisher, never a TechSupport signer.
 * Refuse the configuration before reading or decrypting any key material so a copied `.env.local`
 * cannot silently turn a relay compromise into a root-key compromise.
 */
export function configuredTechSupportPair(
  env: TechSupportKeyEnvironment = process.env as TechSupportKeyEnvironment,
): SeaPair | null {
  const hasKeySource = !!(env.TECHSUPPORT_KEY_FILE || env.TECHSUPPORT_SEA_PAIR_JSON);
  const hasPrivateConfiguration = !!(
    hasKeySource ||
    env.TECHSUPPORT_KEY_PASSPHRASE_FILE ||
    env.TECHSUPPORT_KEY_PASSPHRASE
  );
  if (env.NODE_ENV === 'production' && hasPrivateConfiguration) {
    throw new Error(
      'Refusing to load a TechSupport private key in the production relay. ' +
      'Remove all TECHSUPPORT_KEY_* and TECHSUPPORT_SEA_PAIR_JSON settings; use the local delegate tool.',
    );
  }
  if (!hasKeySource) return null;
  const pair = loadTechSupportPairSync({ env }) as SeaPair;
  if (pair.pub !== currentTechSupportAnnouncementPub()) {
    throw new Error(
      `Configured TechSupport announcement key (${pair.pub}) is not the current announcement key.`,
    );
  }
  return pair;
}

export class TechSupportAnnouncementService {
  private pair: SeaPair | null;

  constructor(private gunService: GunService, pair = configuredTechSupportPair()) {
    this.pair = pair;
  }

  isConfigured(): boolean {
    return this.pair !== null;
  }

  /**
   * K3 (docs/TODO.md): republishes the committed, pre-signed identity record
   * (`src/shared/techsupport-identity.signed.json`, signed once by
   * `scripts/sign-techsupport-identity.js` with the announcement key) — no private key
   * required at boot. The relay only ever needs the public identity record to exist; the
   * private half lives on whichever machine last ran the signing script.
   */
  async publishIdentity(): Promise<void> {
    await this.gunService.putPath(['public', 'techsupport-identity'], techSupportIdentity);
  }

  async createAnnouncement(input: { text: string; expiresAt: string }): Promise<SystemAnnouncement> {
    if (!this.pair) throw new Error('TechSupport SEA identity is not configured');
    const announcement = await createSystemAnnouncement({
      text: input.text,
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt,
    }, this.pair);
    await this.gunService.putPath(['public', 'announcements', announcement.id], announcement);
    return announcement;
  }

  async verifyAdminAuthorization(input: {
    text: string;
    expiresAt: string;
    requestedAt: string;
    authorization: string;
  }): Promise<boolean> {
    if (!this.pair) return false;
    const requestedAt = new Date(input.requestedAt).getTime();
    if (!Number.isFinite(requestedAt) || Math.abs(Date.now() - requestedAt) > 5 * 60_000) return false;
    const verified = await SEA.verify(input.authorization, this.pair.pub);
    return (typeof verified === 'string' ? verified : canonicalSerialize(verified)) === announcementAdminAuthorizationPayload(input);
  }
}
