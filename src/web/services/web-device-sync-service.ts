import type { WebGunService } from './web-gun-service';
import type { GunPair } from '../sea-gun';
import type { TalkIntakeFilters } from '../../shared/types';
import {
  buildDeviceSyncAuthorization,
  verifyMutualDeviceSyncAuthorization,
  type DeviceSyncAuthorization,
} from '../../shared/device-sync-authorization';
import {
  buildDeviceSyncBundle,
  type DeviceSyncAcknowledgement,
  type DeviceSyncBundle,
  type DeviceSyncRecord,
} from '../../shared/device-sync-contract';
import {
  importAuthorizedDeviceSyncBundle,
  resolveDeviceSyncImportConflicts,
  type DeviceSyncConflictDecision,
  type DeviceSyncImportConflict,
} from '../../shared/device-sync-importer';
import { enqueueDeviceSyncChange, flushDeviceSyncOutbox, initializeDeviceSyncOutbox } from '../../shared/device-sync-outbox';
import {
  createSeaDeviceSyncCrypto,
  decryptDeviceSyncEnvelope,
  encryptDeviceSyncBundle,
  type EncryptedDeviceSyncEnvelope,
} from './web-device-sync-crypto';
import { WebDeviceSyncCustodyStore } from './web-device-sync-custody-store';
import { WebDeviceSyncOutboxStore } from './web-device-sync-outbox-store';

/**
 * Wires the WP5 device-sync protocol (shared/device-sync-*.ts, previously built but never called
 * outside its own unit tests — see docs/design/device-sync-data-inventory.md) into the live app,
 * scoped to continuous sync of a single category — `preferences` (talk intake filters) — between
 * two already-linked devices (identity-linking.ts's mutual-attestation "linked" state; see
 * linked-devices-dialog.ts's "Enable sync" action). Every other transferable category from the
 * inventory (contacts, talks, messages, …) is a natural follow-on once this first slice is proven,
 * not wired here.
 *
 * Every private value still only ever leaves a device SEA-encrypted to the receiving device's
 * epub (`encryptDeviceSyncBundle`); this service only adds the Gun transport (envelope/ack
 * exchange) and the one-time "empty snapshot" bootstrap the shared outbox protocol needs before
 * its first delta.
 */

const AUTHORIZATION_ROOT = 'device-sync-authorization';
const ENVELOPE_ROOT = 'device-sync-envelope';
const ACK_ROOT = 'device-sync-ack';
/**
 * identity-linking.ts's LinkedDeviceRow only ever carries `pub` (the pairing code/attestation
 * protocol never exchanges `epub`), and every OTHER epub lookup in this app
 * (app.ts's resolvePeerEpub) is keyed by the app's own userId, not a raw SEA pub — there is no
 * existing pub-keyed epub lookup to reuse. This small additive registry is the fix: each device
 * publishes its own {pub, epub} here (harmless to publish — epub is already public/shareable by
 * design for ECDH) so a linked peer can resolve it from the pub alone, without touching
 * identity-linking.ts's wire format.
 */
const EPUB_ROOT = 'device-sync-epub';
const CUSTODY_NAMESPACE_PREFIX = 'iinpublic_device_sync_v1_';
const OUTBOX_STORAGE_KEY_PREFIX = 'iinpublic_device_sync_outbox_v1_';
const ACK_POLL_INTERVAL_MS = 700;
const ACK_WAIT_TIMEOUT_MS = 8_000;

export const DEVICE_SYNC_ENABLED_CATEGORIES = ['preferences'] as const;

export type DeviceSyncPeerState = 'inactive' | 'pending' | 'syncing';

function pairKey(pubA: string, pubB: string): string {
  return [pubA, pubB].sort().join('_');
}

function authorizationId(pubA: string, pubB: string): string {
  return `sync_${pairKey(pubA, pubB)}`;
}

async function putJson(gunService: WebGunService, path: string, value: unknown): Promise<void> {
  await gunService.put(path, { json: JSON.stringify(value) });
}

