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
  verifyLinkAttestation,
  verifyRevocation,
} from '../../shared/identity-linking';

/** A linked-device record as displayed on the Linked devices page. */
export interface LinkedDeviceRecord {
  pub: string;
  stageName: string;
  platform: string;
  linkedAt: number;
  state: 'waiting' | 'linked' | 'revocation-pending' | 'removed' | 'invalid' | 'conflicted';
}

export interface IncomingLinkRequest {
  peerPub: string;
  issuedAt: number;
  expiresAt: number;
}

interface PendingOutgoingLinkV1 {
  version: 1;
  payload: PairingPayload;
  createdAt: number;
}

interface ConsumedPairingV1 {
  requestId: string;
  expiresAt: number;
}

interface PendingRevocationV1 {
  version: 1;
  revocation: LinkRevocation;
  queuedAt: number;
  lastAttemptAt: number;
  attempts: number;
}

export type ResolvedLinkState = LinkState | 'invalid' | 'conflicted';
export type UnlinkResult = 'removed' | 'revocation-pending';

const LOCAL_LINKS_KEY = 'iinpublic_linked_devices';
const PENDING_OUTGOING_KEY = 'iinpublic_identity_link_pending_outgoing_v1';
const CONSUMED_PAIRINGS_KEY = 'iinpublic_identity_link_consumed_v1';
const PENDING_REVOCATIONS_KEY = 'iinpublic_identity_link_pending_revocations_v1';
const GUN_LINK_ROOT = 'identity-links';
const GUN_REVOKE_ROOT = 'identity-link-revocations';
const GUN_REQUEST_ROOT = 'identity-link-requests';

/**
 * Web wrapper around the shared identity-linking protocol (§10 / item I).
 *
 * Provides a SEA-backed `LinkCrypto`, Gun read/write of the mutual attestations,
 * and a local display model for the Linked devices page. Keys never leave the
 * device — only signed attestations are published.
 */
export class WebIdentityLinkService {
  private readonly gunService: WebGunService;
  private readonly storage: Storage | undefined;

