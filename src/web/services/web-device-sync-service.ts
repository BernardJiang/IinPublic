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
import type { SyncedMessage } from './web-device-sync-message-cache';
import { getGraphRelay, putGraphRelay } from './graph-relay-client';

/**
 * Wires the WP5 device-sync protocol (shared/device-sync-*.ts, previously built but never called
 * outside its own unit tests — see docs/design/device-sync-data-inventory.md) into the live app,
 * between two already-linked devices (identity-linking.ts's mutual-attestation "linked" state;
 * see linked-devices-dialog.ts's "Enable sync" action). Three categories are wired: `preferences`
 * (talk intake filters, continuous, single fixed record), `conversations` (metadata, continuous
 * + one-time backfill of pre-existing conversations at activation) and `messages` (per-message
 * plaintext copies, continuous + backfill). Every other transferable category from the inventory
 * (contacts, talks, …) is a natural follow-on once this slice is proven, not wired here.
 *
 * `messages` cannot ship raw Gun ciphertext: a message's ECDH secret was derived between the
 * *original* two conversation participants, one of whom is the OTHER linked device (a distinct
 * SEA identity from this one) — this device structurally cannot re-derive that secret, and
 * `identityPrivateKeys` is explicitly device-local/non-transferable. Records instead carry the
 * plaintext the originating device already decrypted for its own UI, re-encrypted only for the
 * device-to-device hop (`encryptDeviceSyncBundle`); the receiving side stores it in
 * web-device-sync-message-cache.ts, a plaintext-at-rest cache exactly like `myConversations` and
 * every other localStorage-cached app record, never fed back through the live decrypt path.
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

export const DEVICE_SYNC_ENABLED_CATEGORIES = ['preferences', 'conversations', 'messages'] as const;

export type DeviceSyncPeerState = 'inactive' | 'pending' | 'syncing';

function pairKey(pubA: string, pubB: string): string {
  return [pubA, pubB].sort().join('_');
}

function authorizationId(pubA: string, pubB: string): string {
  return `sync_${pairKey(pubA, pubB)}`;
}

/**
 * `apiBase`, when given, dual-writes/falls-back through graph-relay-client.ts — see that file's
 * doc comment for why a native/embedded build's raw Gun path alone isn't reliable cross-device.
 */
async function putJson(gunService: WebGunService, path: string, value: unknown, apiBase?: string): Promise<void> {
  const record = { json: JSON.stringify(value) };
  await gunService.put(path, record);
  if (apiBase) void putGraphRelay(apiBase, path, record);
}