function getJsonOnce<T>(gunService: WebGunService, path: string): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    gunService.getGun().get(path).once((data: unknown) => {
      if (settled) return;
      settled = true;
      const json = (data as { json?: string } | null)?.json;
      if (!json) { resolve(null); return; }
      try { resolve(JSON.parse(json) as T); } catch { resolve(null); }
    });
  });
}

function subscribeJson<T>(gunService: WebGunService, path: string, onValue: (value: T) => void): () => void {
  return gunService.subscribe(path, (data: unknown) => {
    const json = (data as { json?: string } | null)?.json;
    if (!json) return;
    try { onValue(JSON.parse(json) as T); } catch { /* malformed publish — ignore */ }
  });
}

export class WebDeviceSyncService {
  private readonly custodyStores = new Map<string, WebDeviceSyncCustodyStore>();
  private readonly outboxStores = new Map<string, WebDeviceSyncOutboxStore>();
  private readonly authorizations = new Map<string, [DeviceSyncAuthorization, DeviceSyncAuthorization]>();
  private readonly authorizationUnsubscribes = new Map<string, () => void>();
  private readonly envelopeUnsubscribes = new Map<string, () => void>();
  /** Peers THIS device has explicitly enabled sync toward (published its own authorization half
   * for) — distinct from `authorizationUnsubscribes`, which also covers passive `watchPeerForSync`
   * calls made automatically at boot/after linking (before any explicit consent). `peerState`
   * must only report 'pending' once this device itself has actually consented, not merely because
   * it's listening for a peer who might. */
  private readonly selfEnabledPeers = new Set<string>();
  private readonly activating = new Set<string>();
  /** Per peer: the JSON of the last local-preferences value already written into that peer's
   * custody store AND (once its outbox was ready) enqueued. Gates BOTH operations together —
   * see `syncPreferencesToAllPeers`'s doc comment for why re-running the custody write on every
   * tick with a fresh timestamp was a real bug, not just a wasted write. */
  private readonly lastSyncedPreferencesJsonByPeer = new Map<string, string>();
  private lastAppliedPreferencesJson: string | null = null;
  /** The record is built ONCE, in `enqueuePreferencesChange`, with a timestamp fixed at that
   * moment — never rebuilt per-tick — precisely so `updatedAt` reflects when the value actually
   * changed, not when `syncPreferencesToAllPeers` happened to run. */
  private lastLocalPreferences: { pub: string; record: DeviceSyncRecord } | null = null;
  private onPreferencesApplied?: (filters: TalkIntakeFilters) => void;
  private onConflict?: (conflicts: readonly DeviceSyncImportConflict[]) => Promise<DeviceSyncConflictDecision[] | null>;

  constructor(private readonly gunService: WebGunService) {}

  setHandlers(handlers: {
    onPreferencesApplied: (filters: TalkIntakeFilters) => void;
    onConflict: (conflicts: readonly DeviceSyncImportConflict[]) => Promise<DeviceSyncConflictDecision[] | null>;
  }): void {
    this.onPreferencesApplied = handlers.onPreferencesApplied;
    this.onConflict = handlers.onConflict;
  }

  peerState(peerPub: string): DeviceSyncPeerState {
    if (this.custodyStores.has(peerPub)) return 'syncing';
    return this.selfEnabledPeers.has(peerPub) ? 'pending' : 'inactive';
  }

  /** Master entry point for the "Enable sync" action: publishes this device's authorization half
   * and starts (idempotently) watching for the peer's. Mutual completion activates automatically,
   * whether the peer already published (this call sees it right away via the live subscription's
   * initial fire) or approves later while this device stays online. */
  async enableSyncWithPeer(peerPub: string): Promise<void> {
    const pair = this.gunService.getStoredPair();
    if (!pair?.pub) return;
    const authorization = await buildDeviceSyncAuthorization({
      authorizationId: authorizationId(pair.pub, peerPub),
      mode: 'continuous',
      selfDevicePub: pair.pub,
      peerDevicePub: peerPub,
      selectedCategories: [...DEVICE_SYNC_ENABLED_CATEGORIES],
      crypto: createSeaDeviceSyncCrypto(pair as GunPair),
    });
    await putJson(this.gunService, `${AUTHORIZATION_ROOT}/${pairKey(pair.pub, peerPub)}/${pair.pub}`, authorization);
    await putJson(this.gunService, `${EPUB_ROOT}/${pair.pub}`, { pub: pair.pub, epub: pair.epub });
    this.selfEnabledPeers.add(peerPub);
    this.watchPeerForSync(peerPub);
  }

