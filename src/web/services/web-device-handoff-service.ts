/**
 * Web wrapper around the encrypted device-handoff protocol (spec §11.2, item J).
 *
 * SEA-backed crypto + Gun read/write for the shared pure protocol
 * (`shared/handoff-protocol.ts`). Every Gun path here is a flat compound-string exact-key
 * read/write (matches `WebIdentityLinkService`'s own convention) — never a nested
 * `.get().get()` edge chain — because every caller always already knows BOTH pubs
 * involved before it needs to read anything: the sender knows which linked device it's
 * sending to (from the same "Linked devices" list §I already resolves), and the receiver
 * knows which pub(s) it's linked to for the exact same reason. No party ever needs to
 * *discover* an unknown sender, so no `.map()`-based Gun collection is needed anywhere in
 * this file (contrast the ledger's own inbox, which genuinely does need discovery —
 * see web-ledger-service.ts's `subscribeToInbox` doc comment for why that one differs).
 */
import { getSEA } from '../sea-gun';
import type { WebGunService } from './web-gun-service';
import type { HandoffArchive } from '../../shared/device-handoff';
import {
  HandoffCrypto,
  buildEpubAnnouncement,
  verifyEpubAnnouncement,
  encryptHandoffArchive,
  decryptHandoffArchive,
  buildHandoffAck,
  verifyHandoffAck,
  type EpubAnnouncement,
  type HandoffEnvelope,
  type HandoffAck,
} from '../../shared/handoff-protocol';

const GUN_EPUB_ROOT = 'identity-epub';
const GUN_HANDOFF_ROOT = 'handoff';
const GUN_HANDOFF_ACK_ROOT = 'handoff-ack';

export type SendHandoffResult = 'sent' | 'no-epub' | 'unavailable';

export class WebDeviceHandoffService {
  private readonly gunService: WebGunService;

  constructor(gunService: WebGunService) {
    this.gunService = gunService;
  }

  selfPub(): string {
    return this.gunService.getStoredPair()?.pub || '';
  }

  private selfEpub(): string {
    return this.gunService.getStoredPair()?.epub || '';
  }

  /** SEA-backed crypto for the shared protocol. */
  crypto(): HandoffCrypto {
    const pair = this.gunService.getStoredPair();
    return {
      sign: async (data: string) => {
        const SEA = getSEA();
        if (!pair) throw new Error('No SEA keypair to sign handoff records');
        return String(await SEA.sign(data, pair));
      },
      verify: async (data: string, sig: string, pub: string) => {
        try {
          const SEA = getSEA();
          const verified = await SEA.verify(sig, pub);
          return verified === data;
        } catch {
          return false;
        }
      },
      secret: async (peerEpub: string) => {
        const SEA = getSEA();
        if (!pair) throw new Error('No SEA keypair to derive a handoff secret');
        return String(await SEA.secret(peerEpub, pair));
      },
      encrypt: async (plaintext: string, secret: string) => {
        const SEA = getSEA();
        return String(await SEA.encrypt(plaintext, secret));
      },
      decrypt: async (ciphertext: string, secret: string) => {
        try {
          const SEA = getSEA();
          const dec = await SEA.decrypt(ciphertext, secret);
          if (dec === undefined || dec === null) return undefined;
          // §J bugfix (same class of quirk web-ledger-service.ts's own doc comment
          // documents for SEA.verify): the plaintext handed to SEA.encrypt here is
          // always `JSON.stringify(archive)` — a string that *looks like* JSON — and
          // SEA.decrypt auto-parses a JSON-shaped result back into a real object rather
          // than returning the original string. A bare `String(dec)` on that object gives
          // the literal text "[object Object]", not the JSON this module's own
          // `decryptHandoffArchive` needs to `JSON.parse` back into a `HandoffArchive`.
          // Re-stringify a non-string result instead of coercing it.
          return typeof dec === 'string' ? dec : JSON.stringify(dec);
        } catch {
          return undefined;
        }
      },
    };
  }

  /**
   * Publish this identity's signed pub→epub binding so a linked device can encrypt a
   * handoff to it without needing to already know its app-level userId. Safe/idempotent
   * to call on every boot (cheap single Gun write); best-effort — a failure here just
   * means a handoff *to* this device won't be sendable yet, not a boot blocker.
   */
  async publishEpub(): Promise<void> {
    const pub = this.selfPub();
    const epub = this.selfEpub();
    if (!pub || !epub) return;
    try {
      const announcement = await buildEpubAnnouncement(pub, epub, this.crypto());
      await this.gunService.put(this.epubPath(pub), announcement as unknown as Record<string, unknown>);
    } catch {
      /* best effort */
    }
  }