function getJsonOnce<T>(gunService: WebGunService, path: string, apiBase?: string): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = async (data: unknown) => {
      if (settled) return;
      let json = (data as { json?: string } | null)?.json;
      if (!json && apiBase) {
        const relayed = await getGraphRelay<{ json?: string }>(apiBase, path);
        json = relayed?.json;
      }
      if (settled) return;
      settled = true;
      if (!json) { resolve(null); return; }
      try { resolve(JSON.parse(json) as T); } catch { resolve(null); }
    };
    gunService.getGun().get(path).once((data: unknown) => { void finish(data); });
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
  /** Dedupe guard for `pollEnvelopeForPeer` — the JSON of the last envelope this poll already
   *  handed to `handleIncomingEnvelope` per peer, so a native/embedded build's tick-driven poll
   *  (see that method's own doc comment) doesn't reprocess the same still-present envelope every
   *  5 seconds forever. */
  private readonly lastPolledEnvelopeJsonByPeer = new Map<string, string>();
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

  /** `conversations` category — see this class's own doc comment. Keyed by conversationId. */
  private readonly pendingConversationRecords = new Map<string, DeviceSyncRecord>();
  private readonly lastSyncedConversationJsonByPeer = new Map<string, Map<string, string>>();
  /** Echo guard, same purpose as `lastAppliedPreferencesJson` but per-conversation (many
   *  independent records instead of preferences' one fixed key). */
  private readonly lastAppliedConversationJsonById = new Map<string, string>();
  private onConversationApplied: ((conversation: Record<string, unknown>) => void) | undefined;

  /** `messages` category — immutable-union, so no value-comparison bookkeeping is needed, only
   *  "has this exact message id already been sent to / applied from this peer". Keyed by
   *  `conversationId|messageId`. */
  private readonly pendingMessageRecords = new Map<string, DeviceSyncRecord>();
  private readonly sentMessageRecordIdsByPeer = new Map<string, Set<string>>();
  private readonly appliedMessageRecordIds = new Set<string>();
  private onMessageApplied: ((conversationId: string, message: SyncedMessage) => void) | undefined;

  /** One-time backfill at activation (see `backfillExistingDataToPeer`): a conversation/message
   *  predating the link is otherwise never picked up by the continuous per-change hooks, which
   *  only fire for FUTURE local changes. Optional — omitted, backfill silently no-ops. */
  private getLocalConversationsSnapshot: (() => ReadonlyArray<Record<string, unknown> & { conversationId: string; otherUserId?: string }>) | undefined;
  private getLocalMessagesSnapshot: ((conversationId: string, otherUserId: string) => Promise<SyncedMessage[]>) | undefined;

  /** See graph-relay-client.ts's doc comment: optional so existing unit tests that construct
   *  this service without an apiBase keep working — every relay call is itself a no-op-on-failure
   *  best-effort call either way. */
  constructor(private readonly gunService: WebGunService, private readonly apiBase?: string) {}

  setHandlers(handlers: {
    onPreferencesApplied: (filters: TalkIntakeFilters) => void;
    onConflict: (conflicts: readonly DeviceSyncImportConflict[]) => Promise<DeviceSyncConflictDecision[] | null>;
    onConversationApplied?: (conversation: Record<string, unknown>) => void;
    onMessageApplied?: (conversationId: string, message: SyncedMessage) => void;
    getLocalConversationsSnapshot?: () => ReadonlyArray<Record<string, unknown> & { conversationId: string; otherUserId?: string }>;
    getLocalMessagesSnapshot?: (conversationId: string, otherUserId: string) => Promise<SyncedMessage[]>;
  }): void {
    this.onPreferencesApplied = handlers.onPreferencesApplied;
    this.onConflict = handlers.onConflict;
    this.onConversationApplied = handlers.onConversationApplied;
    this.onMessageApplied = handlers.onMessageApplied;
    this.getLocalConversationsSnapshot = handlers.getLocalConversationsSnapshot;
    this.getLocalMessagesSnapshot = handlers.getLocalMessagesSnapshot;
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
    await putJson(this.gunService, `${AUTHORIZATION_ROOT}/${pairKey(pair.pub, peerPub)}/${pair.pub}`, authorization, this.apiBase);
    await putJson(this.gunService, `${EPUB_ROOT}/${pair.pub}`, { pub: pair.pub, epub: pair.epub }, this.apiBase);
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
        this.apiBase,
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
      this.apiBase,
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
    //
    // Backfill is different: it only stages pending conversation/message records (no network
    // call of its own), so firing it here — rather than waiting for some other trigger — means
    // pre-existing history is already queued by the time the next `tick()` flushes the outbox,
    // instead of losing an extra interval. Fire-and-forget for the same reason as above: this
    // method itself is never awaited by its caller.
    void this.backfillExistingDataToPeer(peerPub);
  }

  /**
   * Enqueues every conversation/message this device already knows about at the moment sync with
   * `peerPub` activates — without this, only conversations/messages that change AFTER activation
   * would ever reach the peer, silently stranding everything that predates the link (the ordinary
   * case: two devices each already talked to other people before being linked together). Reuses
   * the exact same `enqueueConversationChange`/`enqueueMessagesForConversation` path a live local
   * change takes, so backfilled and freshly-created records are indistinguishable downstream.
   * No-ops silently if the app never registered the snapshot getters (handlers are optional).
   */
  private async backfillExistingDataToPeer(_peerPub: string): Promise<void> {
    const pair = this.gunService.getStoredPair();
    if (!pair?.pub || !this.getLocalConversationsSnapshot) return;
    const conversations = this.getLocalConversationsSnapshot();
    for (const conversation of conversations) {
      await this.enqueueConversationChange(pair.pub, conversation).catch(() => {});
      const otherUserId = String(conversation.otherUserId || '');
      if (!otherUserId || !this.getLocalMessagesSnapshot) continue;
      const messages = await this.getLocalMessagesSnapshot(conversation.conversationId, otherUserId).catch(() => [] as SyncedMessage[]);
      if (messages.length > 0) {
        await this.enqueueMessagesForConversation(conversation.conversationId, pair.pub, messages).catch(() => {});
      }
    }
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
    const record = await getJsonOnce<{ pub: string; epub: string }>(this.gunService, `${EPUB_ROOT}/${peerPub}`, this.apiBase);
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

  /**
   * `startReceiving`'s live `.on()` subscription never fires at all on a native/embedded build
   * whose local Gun graph doesn't generically peer with the hub (see graph-relay-client.ts's doc
   * comment — found via a real-hardware test) — without this, an embedded device would activate
   * sync, successfully SEND its own outbox, and then just never receive anything back. Called
   * from `tick()` every 5s for every active peer; `getJsonOnce`'s own relay fallback is what
   * actually reaches the peer's envelope on an embedded build, this just re-checks periodically
   * and hands anything new to the exact same `handleIncomingEnvelope` a live push would.
   */
  private async pollEnvelopeForPeer(peerPub: string): Promise<void> {
    const pair = this.gunService.getStoredPair();
    if (!pair?.pub) return;
    const path = `${ENVELOPE_ROOT}/${pair.pub}/${peerPub}`;
    const envelope = await getJsonOnce<EncryptedDeviceSyncEnvelope>(this.gunService, path, this.apiBase).catch(() => null);
    if (!envelope) return;
    const json = JSON.stringify(envelope);
    if (this.lastPolledEnvelopeJsonByPeer.get(peerPub) === json) return;
    this.lastPolledEnvelopeJsonByPeer.set(peerPub, json);
    await this.handleIncomingEnvelope(peerPub, envelope);
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
    await putJson(this.gunService, `${ACK_ROOT}/${peerPub}/${pair.pub}`, result.acknowledgement, this.apiBase);
    await this.ensureOwnOutboxInitialized(peerPub, bundle.manifest.checkpointId);
    await this.reapplyPreferencesFromCustody(peerPub);
    await this.reapplyConversationsAndMessagesFromCustody(peerPub, bundle);
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

  /**
   * Unlike preferences (one fixed record, always auto-applied), `bundle.records` here may carry
   * many conversation/message records at once — walk exactly the records THIS bundle delivered
   * (not the whole custody store, which has no enumeration API) and, for each, re-read the
   * custody store's post-convergence winner the same way `reapplyPreferencesFromCustody` does,
   * so a record this device's own local value beat still applies the correct (local) content,
   * not blindly the incoming one.
   */
  private async reapplyConversationsAndMessagesFromCustody(peerPub: string, bundle: DeviceSyncBundle): Promise<void> {
    const custodyStore = this.custodyStores.get(peerPub);
    if (!custodyStore) return;
    for (const incoming of bundle.records) {
      if (incoming.category !== 'conversations' && incoming.category !== 'messages') continue;
      const converged = await custodyStore.readRecord(incoming.category, incoming.recordId);
      if (!converged || converged.tombstone) continue;
      if (incoming.category === 'conversations') {
        if (!this.onConversationApplied) continue;
        const payload = converged.payload as Record<string, unknown> & { conversationId?: string };
        const conversationId = String(payload.conversationId || '');
        if (!conversationId) continue;
        const json = JSON.stringify(payload);
        if (this.lastAppliedConversationJsonById.get(conversationId) === json) continue; // echo of what this device just applied — see enqueueConversationChange
        this.lastAppliedConversationJsonById.set(conversationId, json);
        this.onConversationApplied(payload);
      } else {
        if (!this.onMessageApplied || this.appliedMessageRecordIds.has(converged.recordId)) continue;
        this.appliedMessageRecordIds.add(converged.recordId);
        const payload = converged.payload as SyncedMessage & { conversationId?: string };
        const conversationId = String(payload.conversationId || '');
        if (!conversationId) continue;
        this.onMessageApplied(conversationId, payload);
      }
    }
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

  /**
   * Called whenever a conversation is created or its metadata changes locally
   * (app.ts's `conversationAdded` handler, and `backfillExistingDataToPeer` for pre-existing
   * ones). `conversation` is whatever `getMyConversations()[conversationId]` currently holds —
   * passed through mostly as-is so the receiving side's `addNewConversation` call sees the same
   * shape a normal match would produce. Mutable-versioned, like preferences: version stays fixed
   * at 1 and convergence is decided by `updatedAt` (see `chooseConvergedRecord`), so a fresh
   * `record` — not a reused one — is intentional here (unlike preferences' single fixed key, each
   * conversationId's `updatedAt` legitimately needs to advance on every real local edit).
   */
  async enqueueConversationChange(pub: string, conversation: Record<string, unknown> & { conversationId: string }): Promise<void> {
    const conversationId = conversation.conversationId;
    if (!conversationId) return;
    const json = JSON.stringify(conversation);
    if (this.lastAppliedConversationJsonById.get(conversationId) === json) return; // echo of what this device just applied FROM a peer — don't send it back
    const now = new Date().toISOString();
    const record: DeviceSyncRecord = {
      category: 'conversations',
      recordId: conversationId,
      originPub: pub,
      authorPub: pub,
      createdAt: now,
      updatedAt: now,
      version: 1,
      tombstone: false,
      payload: conversation,
    };
    this.pendingConversationRecords.set(conversationId, record);
    await this.syncConversationsToAllPeers();
  }

  private async syncConversationsToAllPeers(): Promise<void> {
    if (this.pendingConversationRecords.size === 0 || this.custodyStores.size === 0) return;
    for (const [peerPub, custodyStore] of this.custodyStores) {
      let sentJsonByConversation = this.lastSyncedConversationJsonByPeer.get(peerPub);
      if (!sentJsonByConversation) {
        sentJsonByConversation = new Map();
        this.lastSyncedConversationJsonByPeer.set(peerPub, sentJsonByConversation);
      }
      const outboxStore = this.outboxStores.get(peerPub);
      const outboxReady = outboxStore ? await outboxStore.load().catch(() => null) : null;
      for (const [conversationId, record] of this.pendingConversationRecords) {
        const json = JSON.stringify(record.payload);
        if (sentJsonByConversation.get(conversationId) === json) continue; // already handled for this peer+value
        await custodyStore.writeRecord(record).catch(() => {});
        if (!outboxStore || !outboxReady) continue; // not bootstrapped yet — retry next tick
        await enqueueDeviceSyncChange({ store: outboxStore, record }).catch(() => {});
        sentJsonByConversation.set(conversationId, json);
      }
    }
  }

  /**
   * Called whenever this device decrypts/observes messages for one of its own conversations
   * (app.ts's conversation-preview subscription, which runs continuously for every conversation
   * in the background — not just the currently-open thread) and from `backfillExistingDataToPeer`
   * for conversation history that predates the link. `messages` may be the FULL current list for
   * the conversation (as `subscribeToMessages` callbacks deliver it) — only ids not already
   * queued/sent are turned into records, so calling this repeatedly with overlapping lists is
   * cheap and safe. Immutable-union (see this class's own doc comment for why plaintext, not raw
   * Gun ciphertext): no version/updatedAt convergence needed, just "has this id gone out yet".
   */
  async enqueueMessagesForConversation(
    conversationId: string,
    pub: string,
    messages: ReadonlyArray<SyncedMessage>,
  ): Promise<void> {
    for (const message of messages) {
      if (!message?.id) continue;
      const recordId = `${conversationId}|${message.id}`;
      if (this.appliedMessageRecordIds.has(recordId) || this.pendingMessageRecords.has(recordId)) continue;
      const record: DeviceSyncRecord = {
        category: 'messages',
        recordId,
        originPub: pub,
        authorPub: pub,
        createdAt: message.timestamp,
        updatedAt: message.timestamp,
        version: 1,
        tombstone: false,
        payload: { ...message, conversationId },
      };
      this.pendingMessageRecords.set(recordId, record);
    }
    await this.syncMessagesToAllPeers();
  }

  private async syncMessagesToAllPeers(): Promise<void> {
    if (this.pendingMessageRecords.size === 0 || this.custodyStores.size === 0) return;
    for (const [peerPub, custodyStore] of this.custodyStores) {
      let sentRecordIds = this.sentMessageRecordIdsByPeer.get(peerPub);
      if (!sentRecordIds) {
        sentRecordIds = new Set();
        this.sentMessageRecordIdsByPeer.set(peerPub, sentRecordIds);
      }
      const outboxStore = this.outboxStores.get(peerPub);
      const outboxReady = outboxStore ? await outboxStore.load().catch(() => null) : null;
      for (const [recordId, record] of this.pendingMessageRecords) {
        if (sentRecordIds.has(recordId)) continue;
        await custodyStore.writeRecord(record).catch(() => {});
        if (!outboxStore || !outboxReady) continue; // not bootstrapped yet — retry next tick
        await enqueueDeviceSyncChange({ store: outboxStore, record }).catch(() => {});
        sentRecordIds.add(recordId);
      }
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
      await this.syncConversationsToAllPeers();
      await this.syncMessagesToAllPeers();
      for (const peerPub of this.custodyStores.keys()) {
        await this.pollEnvelopeForPeer(peerPub).catch(() => {});
      }
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
    await putJson(this.gunService, `${ENVELOPE_ROOT}/${peerPub}/${pair.pub}`, envelope, this.apiBase);
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
      const ack = await getJsonOnce<DeviceSyncAcknowledgement>(this.gunService, path, this.apiBase);
      if (ack && ack.checkpointId === checkpointId) return ack;
      await sleep(ACK_POLL_INTERVAL_MS);
    }
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