  /** Call for every currently-linked peer at boot (and right after a new link completes) so a
   * peer-initiated or previously-started handshake resumes without requiring the dialog to be
   * reopened. Safe to call repeatedly — a live peer/self already active is a no-op. */
  watchPeerForSync(peerPub: string): void {
    if (this.authorizationUnsubscribes.has(peerPub) || this.custodyStores.has(peerPub)) return;
    const pair = this.gunService.getStoredPair();
    if (!pair?.pub) return;
    const selfPub = pair.pub;
    const path = `${AUTHORIZATION_ROOT}/${pairKey(selfPub, peerPub)}/${peerPub}`;
    const unsubscribe = subscribeJson<DeviceSyncAuthorization>(this.gunService, path, (peerAuthorization) => {
      void this.tryActivate(peerPub, peerAuthorization);
    });
    this.authorizationUnsubscribes.set(peerPub, unsubscribe);
  }

  /**
   * Retries activation for every watched-but-not-yet-active peer on each tick. This is not just
   * a peer-offline fallback: a live `.on()` firing for the PEER's just-arrived authorization can
   * race this device's OWN just-written authorization becoming visible to a fresh `.once()` read
   * (`tryActivate`'s `selfAuthorization` lookup) — observed in practice with real Gun (not just
   * the in-memory test fake). Nothing else would ever re-trigger `tryActivate` for that peer once
   * the one-time subscription fire has already happened and been missed, so this periodic sweep
   * is the actual correctness fix, not merely a convenience.
   */
  private async retryPendingActivations(): Promise<void> {
    for (const peerPub of this.authorizationUnsubscribes.keys()) {
      if (this.custodyStores.has(peerPub)) continue;
      const pair = this.gunService.getStoredPair();
      if (!pair?.pub) return;
      const peerAuthorization = await getJsonOnce<DeviceSyncAuthorization>(
        this.gunService,
        `${AUTHORIZATION_ROOT}/${pairKey(pair.pub, peerPub)}/${peerPub}`,
      );
      if (peerAuthorization) await this.tryActivate(peerPub, peerAuthorization);
    }
  }

  private async tryActivate(peerPub: string, peerAuthorization: DeviceSyncAuthorization): Promise<void> {
    if (this.custodyStores.has(peerPub) || this.activating.has(peerPub)) return;
    const pair = this.gunService.getStoredPair();
    if (!pair?.pub) return;
    const selfPub = pair.pub;
    const selfAuthorization = await getJsonOnce<DeviceSyncAuthorization>(
      this.gunService,
      `${AUTHORIZATION_ROOT}/${pairKey(selfPub, peerPub)}/${selfPub}`,
    );
    if (!selfAuthorization) return; // this device hasn't approved sync with this peer (yet), or the write hasn't settled — retryPendingActivations sweeps this again next tick
    const verified = await verifyMutualDeviceSyncAuthorization({
      authorizations: [selfAuthorization, peerAuthorization],
      sourceDevicePub: selfPub,
      targetDevicePub: peerPub,
      selectedCategories: [...DEVICE_SYNC_ENABLED_CATEGORIES],
      crypto: createSeaDeviceSyncCrypto(pair as GunPair),
    });
    if (!verified.ok) return;
    this.activating.add(peerPub);
    try {
      await this.activatePeer(peerPub, [selfAuthorization, peerAuthorization]);
    } finally {
      this.activating.delete(peerPub);
    }
  }