  constructor(
    gunService: WebGunService,
    storage: Storage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
  ) {
    this.gunService = gunService;
    this.storage = storage;
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

  /** Generate a fresh pairing code (device A) and persist its expiring approval state. */
  createLinkCode(now: number = Date.now()): { payload: PairingPayload; code: string } {
    if (!this.selfPub()) throw new Error('No SEA identity available for pairing');
    const payload = createPairingPayload(this.selfPub(), this.crypto(), now);
    this.writeJson(PENDING_OUTGOING_KEY, {
      version: 1,
      payload,
      createdAt: now,
    } satisfies PendingOutgoingLinkV1);
    return { payload, code: encodePairingCode(payload) };
  }

  getPendingOutgoing(now: number = Date.now()): PairingPayload | null {
    const record = this.readJson<PendingOutgoingLinkV1>(PENDING_OUTGOING_KEY);
    if (
      !record
      || record.version !== 1
      || !record.payload
      || isPairingExpired(record.payload, now)
    ) {
      this.removeStorage(PENDING_OUTGOING_KEY);
      return null;
    }
    return record.payload;
  }

  cancelPendingLink(requestId?: string): void {
    const pending = this.getPendingOutgoing();
    if (!requestId || !pending || pending.requestId === requestId) {
      this.removeStorage(PENDING_OUTGOING_KEY);
    }
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

    if (this.isPairingConsumed(payload.requestId, now)) return { ok: false, error: 'reused' };

    // An interrupted attempt may already have written the canonical attestation.
    // Accept only an exact, valid match so retry can finish the request inbox write.
    const existing = await this.readAttestation(this.selfPub(), payload.pub);
    const crypto = this.crypto();
    const expectedHash = await crypto.hash(payload.secret);
    if (
      existing
      && (!(await verifyLinkAttestation(existing, crypto)) || existing.secretHash !== expectedHash)
    ) {
      return { ok: false, error: 'reused' };
    }

    const att = existing ?? await buildLinkAttestation({
        selfPub: this.selfPub(),
        peerPub: payload.pub,
        secret: payload.secret,
        crypto,
        now,
      });
    await Promise.all([
      this.publishAttestation(att),
      this.publishIncomingRequest(payload.pub, payload.requestId, att),
    ]);
    this.markPairingConsumed(payload.requestId, payload.expiresAt, now);
    return { ok: true, peerPub: payload.pub };
  }

  /** Device A: find the signed request matching the currently displayed code. */
  async readIncomingLinkRequest(now: number = Date.now()): Promise<IncomingLinkRequest | null> {
    const pending = this.getPendingOutgoing(now);
    if (!pending) return null;
    const raw = await this.gunService.get(this.requestPath(this.selfPub(), pending.requestId)).catch(() => null);
    if (!raw || typeof raw !== 'object' || typeof raw.request !== 'string') return null;
    let att: LinkAttestation;
    try {
      att = JSON.parse(raw.request) as LinkAttestation;
    } catch {
      return null;
    }
    const crypto = this.crypto();
    const expectedHash = await crypto.hash(pending.secret);
    if (
      att.toPub !== this.selfPub()
      || att.secretHash !== expectedHash
      || att.issuedAt > pending.expiresAt
      || !(await verifyLinkAttestation(att, crypto))
    ) {
      return null;
    }
    return { peerPub: att.fromPub, issuedAt: att.issuedAt, expiresAt: pending.expiresAt };
  }

  /**
   * Device A: after seeing B's attestation, publish A's own attestation to
   * complete the mutual link. Verifies B referenced the same pairing secret.
   */
  async confirmIncomingLink(peerPub: string, now: number = Date.now()): Promise<boolean> {
    if (this.hasPendingRevocation(peerPub)) return false;
    const pending = this.getPendingOutgoing(now);
    if (!pending) return false;
    const request = await this.readIncomingLinkRequest(now);
    if (!request || request.peerPub !== peerPub) return false;
    const attFromPeer = await this.readAttestation(peerPub, this.selfPub());
    if (!attFromPeer) return false;
    const crypto = this.crypto();
    const expectedHash = await crypto.hash(pending.secret);
    if (attFromPeer.secretHash !== expectedHash) return false;
    const attSelf = await buildLinkAttestation({
      selfPub: this.selfPub(),
      peerPub,
      secret: pending.secret,
      crypto,
      now,
    });
    await this.publishAttestation(attSelf);
    const verified = await linkVerified(attSelf, attFromPeer, crypto);
    if (!verified) return false;
    this.removeStorage(PENDING_OUTGOING_KEY);
    this.upsertLocalRecord({
      pub: peerPub,
      stageName: 'Linked identity',
      platform: 'unknown',
      linkedAt: now,
      state: 'linked',
    });
    return verified;
  }

  async unlink(peerPub: string, now: number = Date.now()): Promise<UnlinkResult> {
    const existing = this.pendingRevocations().find((record) => record.revocation.toPub === peerPub);
    if (!existing) {
      const revocation = await buildRevocation({
        selfPub: this.selfPub(),
        peerPub,
        crypto: this.crypto(),
        now,
      });
      this.queueRevocation({
        version: 1,
        revocation,
        queuedAt: now,
        lastAttemptAt: 0,
        attempts: 0,
      });
    }

    // Deny local trust before touching the network. Failed publication remains
    // visible and retryable instead of silently restoring the link.
    this.setLocalRecordState(peerPub, 'revocation-pending', now);
    await this.flushPendingRevocations(now, peerPub);
    return this.hasPendingRevocation(peerPub) ? 'revocation-pending' : 'removed';
  }

  /** Retry signed revocations queued while the graph was unavailable. */
  async flushPendingRevocations(now: number = Date.now(), onlyPeerPub?: string): Promise<void> {
    const crypto = this.crypto();
    const pending = this.pendingRevocations();
    const remaining: PendingRevocationV1[] = [];
    for (const record of pending) {
      if (onlyPeerPub && record.revocation.toPub !== onlyPeerPub) {
        remaining.push(record);
        continue;
      }
      const edgeIsLocal = record.revocation.fromPub === this.selfPub()
        && record.revocation.toPub !== this.selfPub();
      if (!edgeIsLocal || !(await verifyRevocation(record.revocation, crypto))) {
        this.setLocalRecordState(record.revocation.toPub, 'invalid', now);
        continue;
      }
      try {
        await this.publishRevocation(record.revocation);
        this.setLocalRecordState(record.revocation.toPub, 'removed', now);
      } catch {
        remaining.push({
          ...record,
          lastAttemptAt: now,
          attempts: record.attempts + 1,
        });
        this.setLocalRecordState(record.revocation.toPub, 'revocation-pending', now);
      }
    }
    this.writeJson(PENDING_REVOCATIONS_KEY, remaining);
  }

  /** Resolve the current state of a link with `peerPub` from the graph. */
  async linkStateWith(peerPub: string): Promise<ResolvedLinkState> {
    if (this.hasPendingRevocation(peerPub)) return 'revoked';
    const [attSelf, attPeer, revSelf, revPeer] = await Promise.all([
      this.readAttestation(this.selfPub(), peerPub),
      this.readAttestation(peerPub, this.selfPub()),
      this.readRevocation(this.selfPub(), peerPub),
      this.readRevocation(peerPub, this.selfPub()),
    ]);
    const crypto = this.crypto();
    for (const attestation of [attSelf, attPeer]) {
      if (attestation && !(await verifyLinkAttestation(attestation, crypto))) return 'invalid';
    }
    if (attSelf && attPeer && attSelf.secretHash !== attPeer.secretHash) return 'conflicted';

    const revocations = [revSelf, revPeer].filter((value): value is LinkRevocation => !!value);
    for (const revocation of revocations) {
      const sameEdge = (
        revocation.fromPub === this.selfPub() && revocation.toPub === peerPub
      ) || (
        revocation.fromPub === peerPub && revocation.toPub === this.selfPub()
      );
      if (!sameEdge || !(await verifyRevocation(revocation, crypto))) return 'invalid';
    }
    if (revocations.length > 0) {
      const latestRevocationAt = Math.max(...revocations.map((revocation) => revocation.revokedAt));
      const latestAttestationAt = Math.max(
        attSelf?.issuedAt ?? Number.NEGATIVE_INFINITY,
        attPeer?.issuedAt ?? Number.NEGATIVE_INFINITY,
      );
      return latestAttestationAt > latestRevocationAt ? 'conflicted' : 'revoked';
    }

    if (attSelf && attPeer) return (await linkVerified(attSelf, attPeer, crypto)) ? 'linked' : 'invalid';
    if (attSelf || attPeer) return 'pending';
    return 'none';
  }

  /** Do these two identities have a verified direct mutual link? */
  async isLinked(peerPub: string): Promise<boolean> {
    return (await this.linkStateWith(peerPub)) === 'linked';
  }

  /** Re-resolve local candidate rows from signed graph state. */
  async refreshLocalRecords(): Promise<LinkedDeviceRecord[]> {
    await this.flushPendingRevocations();
    const refreshed = await Promise.all(this.listLocalRecords().map(async (record) => {
      const locallyPending = this.hasPendingRevocation(record.pub);
      const state = await this.linkStateWith(record.pub).catch(() => 'none' as ResolvedLinkState);
      const displayState: LinkedDeviceRecord['state'] = locallyPending
        ? 'revocation-pending'
        : state === 'linked'
        ? 'linked'
        : state === 'pending'
          ? 'waiting'
          : state === 'revoked'
            ? 'removed'
            : state === 'conflicted'
              ? 'conflicted'
              : 'invalid';
      return { ...record, state: displayState };
    }));
    this.writeJson(LOCAL_LINKS_KEY, refreshed);
    return refreshed;
  }

  // --- local display model (list on the Linked devices page) --------------------

  listLocalRecords(): LinkedDeviceRecord[] {
    const arr = this.readJson<LinkedDeviceRecord[]>(LOCAL_LINKS_KEY);
    return Array.isArray(arr) ? arr : [];
  }

  upsertLocalRecord(record: LinkedDeviceRecord): void {
    const list = this.listLocalRecords().filter((r) => r.pub !== record.pub);
    list.push(record);
    this.writeJson(LOCAL_LINKS_KEY, list);
  }

  removeLocalRecord(pub: string): void {
    const list = this.listLocalRecords().filter((r) => r.pub !== pub);
    this.writeJson(LOCAL_LINKS_KEY, list);
  }

  private setLocalRecordState(
    pub: string,
    state: LinkedDeviceRecord['state'],
    now: number,
  ): void {
    const existing = this.listLocalRecords().find((record) => record.pub === pub);
    this.upsertLocalRecord({
      pub,
      stageName: existing?.stageName || 'Linked identity',
      platform: existing?.platform || 'unknown',
      linkedAt: existing?.linkedAt || now,
      state,
    });
  }

  // --- Gun read/write -----------------------------------------------------------

  private linkPath(fromPub: string, toPub: string): string {
    return `${GUN_LINK_ROOT}/${encodeURIComponent(fromPub)}/${encodeURIComponent(toPub)}`;
  }

  private revokePath(fromPub: string, toPub: string): string {
    return `${GUN_REVOKE_ROOT}/${encodeURIComponent(fromPub)}/${encodeURIComponent(toPub)}`;
  }

  private requestPath(targetPub: string, requestId: string): string {
    return `${GUN_REQUEST_ROOT}/${encodeURIComponent(targetPub)}/${encodeURIComponent(requestId)}`;
  }

  private async publishAttestation(att: LinkAttestation): Promise<void> {
    // Attestations are self-authenticating signed records in the shared public
    // graph. Keep writes on the same root that readAttestation uses; putPublic()
    // would silently prefix the current user's namespace and make the mutual
    // record undiscoverable at identity-links/<from>/<to>.
    await this.gunService.put(this.linkPath(att.fromPub, att.toPub), att as unknown as Record<string, unknown>);
  }

  private async publishRevocation(rev: LinkRevocation): Promise<void> {
    await this.gunService.put(this.revokePath(rev.fromPub, rev.toPub), rev as unknown as Record<string, unknown>);
  }

  private async publishIncomingRequest(
    targetPub: string,
    requestId: string,
    attestation: LinkAttestation,
  ): Promise<void> {
    // The secret never enters the graph. The signed attestation contains only its
    // hash; the target matches that against its short-lived local pending record.
    await this.gunService.put(this.requestPath(targetPub, requestId), {
      request: JSON.stringify(attestation),
    });
  }

  private async readAttestation(fromPub: string, toPub: string): Promise<LinkAttestation | null> {
    const raw = await this.gunService.get(this.linkPath(fromPub, toPub)).catch(() => null);
    return raw && typeof raw === 'object' && raw.sig ? (raw as LinkAttestation) : null;
  }

  private async readRevocation(fromPub: string, toPub: string): Promise<LinkRevocation | null> {
    const raw = await this.gunService.get(this.revokePath(fromPub, toPub)).catch(() => null);
    return raw && typeof raw === 'object' ? (raw as LinkRevocation) : null;
  }

  private readJson<T>(key: string): T | null {
    try {
      const raw = this.storage?.getItem(key);
      return raw ? JSON.parse(raw) as T : null;
    } catch {
      return null;
    }
  }

  private writeJson(key: string, value: unknown): void {
    try {
      this.storage?.setItem(key, JSON.stringify(value));
    } catch {
      // Pairing remains unavailable rather than exposing secrets through a fallback store.
    }
  }

  private removeStorage(key: string): void {
    try {
      this.storage?.removeItem(key);
    } catch {
      // Best-effort cleanup; expiry checks still fail the record closed.
    }
  }

  private consumedPairings(now: number): ConsumedPairingV1[] {
    const records = this.readJson<ConsumedPairingV1[]>(CONSUMED_PAIRINGS_KEY);
    const live = Array.isArray(records)
      ? records.filter((record) => record && record.expiresAt >= now)
      : [];
    if (records && live.length !== records.length) this.writeJson(CONSUMED_PAIRINGS_KEY, live);
    return live;
  }

  private isPairingConsumed(requestId: string, now: number): boolean {
    return this.consumedPairings(now).some((record) => record.requestId === requestId);
  }

  private markPairingConsumed(requestId: string, expiresAt: number, now: number): void {
    const records = this.consumedPairings(now).filter((record) => record.requestId !== requestId);
    records.push({ requestId, expiresAt });
    this.writeJson(CONSUMED_PAIRINGS_KEY, records);
  }

  private pendingRevocations(): PendingRevocationV1[] {
    const records = this.readJson<PendingRevocationV1[]>(PENDING_REVOCATIONS_KEY);
    return Array.isArray(records)
      ? records.filter((record) => (
          record?.version === 1
          && typeof record.revocation?.fromPub === 'string'
          && !!record.revocation.fromPub
          && typeof record.revocation?.toPub === 'string'
          && !!record.revocation.toPub
          && Number.isFinite(record.revocation?.revokedAt)
          && typeof record.revocation?.sig === 'string'
          && !!record.revocation.sig
        ))
      : [];
  }

  private hasPendingRevocation(peerPub: string): boolean {
    return this.pendingRevocations().some((record) => record.revocation.toPub === peerPub);
  }

  private queueRevocation(record: PendingRevocationV1): void {
    const records = this.pendingRevocations()
      .filter((existing) => existing.revocation.toPub !== record.revocation.toPub);
    records.push(record);
    this.writeJson(PENDING_REVOCATIONS_KEY, records);
  }
}
