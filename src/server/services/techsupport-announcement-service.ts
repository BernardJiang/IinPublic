import SEA from 'gun/sea';
import { canonicalSerialize } from '../../shared/cid';
import {
  announcementAdminAuthorizationPayload,
  createSystemAnnouncement,
  type SystemAnnouncement,
} from '../../shared/system-announcements';
import { TECHSUPPORT_NETWORK_ROLE, TECHSUPPORT_PUB, TECHSUPPORT_ROOT_USER_ID } from '../../shared/techsupport';
import type { GunService } from './gun-service';

type SeaPair = { pub: string; epub: string; priv: string; epriv: string };

function configuredPair(raw = process.env.TECHSUPPORT_SEA_PAIR_JSON): SeaPair | null {
  if (!raw) return null;
  try {
    const pair = JSON.parse(raw) as SeaPair;
    if (!pair.pub || !pair.epub || !pair.priv || !pair.epriv || pair.pub !== TECHSUPPORT_PUB) return null;
    return pair;
  } catch {
    return null;
  }
}

export class TechSupportAnnouncementService {
  private pair: SeaPair | null;

  constructor(private gunService: GunService, pair = configuredPair()) {
    this.pair = pair;
  }

  isConfigured(): boolean {
    return this.pair !== null;
  }

  async publishIdentity(): Promise<void> {
    if (!this.pair) throw new Error('TechSupport SEA identity is not configured');
    const identity = {
      userId: TECHSUPPORT_ROOT_USER_ID,
      pub: this.pair.pub,
      epub: this.pair.epub,
      role: TECHSUPPORT_NETWORK_ROLE,
    };
    const signature = await SEA.sign(canonicalSerialize(identity), this.pair);
    await this.gunService.putPath(['public', 'techsupport-identity'], { ...identity, signature });
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