  private async activatePeer(peerPub: string, authorizations: [DeviceSyncAuthorization, DeviceSyncAuthorization]): Promise<void> {
    if (this.custodyStores.has(peerPub)) return;
    const pair = this.gunService.getStoredPair();
    if (!pair?.pub) return;
    this.authorizations.set(peerPub, authorizations);
    const custodyStore = new WebDeviceSyncCustodyStore(localStorage, pair as GunPair, `${CUSTODY_NAMESPACE_PREFIX}${peerPub}`);
    const outboxStore = new WebDeviceSyncOutboxStore(localStorage, pair as GunPair, `${OUTBOX_STORAGE_KEY_PREFIX}${peerPub}`);
    this.custodyStores.set(peerPub, custodyStore);
    this.outboxStores.set(peerPub, outboxStore);
    this.startReceiving(peerPub);
    // The one-time empty-snapshot bootstrap (see bootstrapOutboxIfNeeded) is deliberately NOT
    // attempted here — it goes through `tick()` exclusively, same as every later delta. Activation
    // fires from a live Gun subscription callback this method can't make the caller await, so
    // driving the network round trip from here would just be an uncontrolled race with the next
    // tick; a single retry point is simpler to reason about and only costs one tick interval of
    // latency before the first sync.
  }

  /**
   * Only the deterministic initiator (see `activatePeer`) ever calls this directly — it BUILDS
   * and SENDS the one-time empty snapshot. The non-initiator never sends one, but still needs its
   * OWN outbox initialized (to send its own future local changes back) the moment it has learned
   * the shared checkpoint by IMPORTING that snapshot — see `handleIncomingEnvelope`'s call into
   * `ensureOwnOutboxInitialized`. Conflating "who bootstraps the shared checkpoint" with "who gets
   * an outbox at all" was the earlier bug here: both sides need one, only one of them sends it.
   */
  private async bootstrapOutboxIfNeeded(peerPub: string): Promise<void> {
    const outboxStore = this.outboxStores.get(peerPub);
    if (!outboxStore || (await outboxStore.load())) return; // already initialized
    const pair = this.gunService.getStoredPair();
    if (!pair?.pub || !pair?.epub) return;
    const auth = this.authorizations.get(peerPub);
    if (!auth) return;
    try {
      const peerEpub = await this.peerEpub(peerPub);
      if (!peerEpub) return; // peer hasn't published its epub yet — retry next tick
      const snapshot = await buildDeviceSyncBundle({
        source: { devicePub: pair.pub, deviceEpub: pair.epub, identityPub: pair.pub },
        target: { devicePub: peerPub, deviceEpub: peerEpub, identityPub: peerPub },
        authorizationId: authorizationId(pair.pub, peerPub),
        mode: 'snapshot',
        selectedCategories: [...DEVICE_SYNC_ENABLED_CATEGORIES],
        records: [],
        crypto: createSeaDeviceSyncCrypto(pair as GunPair),
      });
      await this.deliverBundle(peerPub, snapshot);
      await initializeDeviceSyncOutbox({
        store: outboxStore,
        authorizationId: snapshot.manifest.authorizationId,
        source: snapshot.manifest.source,
        target: snapshot.manifest.target,
        selectedCategories: [...DEVICE_SYNC_ENABLED_CATEGORIES],
        baseCheckpointId: snapshot.manifest.checkpointId,
      });
      // Seed this device's OWN incoming-head tracking for the peer to the exact same checkpoint
      // `ensureOwnOutboxInitialized` will use as the peer's outbox base once it imports this very
      // snapshot. Without this, the peer's first delta back (previousCheckpointId = that shared
      // checkpoint) gets rejected here as "delta predecessor does not match imported checkpoint"
      // — this device's own readHead(peer) would otherwise still be null, since nothing else
      // ever calls importDeviceSyncBundle for a bundle actually FROM the peer at this point.
      const custodyStore = this.custodyStores.get(peerPub);
      await custodyStore?.writeHead(peerPub, snapshot.manifest.checkpointId);
    } catch {
      // Peer offline, epub not yet published, or a transient Gun failure — the periodic sync
      // tick retries this (the outbox stays uninitialized until it succeeds).
    }
  }

