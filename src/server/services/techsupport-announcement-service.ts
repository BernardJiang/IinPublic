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

function configuredPair(): SeaPair | null {
  if (!process.env.TECHSUPPORT_KEY_FILE && !process.env.TECHSUPPORT_SEA_PAIR_JSON) return null;
  const pair = loadTechSupportPairSync() as SeaPair;
  if (pair.pub !== currentTechSupportAnnouncementPub()) {
    throw new Error(
      `Configured TechSupport announcement key (${pair.pub}) is not the current announcement key.`,
    );
  }
  return pair;
}

export class TechSupportAnnouncementService {
  private pair: SeaPair | null;

  constructor(private gunService: GunService, pair = configuredPair()) {
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
