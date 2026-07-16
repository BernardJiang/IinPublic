import { getSEA } from '../sea-gun';
import type { WebGunService } from './web-gun-service';
import {
  LinkCrypto,
  PairingPayload,
  LinkAttestation,
  LinkRevocation,
  LinkState,
  createPairingPayload,
  encodePairingCode,
  decodePairingCode,
  isPairingExpired,
  buildLinkAttestation,
  buildRevocation,
  linkVerified,
  resolveLinkState,
} from '../../shared/identity-linking';

/** A linked-device record as displayed on the Linked devices page. */
export interface LinkedDeviceRecord {
  pub: string;
  stageName: string;
  platform: string;
  linkedAt: number;
  state: LinkState;
}

const LOCAL_LINKS_KEY = 'iinpublic_linked_devices';
const GUN_LINK_ROOT = 'identity-links';
const GUN_REVOKE_ROOT = 'identity-link-revocations';

/**
 * Web wrapper around the shared identity-linking protocol (§10 / item I).
 *
 * Provides a SEA-backed `LinkCrypto`, Gun read/write of the mutual attestations,
 * and a local display model for the Linked devices page. Keys never leave the
 * device — only signed attestations are published.
 */
export class WebIdentityLinkService {
  private readonly gunService: WebGunService;
  /** Secret for the code this device is currently showing (Link-a-device flow). */
  private pendingSecret: string | null = null;

  constructor(gunService: WebGunService) {
    this.gunService = gunService;
  }

  /** SEA-backed crypto for the shared protocol. */
  crypto(): LinkCrypto {
    const seaPair = this.gunService.getStoredPair();
    return {
      sign: async (data: string) => {
        const SEA = getSEA();
        if (!seaPair) throw new Error('No SEA keypair to sign link attestations');
        return String(await SEA.sign(data, seaPair));
      },
      verify: async (data: string, sig: string, pub: string) => {
        const SEA = getSEA();
        try {
          const verified = await SEA.verify(sig, pub);
          return verified === data;
        } catch {
          return false;
        }
      },
      hash: async (data: string) => {
        const SEA = getSEA();
        const h = await SEA.work(data, null, null, { name: 'SHA-256' });
        return String(h);
      },
      randomSecret: () => {
        const bytes = new Uint8Array(18);
        (globalThis.crypto || (window as any).crypto).getRandomValues(bytes);
        return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      },
    };
  }

  selfPub(): string {
    return this.gunService.getStoredPair()?.pub || '';
  }

  /** Generate a fresh pairing code (device A). Stores the secret for completion. */
  createLinkCode(now: number = Date.now()): { payload: PairingPayload; code: string } {
    const payload = createPairingPayload(this.selfPub(), this.crypto(), now);
    this.pendingSecret = payload.secret;
    return { payload, code: encodePairingCode(payload) };
  }

  /**
   * Device B: validate and complete a link from a scanned/typed code. Publishes
   * B's signed attestation toward the code's pub. Returns an error key on failure.
   */
  async completeLinkFromCode(
    code: string,
    now: number = Date.now(),
  ): Promise<{ ok: true; peerPub: string } | { ok: false; error: 'invalid' | 'expired' | 'reused' | 'self' }> {
    const payload = decodePairingCode(code);
    if (!payload) return { ok: false, error: 'invalid' };
    if (payload.pub === this.selfPub()) return { ok: false, error: 'self' };
    if (isPairingExpired(payload, now)) return { ok: false, error: 'expired' };

    // Reuse guard: a completed edge already present.
    const existing = await this.readAttestation(this.selfPub(), payload.pub);
    if (existing) return { ok: false, error: 'reused' };

    const att = await buildLinkAttestation({
      selfPub: this.selfPub(),
      peerPub: payload.pub,
      secret: payload.secret,
      crypto: this.crypto(),
      now,
    });
    await this.publishAttestation(att);
    return { ok: true, peerPub: payload.pub };
  }