  /** Non-initiator side of the same bootstrap: called once this device has successfully imported
   * a bundle (snapshot OR delta — either proves both sides now agree on `checkpointId`) from a
   * peer whose own outbox toward THIS device isn't initialized yet. No-ops once already done. */
  private async ensureOwnOutboxInitialized(peerPub: string, baseCheckpointId: string): Promise<void> {
    const outboxStore = this.outboxStores.get(peerPub);
    const pair = this.gunService.getStoredPair();
    if (!outboxStore || !pair?.pub || !pair?.epub || (await outboxStore.load())) return;
    try {
      const peerEpub = await this.peerEpub(peerPub);
      if (!peerEpub) return;
      await initializeDeviceSyncOutbox({
        store: outboxStore,
        authorizationId: authorizationId(pair.pub, peerPub),
        source: { devicePub: pair.pub, deviceEpub: pair.epub, identityPub: pair.pub },
        target: { devicePub: peerPub, deviceEpub: peerEpub, identityPub: peerPub },
        selectedCategories: [...DEVICE_SYNC_ENABLED_CATEGORIES],
        baseCheckpointId,
      });
    } catch {
      // Retried the next time this device successfully imports anything from this peer.
    }
  }

  private async peerEpub(peerPub: string): Promise<string> {
    const record = await getJsonOnce<{ pub: string; epub: string }>(this.gunService, `${EPUB_ROOT}/${peerPub}`);
    return record?.epub || '';
  }

  private startReceiving(peerPub: string): void {
    if (this.envelopeUnsubscribes.has(peerPub)) return;
    const pair = this.gunService.getStoredPair();
    if (!pair?.pub) return;
    const path = `${ENVELOPE_ROOT}/${pair.pub}/${peerPub}`;
    const unsubscribe = subscribeJson<EncryptedDeviceSyncEnvelope>(this.gunService, path, (envelope) => {
      void this.handleIncomingEnvelope(peerPub, envelope);
    });
    this.envelopeUnsubscribes.set(peerPub, unsubscribe);
  }

  private async handleIncomingEnvelope(peerPub: string, envelope: EncryptedDeviceSyncEnvelope): Promise<void> {
    const pair = this.gunService.getStoredPair();
    const custodyStore = this.custodyStores.get(peerPub);
    const authorizations = this.authorizations.get(peerPub);
    if (!pair?.pub || !custodyStore || !authorizations) return;
    let bundle: DeviceSyncBundle;
    try {
      bundle = await decryptDeviceSyncEnvelope(envelope, pair as GunPair);
    } catch {
      return; // not addressed to this device, or corrupt — silently drop
    }
    const crypto = createSeaDeviceSyncCrypto(pair as GunPair);
    let result = await importAuthorizedDeviceSyncBundle({
      bundle,
      authorizations,
      targetDevicePub: pair.pub,
      targetCrypto: crypto,
      store: custodyStore,
    });
    if (!result.ok && result.status === 'conflicted' && this.onConflict) {
      const decisions = await this.onConflict(result.conflicts);
      if (!decisions) return; // user dismissed — leave unresolved; the next incoming envelope (or a future "review" action) can retry
      await resolveDeviceSyncImportConflicts({ store: custodyStore, checkpointId: bundle.manifest.checkpointId, decisions });
      result = await importAuthorizedDeviceSyncBundle({
        bundle,
        authorizations,
        targetDevicePub: pair.pub,
        targetCrypto: crypto,
        store: custodyStore,
      });
    }
    if (!result.ok) return;
    await putJson(this.gunService, `${ACK_ROOT}/${peerPub}/${pair.pub}`, result.acknowledgement);
    await this.ensureOwnOutboxInitialized(peerPub, bundle.manifest.checkpointId);
    await this.reapplyPreferencesFromCustody(peerPub);
  }