  /** Resolve and verify `pub`'s published epub, or null if absent/invalid. */
  async resolveEpub(pub: string): Promise<string | null> {
    const raw = await this.gunService.get(this.epubPath(pub)).catch(() => null);
    if (!raw || typeof raw !== 'object' || !(raw as EpubAnnouncement).sig) return null;
    const announcement = raw as EpubAnnouncement;
    if (announcement.pub !== pub) return null; // never trust a record found at the wrong path
    if (!(await verifyEpubAnnouncement(announcement, this.crypto()))) return null;
    return announcement.epub;
  }

  /** Encrypt `archive` to `toPub` and publish the signed envelope. */
  async sendHandoffArchive(toPub: string, archive: HandoffArchive): Promise<SendHandoffResult> {
    const fromPub = this.selfPub();
    if (!fromPub || !toPub) return 'unavailable';
    const toEpub = await this.resolveEpub(toPub);
    if (!toEpub) return 'no-epub';
    const envelope = await encryptHandoffArchive({ archive, fromPub, toPub, toEpub, crypto: this.crypto() });
    await this.gunService.put(this.handoffPath(toPub, fromPub), envelope as unknown as Record<string, unknown>);
    return 'sent';
  }

  /** Read, verify, and decrypt an incoming handoff from `fromPub`, or null if none/invalid. */
  async readIncomingHandoff(fromPub: string): Promise<HandoffArchive | null> {
    const toPub = this.selfPub();
    if (!toPub || !fromPub) return null;
    const raw = await this.gunService.get(this.handoffPath(toPub, fromPub)).catch(() => null);
    if (!raw || typeof raw !== 'object' || !(raw as HandoffEnvelope).sig) return null;
    const envelope = raw as HandoffEnvelope;
    if (envelope.toPub !== toPub || envelope.fromPub !== fromPub) return null;
    const fromEpub = await this.resolveEpub(fromPub);
    if (!fromEpub) return null;
    return decryptHandoffArchive(envelope, fromEpub, this.crypto());
  }

  /** Receiver: publish signed proof that `fromPub`'s (the original sender's) archive was imported. */
  async acknowledgeHandoff(originalSenderPub: string): Promise<void> {
    const fromPub = this.selfPub(); // the receiver signs the ack
    if (!fromPub || !originalSenderPub) return;
    const ack = await buildHandoffAck({ fromPub, toPub: originalSenderPub, crypto: this.crypto() });
    await this.gunService.put(this.ackPath(originalSenderPub, fromPub), ack as unknown as Record<string, unknown>);
  }

  /**
   * Sender: poll for the receiver's acknowledgement. Returns false (never throws) on
   * timeout — the caller (app.ts) must treat false as "not acknowledged" and keep Erase
   * disabled; it must never be interpreted as success.
   */
  async waitForHandoffAck(receiverPub: string, timeoutMs = 60_000, pollMs = 1_000): Promise<boolean> {
    const fromPub = this.selfPub(); // the original sender, waiting on its own ack path
    if (!fromPub || !receiverPub) return false;
    const deadline = Date.now() + timeoutMs;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const raw = await this.gunService.get(this.ackPath(fromPub, receiverPub)).catch(() => null);
      if (raw && typeof raw === 'object' && (raw as HandoffAck).sig) {
        const ack = raw as HandoffAck;
        if (ack.toPub === fromPub && ack.fromPub === receiverPub && await verifyHandoffAck(ack, this.crypto())) {
          return true;
        }
      }
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  private epubPath(pub: string): string {
    return `${GUN_EPUB_ROOT}/${encodeURIComponent(pub)}`;
  }

  private handoffPath(toPub: string, fromPub: string): string {
    return `${GUN_HANDOFF_ROOT}/${encodeURIComponent(toPub)}/${encodeURIComponent(fromPub)}`;
  }

  private ackPath(senderPub: string, receiverPub: string): string {
    return `${GUN_HANDOFF_ACK_ROOT}/${encodeURIComponent(senderPub)}/${encodeURIComponent(receiverPub)}`;
  }
}