  /**
   * Device A: after seeing B's attestation, publish A's own attestation to
   * complete the mutual link. Verifies B referenced the same pairing secret.
   */
  async confirmIncomingLink(peerPub: string, now: number = Date.now()): Promise<boolean> {
    if (!this.pendingSecret) return false;
    const attFromPeer = await this.readAttestation(peerPub, this.selfPub());
    if (!attFromPeer) return false;
    const crypto = this.crypto();
    const expectedHash = await crypto.hash(this.pendingSecret);
    if (attFromPeer.secretHash !== expectedHash) return false;
    const attSelf = await buildLinkAttestation({
      selfPub: this.selfPub(),
      peerPub,
      secret: this.pendingSecret,
      crypto,
      now,
    });
    await this.publishAttestation(attSelf);
    this.pendingSecret = null;
    return true;
  }

  async unlink(peerPub: string, now: number = Date.now()): Promise<void> {
    const rev = await buildRevocation({ selfPub: this.selfPub(), peerPub, crypto: this.crypto(), now });
    await this.publishRevocation(rev);
    this.removeLocalRecord(peerPub);
  }

  /** Resolve the current state of a link with `peerPub` from the graph. */
  async linkStateWith(peerPub: string): Promise<LinkState> {
    const [attSelf, attPeer, revSelf, revPeer] = await Promise.all([
      this.readAttestation(this.selfPub(), peerPub),
      this.readAttestation(peerPub, this.selfPub()),
      this.readRevocation(this.selfPub(), peerPub),
      this.readRevocation(peerPub, this.selfPub()),
    ]);
    return resolveLinkState({
      attFromSelf: attSelf,
      attFromPeer: attPeer,
      revocation: revSelf || revPeer,
      crypto: this.crypto(),
    });
  }

  /** Are two identities in the same verified cluster? (used by cluster rendering) */
  async isLinked(peerPub: string): Promise<boolean> {
    const [attSelf, attPeer] = await Promise.all([
      this.readAttestation(this.selfPub(), peerPub),
      this.readAttestation(peerPub, this.selfPub()),
    ]);
    return linkVerified(attSelf, attPeer, this.crypto());
  }

  // --- local display model (list on the Linked devices page) --------------------

  listLocalRecords(): LinkedDeviceRecord[] {
    try {
      const raw = localStorage.getItem(LOCAL_LINKS_KEY);
      const arr = raw ? (JSON.parse(raw) as LinkedDeviceRecord[]) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  upsertLocalRecord(record: LinkedDeviceRecord): void {
    const list = this.listLocalRecords().filter((r) => r.pub !== record.pub);
    list.push(record);
    localStorage.setItem(LOCAL_LINKS_KEY, JSON.stringify(list));
  }

  removeLocalRecord(pub: string): void {
    const list = this.listLocalRecords().filter((r) => r.pub !== pub);
    localStorage.setItem(LOCAL_LINKS_KEY, JSON.stringify(list));
  }

  // --- Gun read/write -----------------------------------------------------------

  private linkPath(fromPub: string, toPub: string): string {
    return `${GUN_LINK_ROOT}/${encodeURIComponent(fromPub)}/${encodeURIComponent(toPub)}`;
  }

  private revokePath(fromPub: string, toPub: string): string {
    return `${GUN_REVOKE_ROOT}/${encodeURIComponent(fromPub)}/${encodeURIComponent(toPub)}`;
  }

  private async publishAttestation(att: LinkAttestation): Promise<void> {
    await this.gunService.putPublic(this.linkPath(att.fromPub, att.toPub), att as unknown as Record<string, unknown>);
  }

  private async publishRevocation(rev: LinkRevocation): Promise<void> {
    await this.gunService.putPublic(this.revokePath(rev.fromPub, rev.toPub), rev as unknown as Record<string, unknown>);
  }

  private async readAttestation(fromPub: string, toPub: string): Promise<LinkAttestation | null> {
    const raw = await this.gunService.get(this.linkPath(fromPub, toPub)).catch(() => null);
    return raw && typeof raw === 'object' && raw.sig ? (raw as LinkAttestation) : null;
  }

  private async readRevocation(fromPub: string, toPub: string): Promise<LinkRevocation | null> {
    const raw = await this.gunService.get(this.revokePath(fromPub, toPub)).catch(() => null);
    return raw && typeof raw === 'object' && raw.sig ? (raw as LinkRevocation) : null;
  }
}