  /** Preferences is the one auto-applied category (per its inventory description — "safe and
   * meaningful across installations") — re-reads whatever the custody store now holds as
   * authoritative post-convergence (it may be the incoming value, or the local one that won) and
   * pushes it into the live app if it actually changed, guarding the echo back through
   * `enqueuePreferencesChange` via `lastAppliedPreferencesJson`. */
  private async reapplyPreferencesFromCustody(peerPub: string): Promise<void> {
    const custodyStore = this.custodyStores.get(peerPub);
    if (!custodyStore || !this.onPreferencesApplied) return;
    const record = await custodyStore.readRecord('preferences', 'talkFilters');
    if (!record || record.tombstone) return;
    const json = JSON.stringify(record.payload ?? {});
    if (json === this.lastAppliedPreferencesJson) return;
    this.lastAppliedPreferencesJson = json;
    this.onPreferencesApplied(record.payload as TalkIntakeFilters);
  }

  /** Called whenever the local talk filters change (WebUserService's putPrivateUserData hook) —
   * builds the outgoing record ONCE, with `updatedAt` fixed at the moment the value actually
   * changed, and records it as the source of truth to propagate. Actual delivery to each peer's
   * outbox happens in `syncPreferencesToAllPeers` (called here for any peer already bootstrapped,
   * and again from `tick()` for a peer whose outbox bootstrap only just completed) — a change made
   * before this device's outbox finished its one-time snapshot bootstrap must not be silently
   * dropped, it must wait and go out once the outbox exists.
   *
   * Building the record here — not inside `syncPreferencesToAllPeers` — is deliberate and fixes a
   * real bug: `syncPreferencesToAllPeers` used to stamp a FRESH `new Date().toISOString()` on
   * every call, including every retry from the 5-second `tick()` loop, even when the underlying
   * value hadn't changed. Since `chooseConvergedRecord` breaks a version tie by comparing
   * `updatedAt`, a device sitting idle with its own unchanged default value kept "winning" against
   * a peer's genuinely newer edit purely because its own timestamp kept marching forward in real
   * time. Reusing one fixed `record` object for a given value, across every retry, closes that.
   */
  async enqueuePreferencesChange(pub: string, filters: TalkIntakeFilters): Promise<void> {
    const json = JSON.stringify(filters ?? {});
    if (json === this.lastAppliedPreferencesJson) return; // this is the value we just applied FROM a peer — don't echo it back
    this.lastAppliedPreferencesJson = json;
    const now = new Date().toISOString();
    const record: DeviceSyncRecord = {
      category: 'preferences',
      recordId: 'talkFilters',
      originPub: pub,
      authorPub: pub,
      createdAt: now,
      updatedAt: now,
      version: 1,
      tombstone: false,
      payload: filters ?? {},
    };
    this.lastLocalPreferences = { pub, record };
    await this.syncPreferencesToAllPeers();
  }

  private async syncPreferencesToAllPeers(): Promise<void> {
    if (!this.lastLocalPreferences || this.custodyStores.size === 0) return;
    const { record } = this.lastLocalPreferences;
    const json = JSON.stringify(record.payload);
    for (const [peerPub, custodyStore] of this.custodyStores) {
      if (this.lastSyncedPreferencesJsonByPeer.get(peerPub) === json) continue; // already handled for this peer+value
      await custodyStore.writeRecord(record).catch(() => {});
      const outboxStore = this.outboxStores.get(peerPub);
      if (!outboxStore || !(await outboxStore.load().catch(() => null))) continue; // not bootstrapped yet — retry next tick; the custody write above already landed and is idempotent (same fixed record) in the meantime
      await enqueueDeviceSyncChange({ store: outboxStore, record }).catch(() => {});
      this.lastSyncedPreferencesJsonByPeer.set(peerPub, json);
    }
  }

  /** Guards `tick()` against overlapping invocations: `deliverBundleEnvelope`'s ack wait can take
   * up to `ACK_WAIT_TIMEOUT_MS` (8s), longer than app.ts's 5s tick interval — without this,
   * `setInterval` firing again mid-flush would start a second concurrent `flushDeviceSyncOutbox`
   * against the same outbox, producing duplicate in-flight sends. */
  private tickInFlight = false;

  /** Periodic sync-loop tick (app.ts's setInterval, mirroring mailboxPollTimer): retries any
   * unconfirmed activation, any unbootstrapped outbox, and flushes every already-initialized
   * outbox. Never throws — an offline peer or a rejected authorization just leaves entries queued
   * for the next tick. */
  async tick(): Promise<void> {
    if (this.tickInFlight) return;
    this.tickInFlight = true;
    try {
      const pair = this.gunService.getStoredPair();
      if (!pair?.pub) return;
      await this.retryPendingActivations().catch(() => {});
      for (const peerPub of this.custodyStores.keys()) {
        if (pair.pub.localeCompare(peerPub) < 0) await this.bootstrapOutboxIfNeeded(peerPub).catch(() => {});
      }
      await this.syncPreferencesToAllPeers();
      for (const peerPub of this.custodyStores.keys()) {
        const outboxStore = this.outboxStores.get(peerPub);
        const authorizations = this.authorizations.get(peerPub);
        if (!outboxStore || !authorizations || !(await outboxStore.load())) continue;
        await flushDeviceSyncOutbox({
          store: outboxStore,
          authorizations,
          sourceCrypto: createSeaDeviceSyncCrypto(pair as GunPair),
          seal: async (bundle) => ({
            envelope: await encryptDeviceSyncBundle(bundle, pair as GunPair),
            checkpointId: bundle.manifest.checkpointId,
          }),
          deliver: (sealed) => this.deliverBundleEnvelope(peerPub, sealed.envelope, sealed.checkpointId),
        }).catch(() => {});
      }
    } finally {
      this.tickInFlight = false;
    }
  }

  private async deliverBundle(peerPub: string, bundle: DeviceSyncBundle): Promise<DeviceSyncAcknowledgement> {
    const pair = this.gunService.getStoredPair();
    if (!pair) throw new Error('device sync requires a signed-in pair');
    const envelope = await encryptDeviceSyncBundle(bundle, pair as GunPair);
    return this.deliverBundleEnvelope(peerPub, envelope, bundle.manifest.checkpointId);
  }

  private async deliverBundleEnvelope(
    peerPub: string,
    envelope: EncryptedDeviceSyncEnvelope,
    checkpointId: string,
  ): Promise<DeviceSyncAcknowledgement> {
    const pair = this.gunService.getStoredPair();
    if (!pair?.pub) throw new Error('device sync requires a signed-in pair');
    await putJson(this.gunService, `${ENVELOPE_ROOT}/${peerPub}/${pair.pub}`, envelope);
    const ack = await this.pollForAck(peerPub, pair.pub, checkpointId);
    if (!ack) throw new Error('device sync peer did not acknowledge within the wait budget');
    return ack;
  }

  /**
   * Polls rather than subscribes: a live `.on()` here would need careful unsubscribe bookkeeping
   * per in-flight delivery, while `flushDeviceSyncOutbox`'s own caller (`tick`) already runs on a
   * bounded interval and callers here are already inside a single bounded wait — a short poll loop
   * keeps this method's lifetime self-contained. The ack path is a single slot per pair-direction,
   * overwritten on every round, so a poll that finds a value must still confirm it acknowledges
   * *this* checkpoint — otherwise a stale ack left over from the previous (already-completed)
   * round would be returned immediately, which `verifyDeviceSyncAcknowledgement` inside
   * `flushDeviceSyncOutbox` would then correctly reject as not matching the in-flight manifest.
   */
  private async pollForAck(peerPub: string, selfPub: string, checkpointId: string): Promise<DeviceSyncAcknowledgement | null> {
    const path = `${ACK_ROOT}/${selfPub}/${peerPub}`;
    const deadline = Date.now() + ACK_WAIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const ack = await getJsonOnce<DeviceSyncAcknowledgement>(this.gunService, path);
      if (ack && ack.checkpointId === checkpointId) return ack;
      await sleep(ACK_POLL_INTERVAL_MS);
    }
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
